"""Read-only native inspection of current and proposed face presets.

Run with Blender 4.5 for norwegian or Blender 3.6 for sphynx, for example:
  Blender --background --factory-startup --disable-autoexec \
    --python scripts/audit-face-presets.py -- norwegian

The blend and model files are read but never saved. Reports contain normalized
bind-space silhouette samples, not a claim of browser art/eye-occlusion approval.
"""
import hashlib
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


ROOT = Path.cwd()
BASE_ID = sys.argv[-1]
if BASE_ID not in ("norwegian", "sphynx"):
    raise ValueError("Choose norwegian or sphynx")
SOURCE = ROOT / "assets" / "authored" / (BASE_ID + "-creator.blend")
SOURCE_SHA = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE), use_scripts=False)
mesh = max(
    (obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.find_armature()),
    key=lambda obj: len(obj.data.vertices),
)
rig = mesh.find_armature()
blocks = mesh.data.shape_keys.key_blocks
base = np.array([tuple(vertex.co) for vertex in blocks["Basis"].data])
deltas = {
    key.name: np.array([tuple(vertex.co) for vertex in key.data]) - base
    for key in blocks if key.name != "Basis"
}
eye_names = (
    ("PantherL_eye", "PantherR_eye") if BASE_ID == "norwegian"
    else ("LeftEyeSkinJnt", "RightEyeSkinJnt")
)
eyes = [rig.data.bones[name].head_local.copy() for name in eye_names]
right = eyes[0] - eyes[1]
right.z = 0
right.normalize()
up = Vector((0, 0, 1))
forward = right.cross(up).normalized()
unit = (eyes[0] - eyes[1]).length
origin = (eyes[0] + eyes[1]) / 2
origin -= forward * (.010 if BASE_ID == "norwegian" else unit * .27)
origin -= up * (.004 if BASE_ID == "norwegian" else unit * .09)
basis = np.array([tuple(right), tuple(forward), tuple(up)])


def local(points):
    # einsum avoids platform-specific BLAS warning paths in bundled Blender.
    return np.einsum("ij,kj->ik", points - np.array(origin), basis) / unit


neutral_local = local(base)
optical_groups = {}
for polygon in mesh.data.polygons:
    material = mesh.data.materials[polygon.material_index]
    if material.get("creatorRole") == "eye-globe":
        optical_groups.setdefault(material.name, set()).update(polygon.vertices)
optical = set().union(*optical_groups.values())
if not optical:
    raise RuntimeError("Native optical geometry missing")
# Static neutral IDs: ear tips and optical surfaces do not determine face width.
face_ids = np.array([
    index for index, point in enumerate(neutral_local)
    if index not in optical and -.9 < point[2] < .65
    and point[1] > -.1 and abs(point[0]) < 2.3
])
muzzle_ids = np.array([index for index in face_ids if neutral_local[index, 2] < .1])
triangles = []
for polygon in mesh.data.polygons:
    for index in range(1, len(polygon.vertices) - 1):
        triangles.append((polygon.vertices[0], polygon.vertices[index], polygon.vertices[index + 1]))
triangles = np.array(triangles, dtype=int)


def normals(points):
    return np.cross(
        points[triangles[:, 1]] - points[triangles[:, 0]],
        points[triangles[:, 2]] - points[triangles[:, 0]],
    )


