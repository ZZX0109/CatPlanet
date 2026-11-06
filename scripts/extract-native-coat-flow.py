#!/usr/bin/env python3
"""Read-only normal-texture line field. No model, source texture, or app edits.

The output is an UNORIENTED 2D observation, not a biological growth direction.
Normal-channel signs are not used as arrows: spatial structure tensors from
both high-pass XY channels make a green-channel sign change irrelevant.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import binary_erosion, correlate1d, gaussian_filter


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def smoothstep(lo: float, hi: float, value: np.ndarray) -> np.ndarray:
    t = np.clip((value - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def block_mean(array: np.ndarray, resolution: int) -> np.ndarray:
    h, w = array.shape[:2]
    if h % resolution or w % resolution:
        raise ValueError("Resolution must divide both image dimensions exactly")
    return array.reshape(resolution, h // resolution, resolution, w // resolution).mean(axis=(1, 3))


def line_field(normal_xy: np.ndarray, mask: np.ndarray, resolution: int,
               erosion: int = 24) -> dict[str, np.ndarray]:
    # No gamma conversion. Encoded normal channels are numerical data.
    smoothed = gaussian_filter(normal_xy, (0.65, 0.65, 0), mode="reflect")
    fine = smoothed - gaussian_filter(normal_xy, (2.5, 2.5, 0), mode="reflect")
    # Fourth-order centred derivatives reduce grid-axis angular bias. The
    # simpler two-point gradient has a measured1.3degree bias at wavelength8.
    derivative = np.array([1, -8, 0, 8, -1], np.float32) / 12
    fy = correlate1d(fine, derivative, axis=0, mode="reflect")
    fx = correlate1d(fine, derivative, axis=1, mode="reflect")
    ty = correlate1d(smoothed, derivative, axis=0, mode="reflect")
    tx = correlate1d(smoothed, derivative, axis=1, mode="reflect")
    jxx0 = (fx * fx).sum(axis=2)
    jyy0 = (fy * fy).sum(axis=2)
    jxy0 = (fx * fy).sum(axis=2)
    total0 = (tx * tx + ty * ty).sum(axis=2)

    def tensor(scale: float):
        return [block_mean(gaussian_filter(a, scale, mode="reflect"), resolution)
                for a in (jxx0, jyy0, jxy0)]

    jxx, jyy, jxy = tensor(5)
    wide_xx, wide_yy, wide_xy = tensor(10)
    difference = jxx - jyy
    discriminant = np.hypot(difference, 2 * jxy)
    energy = jxx + jyy
    coherence = discriminant / np.maximum(energy, 1e-20)
    # Minor-eigenvector of image tensor = direction along elongated ridges.
    # Image +y is down; UV +v is up, hence the sign of sin(2theta) changes.
    cos2 = -difference / np.maximum(discriminant, 1e-20)
    sin2 = 2 * jxy / np.maximum(discriminant, 1e-20)
    wide_disc = np.hypot(wide_xx - wide_yy, 2 * wide_xy)
    wide_cos = -(wide_xx - wide_yy) / np.maximum(wide_disc, 1e-20)
    wide_sin = 2 * wide_xy / np.maximum(wide_disc, 1e-20)
    agreement = np.clip(cos2 * wide_cos + sin2 * wide_sin, -1, 1)
    total = block_mean(gaussian_filter(total0, 5, mode="reflect"), resolution)
    frequency_ratio = np.clip(energy / np.maximum(total, 1e-20), 0, 1)
    interior = binary_erosion(mask, iterations=erosion) if erosion else mask
    support = block_mean(interior.astype(np.float32), resolution)
    confidence = (coherence * smoothstep(2e-6, 2e-5, energy)
                  * smoothstep(0.02, 0.25, frequency_ratio)
                  * smoothstep(0.5, 0.95, agreement))
    confidence[(support < 0.85) | (confidence < 0.35)] = 0
    # A zero director is an explicit unknown, never a guessed horizontal hair.
    cos2[confidence == 0] = 0
    sin2[confidence == 0] = 0
    return {"cos2theta": cos2.astype(np.float32), "sin2theta": sin2.astype(np.float32),
            "confidence": confidence.astype(np.float32), "coherence": coherence.astype(np.float32),
            "energy": energy.astype(np.float32), "frequency_ratio": frequency_ratio.astype(np.float32),
            "scale_agreement": agreement.astype(np.float32), "uv_support": support.astype(np.float32)}


def read_glb(path: Path):
    data = path.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + length])
    binary = data[28 + length:]
    def accessor(index):
        a = doc["accessors"][index]
        if "sparse" in a:
            raise ValueError("Sparse accessors need explicit expansion")
        view = doc["bufferViews"][a["bufferView"]]
        dtype = np.dtype({5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}[a["componentType"]])
        components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        offset = view.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.ndarray((a["count"], components), dtype=dtype, buffer=binary, offset=offset,
                          strides=(view.get("byteStride", components * dtype.itemsize), dtype.itemsize)).copy()
    normal_materials = [i for i, m in enumerate(doc["materials"]) if "normalTexture" in m]
    if len(normal_materials) != 1:
        raise ValueError("Expected the single original skin normal material")
    material = doc["materials"][normal_materials[0]]
    normal = material["normalTexture"]
    if normal.get("texCoord", 0) != 0 or normal.get("extensions"):
        raise ValueError("Normal UV transform is not the reviewed untransformed UV0")
    image = doc["images"][doc["textures"][normal["index"]]["source"]]
    view = doc["bufferViews"][image["bufferView"]]
    encoded = binary[view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]
    embedded = np.asarray(Image.open(io.BytesIO(encoded)).convert("RGB"))
    primitives = [p for mesh in doc["meshes"] for p in mesh["primitives"]
                  if p.get("material") == normal_materials[0]]
    return embedded, [(accessor(p["attributes"]["TEXCOORD_0"]), accessor(p["indices"]).reshape(-1, 3))
                      for p in primitives]


def uv_mask(primitives, width: int, height: int):
    image = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(image)
    triangles = 0
    for uv, indices in primitives:
        for triangle in indices:
            # glTF V0 is the top row of the PNG embedded in this specific GLB.
            vertices = [(float(uv[i, 0]) * width - .5, float(uv[i, 1]) * height - .5)
                        for i in triangle]
            draw.polygon(vertices, fill=255)
            triangles += 1
    return np.asarray(image) > 0, triangles


def arrows(image: np.ndarray, field: dict, output: Path, step: int = 8):
    # Diagnostic only: symmetric arrowheads communicate the +/- ambiguity.
    canvas = Image.fromarray(image).resize((1024, 1024), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(canvas)
    size = field["confidence"].shape[0]
    for y in range(step // 2, size, step):
        for x in range(step // 2, size, step):
            c = float(field["confidence"][y, x])
            if c <= 0:
                continue
            theta = .5 * np.arctan2(field["sin2theta"][y, x], field["cos2theta"][y, x])
            center = np.array([(x + .5) / size * 1024, (y + .5) / size * 1024])
            direction = np.array([np.cos(theta), -np.sin(theta)])
            side = np.array([-direction[1], direction[0]])
            p, q = center - direction * 8, center + direction * 8
            colour = (int(255 * (1 - c)), 255, 40)
            draw.line([tuple(p), tuple(q)], fill=colour, width=2)
            for tip, sign in [(p, -1), (q, 1)]:
                draw.line([tuple(tip - sign * direction * 3 + side * 2), tuple(tip),
                           tuple(tip - sign * direction * 3 - side * 2)], fill=colour, width=1)
    canvas.save(output)


def quantiles(values: np.ndarray):
    return {str(q): float(np.quantile(values, q)) for q in (0, .05, .5, .95, 1)} if values.size else {}


def synthetic_tests(out: Path):
    yy, xx = np.mgrid[:256, :256].astype(np.float32)
    tests = []
    panels = []
    for degrees in [0, 30, 60, 90, 135]:
        angle = np.deg2rad(degrees)
        normal = np.array([np.sin(angle), np.cos(angle)], np.float32)
        phase = 2 * np.pi / 8 * (xx * normal[0] + yy * normal[1])
        xy = .18 * np.sin(phase)[..., None] * normal
        f = line_field(xy, np.ones((256, 256), bool), 64, 12)
        valid = f["confidence"] > 0
        target = np.array([np.cos(2 * angle), np.sin(2 * angle)])
        dot = np.clip(f["cos2theta"][valid] * target[0] + f["sin2theta"][valid] * target[1], -1, 1)
        error = .5 * np.rad2deg(np.arccos(dot))
        tests.append({"test": "sinusoidal normal ridges", "expectedUVAngleDegrees": degrees,
                      "validFraction": float(valid.mean()), "angularErrorDegrees": quantiles(error),
                      "passed": bool(np.quantile(error, .95) < 1)})
        rgb = np.empty((256, 256, 3), np.uint8)
        rgb[..., :2] = np.clip((xy + 1) * 127.5, 0, 255)
        rgb[..., 2] = 250
        name = out / f"synthetic-{degrees}.png"
        arrows(rgb, f, name, 8)
        panels.append(Image.open(name).resize((256, 256)))
    flat = line_field(np.zeros((256, 256, 2), np.float32), np.ones((256, 256), bool), 64, 12)
    tests.append({"test": "flat normal with an arbitrary colour-only boundary", "maximumConfidence": float(flat["confidence"].max()),
                  "passed": bool(np.count_nonzero(flat["confidence"]) == 0), "note": "Albedo never enters the estimator."})
    isotropic = np.stack((.18 * np.sin(xx * 2 * np.pi / 8), .18 * np.sin(yy * 2 * np.pi / 8)), axis=2)
    iso = line_field(isotropic, np.ones((256, 256), bool), 64, 12)
    tests.append({"test": "equal orthogonal ridges are ambiguous", "maximumConfidence": float(iso["confidence"].max()),
                  "passed": bool(np.count_nonzero(iso["confidence"]) == 0)})
    macro = np.zeros((256, 256, 2), np.float32)
    macro[..., 0] = .18 * np.tanh((xx - 128) / 16)
    broad = line_field(macro, np.ones((256, 256), bool), 64, 12)
    tests.append({"test": "broad normal boundary width16px is not a hair ridge", "maximumConfidence": float(broad["confidence"].max()),
                  "passed": bool(np.count_nonzero(broad["confidence"]) == 0)})
    angle = np.deg2rad(30)
    n = np.array([np.sin(angle), np.cos(angle)], np.float32)
    xy = .18 * np.sin(2 * np.pi / 8 * (xx * n[0] + yy * n[1]))[..., None] * n
    reference = line_field(xy, np.ones((256, 256), bool), 64, 12)
    green_sign = line_field(xy * np.array([1, -1], np.float32), np.ones((256, 256), bool), 64, 12)
    sign_error = max(float(np.max(np.abs(reference[k] - green_sign[k]))) for k in ("cos2theta", "sin2theta", "confidence"))
    tests.append({"test": "green-channel sign cannot change a spatial line tensor", "maximumError": sign_error,
                  "passed": sign_error < 1e-6})
    flipped = line_field(xy[::-1].copy(), np.ones((256, 256), bool), 64, 12)
    flip_error = max(float(np.max(np.abs(flipped["cos2theta"] - reference["cos2theta"][::-1]))),
                     float(np.max(np.abs(flipped["sin2theta"] + reference["sin2theta"][::-1]))),
                     float(np.max(np.abs(flipped["confidence"] - reference["confidence"][::-1]))))
    tests.append({"test": "vertical image adapter reverses sin2theta, not green values", "maximumError": flip_error,
                  "passed": flip_error < 1e-5})
    montage = Image.new("RGB", (256 * len(panels), 256))
    for i, panel in enumerate(panels):
        montage.paste(panel, (i * 256, 0))
    montage.save(out / "synthetic-directions.png")
    if not all(t["passed"] for t in tests):
        raise AssertionError(json.dumps(tests, indent=2))
    return tests


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--normal", default="assets/source/user-animal-pack-2026-11-04/norwegian-forest/textures/gltf_embedded_0.png")
    parser.add_argument("--glb", default="public/models/creator/norwegian-cat.glb")
    parser.add_argument("--blender-image", default="artifacts/native-coat-study/source-normal.png")
    parser.add_argument("--out", default="artifacts/native-coat-flow")
    parser.add_argument("--resolution", type=int, default=256)
    args = parser.parse_args()
    source, glb, blender_image, out = Path(args.normal), Path(args.glb), Path(args.blender_image), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    hashes_before = {str(p): sha(p) for p in (source, glb)}
    original = np.asarray(Image.open(source).convert("RGB"))
    embedded, primitives = read_glb(glb)
    # Observed exporter orientation, not a guessed green-channel correction.
    if np.array_equal(original, embedded):
        transform = "identity"
        analysis = original.copy()
    elif np.array_equal(original[::-1], embedded):
        transform = "vertical-flip-only"
        analysis = original[::-1].copy()
    else:
        raise ValueError("Source normal is not pixel-identical to GLB embedded normal under the reviewed vertical adapter")
    if blender_image.exists() and not np.array_equal(np.asarray(Image.open(blender_image).convert("RGB")), analysis):
        raise ValueError("Blender Image_0 pixels disagree with analysis domain")
    mask, triangles = uv_mask(primitives, analysis.shape[1], analysis.shape[0])
    xy = analysis[..., :2].astype(np.float32) * (2 / 255) - 1
    field = line_field(xy, mask, args.resolution)
    synthetic = synthetic_tests(out)
    ready = np.stack([field["cos2theta"], field["sin2theta"], field["confidence"]], axis=2).astype("<f4")
    ready.tofile(out / "blender_uv_ready.bin")
    np.savez_compressed(out / "blender_uv_ready.npz", **field)
    # JSON is a slower but stdlib-only fallback for Blender environments.
    (out / "blender_uv_ready.json").write_text(json.dumps({"shape": list(ready.shape), "data": ready.reshape(-1).round(7).tolist()}))
    arrows(analysis, field, out / "image0-arrow-overlay.png")
    original_field = dict(field)
    if transform == "vertical-flip-only":
        original_field = {key: value[::-1].copy() for key, value in field.items()}
        original_field["sin2theta"] *= -1
    arrows(original, original_field, out / "original-normal-arrow-overlay.png")
    Image.fromarray(np.uint8(np.clip(field["confidence"], 0, 1) * 255)).save(out / "confidence.png")
    Image.fromarray(np.uint8(mask) * 255).resize((args.resolution, args.resolution), Image.Resampling.NEAREST).save(out / "uv-mask.png")
    valid = field["confidence"] > 0
    stats = {"texels": int(valid.size), "knownTexels": int(valid.sum()), "knownFraction": float(valid.mean()),
             "interiorUVTexels": int((field["uv_support"] >= .85).sum()),
             "knownFractionOfInteriorUV": float(valid.sum() / max(1, (field["uv_support"] >= .85).sum())),
             "confidenceKnown": quantiles(field["confidence"][valid]),
             "coherenceInterior": quantiles(field["coherence"][field["uv_support"] >= .85]),
             "maximumUnitDirectorError": float(np.max(np.abs(np.hypot(ready[..., 0][valid], ready[..., 1][valid]) - 1))) if valid.any() else None}
    hashes_after = {str(p): sha(p) for p in (source, glb)}
    metadata = {"schemaVersion": 1, "shape": list(ready.shape), "dtype": "little-endian float32", "layout": "C-contiguous HWC",
                "channels": ["cos(2theta)", "sin(2theta)", "confidence"],
                "binary": "blender_uv_ready.bin", "binarySHA256": sha(out / "blender_uv_ready.bin"),
                "source": {"normalPNG": str(source), "glb": str(glb), "blenderImage0Export": str(blender_image),
                           "hashesBefore": hashes_before, "hashesAfter": hashes_after, "unchanged": hashes_before == hashes_after,
                           "originalPNGToAnalysisImage": transform, "embeddedRGBPixelSHA": hashlib.sha256(analysis.tobytes()).hexdigest(),
                           "greenChannelInverted": False, "sourceMapNegativeYIsNotAppliedToImage": True},
                "coordinates": {"thetaBasis": "Blender UV +u right, +v up; line axis is unoriented +/-",
                                "row0": "top row of Blender Image_0 export and GLB embedded PNG",
                                "texelCenterUV": "u=(column+.5)/W, v=1-(row+.5)/H",
                                "blenderUVToGrid": "x=u*W-.5, y=(1-v)*H-.5",
                                "gltfUVToBlenderUV": "u_blender=u_gltf, v_blender=1-v_gltf",
                                "blenderUVToWebGLBUV": "[u_web,v_web]=[u_blender,1-v_blender]",
                                "worldDirection": "Normalize(dP/du_blender*cos(theta)+dP/dv_blender*sin(theta)); use actual per-face UV Jacobian, which may be stretched/nonorthogonal. Never use textureXY as worldXYZ or assume vertex IDs match.",
                                "wrap": "clamp; confidence is0 beyond the reviewed UV support; do not repeat across islands",
                                "interpolation": "Bilinear interpolate confidence-weighted complex directors (c*cos2,c*sin2,c). Normalize the resulting complex director; reject if confidence<.35 or director cancellation ratio<.65. A global half-angle branch is not a growth-direction sign."},
                "estimator": {"input": "normal XY decoded linearly, no albedo", "method": "Minor eigenvector of spatial structure tensor summed over both high-pass normal XY channels",
                              "normalBandpassSigmaPixels": [.65, 2.5], "tensorIntegrationSigmaPixels": [5, 10], "uvErosionPixels": 24,
                              "confidence": "coherence*energyGate*frequencyGate*scaleAgreementGate; unknown if<.35 or UV interior coverage<.85. Heuristic evidence, not a calibrated probability.",
                              "limitations": ["Cannot distinguish every narrow crease from a fur ridge using normal data alone.", "UV director is not a world-space metric or a growth sign. Transport through local dP/du,dP/dv and choose sign from existing anatomical guides.", "Do not extend a confident field through UV seams or unknown nose/eye/low-texture areas by guessing.", "No new random fur directions and no geometry or source-texture edits."]},
                "skinTrianglesRasterized": triangles, "statistics": stats, "syntheticTests": synthetic}
    (out / "metadata.json").write_text(json.dumps(metadata, indent=2))
    if hashes_before != hashes_after:
        raise AssertionError("Source asset changed")
    print(json.dumps({"output": str(out), "statistics": stats, "syntheticTestsPassed": len(synthetic), "sourceUnchanged": True}, indent=2))


if __name__ == "__main__":
    main()