reference_normals = normals(base)
reliable = np.linalg.norm(reference_normals, axis=1) > 1e-11
presets = {
    "old-round": {"Head_round": 1},
    "natural": {},
    "old-wedge": {"Head_wedge": 1},
    "candidate-round": {
        "Head_round": 1,
        "Shape_headWidth_high": .5,
        "Shape_headDepth_low": .3,
        "Shape_cheeks_high": .6,
        "Shape_jaw_high": .5,
        "Shape_muzzle_low": .4,
        "Shape_muzzleWidth_high": .2,
    },
    "candidate-wedge": {
        "Head_wedge": 1,
        "Shape_headWidth_low": .5,
        "Shape_headDepth_high": .4,
        "Shape_cheeks_low": .5,
        "Shape_jaw_low": .4,
        "Shape_muzzle_high": .6,
        "Shape_muzzleWidth_low": .2,
    },
}
results = []
for label, weights in presets.items():
    points = base.copy()
    for key, weight in weights.items():
        points += deltas[key] * weight
    coords = local(points)
    closed = points + deltas["Blink"]
    for key, weight in weights.items():
        closed += deltas.get("Blink_" + key, np.zeros_like(base)) * weight
    inverted = (np.einsum("ij,ij->i", normals(points), reference_normals) < 0) & reliable
    centered_eye_error = 0
    centered_eye_relative_error = 0
    for ids in optical_groups.values():
        ids = sorted(ids)
        old_eye, new_eye = base[ids], points[ids]
        eye_error = float(np.linalg.norm(
            new_eye - new_eye.mean(0) - old_eye + old_eye.mean(0), axis=1,
        ).max())
        centered_eye_error = max(centered_eye_error, eye_error)
        centered_eye_relative_error = max(centered_eye_relative_error, eye_error / np.ptp(old_eye, axis=0).max())
    finite = bool(np.isfinite(points).all() and np.isfinite(closed).all() and np.isfinite(coords).all())
    results.append({
        "preset": label,
        "weights": weights,
        "faceBandWidth": float(np.quantile(coords[face_ids, 0], .98) - np.quantile(coords[face_ids, 0], .02)),
        "faceBandDepth": float(np.quantile(coords[face_ids, 1], .98) - np.quantile(coords[face_ids, 1], .02)),
        "faceBandHeight": float(np.quantile(coords[face_ids, 2], .98) - np.quantile(coords[face_ids, 2], .02)),
        "muzzleFront95": float(np.quantile(coords[muzzle_ids, 1], .95)),
        "openInvertedTriangles": int(inverted.sum()),
        "finite": finite,
        "blinkGlobeDisplacement": float(np.linalg.norm((closed - points)[sorted(optical)], axis=1).max()),
        "centeredGlobeShapeDifference": centered_eye_error,
        "centeredGlobeRelativeShapeDifference": centered_eye_relative_error,
        "presetGlobeShapeExactlyRigid": centered_eye_error < 1e-6,
    })
    if not finite or inverted.any() or results[-1]["blinkGlobeDisplacement"] > 1e-6:
        print("INVALID_FACE_PRESET_DETAIL " + json.dumps(results[-1]))
        raise RuntimeError("Invalid candidate native state: " + label)
by_id = {row["preset"]: row for row in results}
neutral_width = by_id["natural"]["faceBandWidth"]
summary = {
    "roundVersusNaturalWidthPercent": (by_id["candidate-round"]["faceBandWidth"] / neutral_width - 1) * 100,
    "wedgeVersusNaturalWidthPercent": (by_id["candidate-wedge"]["faceBandWidth"] / neutral_width - 1) * 100,
    "oldRoundToWedgeWidthRatio": by_id["old-round"]["faceBandWidth"] / by_id["old-wedge"]["faceBandWidth"],
    "candidateRoundToWedgeWidthRatio": by_id["candidate-round"]["faceBandWidth"] / by_id["candidate-wedge"]["faceBandWidth"],
}
if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA:
    raise RuntimeError("Authored blend changed during read-only audit")
report = {
    "base": BASE_ID,
    "blender": bpy.app.version_string,
    "source": str(SOURCE.relative_to(ROOT)),
    "sourceSha256": SOURCE_SHA,
    "sourceUnchanged": True,
    "normalization": "Bind-space coordinates divided by native eye-bone distance",
    "nativeEyeDistance": unit,
    "faceSamples": len(face_ids),
    "muzzleSamples": len(muzzle_ids),
    "sampleSelection": "Same neutral vertex IDs for all cases; excludes optical vertices and high ear band. Percentile widths suppress isolated detail outliers.",
    "scope": "Native bind-space geometry only. Open triangle orientation, finite values, measured optical shape drift and Blink globe invariance; browser eye rays, fur, actual final pose and visual review are separate.",
    "opticalShapeCaveat": "Centered globe-shape change is measured separately, not silently treated as rigid. Existing Norwegian width/depth targets can contain slight non-rigid change due to overlapping socket falloffs. Visual and browser eye checks remain required.",
    "results": results,
    "summary": summary,
}
output = ROOT / "artifacts/face-preset-refinement/verification"
output.mkdir(parents=True, exist_ok=True)
(output / (BASE_ID + "-geometry-candidate.json")).write_text(json.dumps(report, indent=2))
print("FACE_PRESET_AUDIT " + json.dumps({"base": BASE_ID, "summary": summary, "nativeFiniteOrientationAndBlinkChecksPassed": True, "maxCenteredGlobeRelativeShapeDifference": max(row["centeredGlobeRelativeShapeDifference"] for row in results)}))
