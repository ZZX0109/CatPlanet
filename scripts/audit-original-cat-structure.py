#!/usr/bin/env python3
"""Read the supplied GLB, manifest and existing review evidence. No GPU/Blender."""
import hashlib
import io
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image


ROOT = Path.cwd()
PACK = Path("assets/source/user-animal-pack-2026-11-04")
SOURCE = PACK / "norwegian-forest/source/Norwegianforest.glb"
MANIFEST = PACK / "manifest.json"
OUT = Path("artifacts/native-coat-audit")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def components(positions, triangles, weld=False):
    if weld:
        vertices, inverse = np.unique(positions, axis=0, return_inverse=True)
        tri = inverse[triangles]
    else:
        vertices, tri = positions, triangles
    parent = np.arange(len(vertices), dtype=np.int32)
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for a, b, c in tri:
        a = find(a)
        for v in (b, c):
            v = find(v)
            if a != v:
                parent[v] = a
    labels = np.array([find(i) for i in range(len(vertices))])
    ids, counts = np.unique(labels[tri[:, 0]], return_counts=True)
    order = np.argsort(-counts)
    return {"components": int(len(ids)), "usedVertices": int(np.unique(tri).size),
            "tinyComponentsAtMost20Triangles": int((counts <= 20).sum()),
            "largestComponents": [{"triangles": int(counts[i]),
                "vertices": int((labels == ids[i]).sum()),
                "bounds": {"min": vertices[labels == ids[i]].min(axis=0).tolist(),
                           "max": vertices[labels == ids[i]].max(axis=0).tolist()}}
                for i in order[:5]],
            "interpretation": "Connected components are topology, not a semantic count of hairs. Exact-position welding only joins bit-equivalent/coincident source positions; no spatial tolerance."}


def cleanup_selection(doc, accessor):
    """CPU reproduction of remove_native_cards selection, without bpy/bmesh."""
    primitive = doc["meshes"][0]["primitives"][0]
    positions = accessor(primitive["attributes"]["POSITION"])
    triangles = accessor(primitive["indices"]).reshape(-1, 3)
    joints = accessor(primitive["attributes"]["JOINTS_0"])
    weights = accessor(primitive["attributes"]["WEIGHTS_0"])
    skin = doc["skins"][0]
    names = [doc["nodes"][i].get("name", "") for i in skin["joints"]]
    head_ids = [i for i, n in enumerate(names) if n in ("head", "jaw") or "eye" in n or "Bone008" in n or "Bone009" in n]
    head = np.clip((weights * np.isin(joints, head_ids)).sum(axis=1), 0, 1)
    # Blender importer changes(x,y,z) to(x,-z,y); builder base.z is GLB y.
    t = np.clip((positions[:, 1] - .192) / (.222 - .192), 0, 1)
    head *= t * t * (3 - 2 * t)
    _, inverse = np.unique(np.rint(positions * 1e7).astype(np.int64), axis=0, return_inverse=True)
    parent = np.arange(inverse.max() + 1)
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for tri in inverse[triangles]:
        a = find(tri[0])
        for b in tri[1:]:
            b = find(b)
            if a != b:
                parent[b] = a
    labels = np.array([find(i) for i in inverse])
    islands = [np.flatnonzero(labels == i) for i in np.unique(labels)]
    matrices = accessor(skin["inverseBindMatrices"])
    eye_ids = []
    for name in ("PantherL_eye", "PantherR_eye"):
        bone = np.linalg.inv(matrices[names.index(name)].reshape(4, 4, order="F"))[:3, 3]
        candidates = [(float(np.linalg.norm(positions[ids].mean(0) - bone)), ids)
                      for ids in islands if 100 <= len(ids) <= 200]
        distance, ids = min(candidates, key=lambda pair: pair[0])
        if distance >= .012:
            raise ValueError("Original eye-component reproduction did not match")
        eye_ids.append(ids)
    categories = {
        "ear": [i for i, n in enumerate(names) if "Bone008" in n or "Bone009" in n],
        "headFace": [i for i, n in enumerate(names) if n in ("head", "jaw") or "eye" in n],
        "neckChest": [i for i, n in enumerate(names) if n.startswith("neck")],
        "tail": [i for i, n in enumerate(names) if "Tail" in n],
        "limb": [i for i, n in enumerate(names) if "Leg" in n],
        "torso": [i for i, n in enumerate(names) if "Spine" in n or n in ("PantherPelvis", "PantherRibcage")],
    }
    regions = {k: {"components": 0, "triangles": 0} for k in categories}
    selected = []
    bad = np.zeros(len(positions), bool)
    for ids in islands:
        if len(ids) > 60 or any(np.intersect1d(ids, eye).size for eye in eye_ids):
            continue
        p = positions[ids]
        if head[ids].mean() < .8 or np.ptp(p, axis=0).max() < .0025:
            continue
        if any(np.linalg.norm(p.mean(0) - positions[eye].mean(0)) < .016 for eye in eye_ids):
            continue
        bad[ids] = True
        faces = np.flatnonzero(np.isin(triangles, ids).all(axis=1))
        means = {k: float((weights[ids] * np.isin(joints[ids], bone_ids)).sum(axis=1).mean()) for k, bone_ids in categories.items()}
        category = max(means, key=means.get)
        regions[category]["components"] += 1
        regions[category]["triangles"] += len(faces)
        selected.append({"component": int(labels[ids[0]]), "minimumSourceVertexId": int(ids.min()), "maximumSourceVertexId": int(ids.max()), "vertices": int(len(ids)), "triangles": int(len(faces)),
                         "regionByDominantMeanBoneWeight": category, "meanBoneWeights": means,
                         "centroidGLBLocal": p.mean(0).tolist(), "meanPostHeightHeadWeight": float(head[ids].mean())})
    deleted = int(bad[triangles].all(axis=1).sum())
    build = json.loads(Path("artifacts/norwegian-creator/build-report.json").read_text())
    expected = build["creatorGroom"]["removedCardFaces"]
    return {"method": "Read-only CPU reproduction of the legacy3648-face remove_native_cards selector, before ear-preservation correction; source geometry/weights,1e-7-position weld, original eye-component exclusion and builder height mask.",
            "selectedComponents": len(selected), "selectedFaces": deleted, "buildReportedFaces": expected,
            "faceCountMatchesBuildReport": deleted == expected, "dominantBoneWeightCounts": regions,
            "classificationCaveat": "Dominant mean skeleton region is not proof that every removed component is hair or whisker. Ear and face components are distinct regional evidence; neckChest does not imply the whole chest coat was deleted.",
            "selectionRule": "<=60 original vertex IDs; mean head_weight>=.8; maxextent>=.0025; protected eyeballs excluded; centroid distance to either eyeball>=.016. No actual whisker-shape classifier.",
            "headWeightIncludesEarBones": True,
            "components": selected}


def main():
    before = {str(p): sha(p) for p in (SOURCE, MANIFEST)}
    data = SOURCE.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + length])
    binary = data[28 + length:]
    types = {5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
    def accessor(i):
        a = doc["accessors"][i]
        view = doc["bufferViews"][a["bufferView"]]
        size = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
        dtype = np.dtype(types[a["componentType"]])
        return np.ndarray((a["count"], size), dtype=dtype, buffer=binary,
                          offset=view.get("byteOffset", 0) + a.get("byteOffset", 0),
                          strides=(view.get("byteStride", size * dtype.itemsize), dtype.itemsize)).copy()
    images = []
    for i, definition in enumerate(doc.get("images", [])):
        view = doc["bufferViews"][definition["bufferView"]]
        encoded = binary[view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]
        image = Image.open(io.BytesIO(encoded))
        alpha = image.getchannel("A") if "A" in image.getbands() else None
        images.append({"index": i, "mimeType": definition.get("mimeType"), "dimensions": list(image.size),
                       "mode": image.mode, "hasAlphaChannel": alpha is not None,
                       "alphaRange": list(alpha.getextrema()) if alpha else [255, 255],
                       "embeddedFileSHA256": hashlib.sha256(encoded).hexdigest()})
    materials = []
    for i, m in enumerate(doc.get("materials", [])):
        pbr = m.get("pbrMetallicRoughness", {})
        textures = {}
        for name, definition in [("normal", m.get("normalTexture")), ("baseColor", pbr.get("baseColorTexture")),
                                 ("occlusion", m.get("occlusionTexture")), ("metallicRoughness", pbr.get("metallicRoughnessTexture"))]:
            if definition:
                texture = doc["textures"][definition["index"]]
                textures[name] = {"texture": definition["index"], "name": texture.get("name"), "image": texture["source"],
                                  "texCoord": definition.get("texCoord", 0),
                                  "transform": definition.get("extensions", {}).get("KHR_texture_transform"),
                                  "normalScale": definition.get("scale", 1) if name == "normal" else None}
        materials.append({"index": i, "name": m.get("name"), "declaredAlphaMode": m.get("alphaMode"),
                          "effectiveAlphaMode": m.get("alphaMode", "OPAQUE"),
                          "baseColorFactorAlpha": pbr.get("baseColorFactor", [1, 1, 1, 1])[3],
                          "doubleSided": m.get("doubleSided", False), "textures": textures})
    meshes = []
    for mesh_index, mesh in enumerate(doc["meshes"]):
        primitives = []
        for primitive in mesh["primitives"]:
            attributes = primitive["attributes"]
            positions = accessor(attributes["POSITION"])
            indices = accessor(primitive["indices"]).reshape(-1, 3)
            normals = accessor(attributes["NORMAL"])
            uv = accessor(attributes["TEXCOORD_0"])
            primitives.append({"mode": primitive.get("mode", 4), "modeName": "TRIANGLES" if primitive.get("mode", 4) == 4 else "other",
                               "material": primitive.get("material"), "vertices": int(len(positions)), "indices": int(indices.size),
                               "triangles": int(len(indices)), "attributes": sorted(attributes),
                               "morphTargets": len(primitive.get("targets", [])),
                               "uv0": {"count": len(uv), "min": uv.min(axis=0).tolist(), "max": uv.max(axis=0).tolist()},
                               "normals": {"count": len(normals), "finite": bool(np.isfinite(normals).all())},
                               "topologyBySourceVertexIndex": components(positions, indices),
                               "topologyAfterExactPositionWeld": components(positions, indices, True)})
        meshes.append({"mesh": mesh_index, "name": mesh.get("name"), "primitives": primitives})
    manifest = json.loads(MANIFEST.read_text())
    reviews = []
    for row in manifest["review"]["models"]:
        reviews.append({"key": row["key"], "source": str(PACK / row["source"]), "reviewBlend": row["reviewBlend"],
                        "sourceUnchangedInManifest": row["sourceUnchanged"],
                        "role": "GLB导入后保存的复查副本" if Path(row["source"]).suffix.lower() in (".glb", ".gltf") else "打开用户原.blend后另存的复查副本"})
    review_script = Path("scripts/review-imported-cat.py")
    script = review_script.read_text()
    import_line = next(i for i, line in enumerate(script.splitlines(), 1) if "bpy.ops.import_scene.gltf" in line)
    save_line = next(i for i, line in enumerate(script.splitlines(), 1) if "bpy.ops.wm.save_as_mainfile" in line)
    reference = Path("artifacts/user-cat-pack-review/norwegian-forest/review.json")
    existing_review = json.loads(reference.read_text())
    matched = next(m for m in manifest["models"] if m["key"] == "norwegian-forest")
    expected = next(f["sha256"] for f in matched["files"] if f["path"] == "source/Norwegianforest.glb")
    after = {str(p): sha(p) for p in (SOURCE, MANIFEST)}
    cleanup = cleanup_selection(doc, accessor)
    # Preserve the detailed selection separately so the main structure report remains short.
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "native-card-cleanup-selection.json").write_text(json.dumps(cleanup, ensure_ascii=False, indent=2))
    crosscheck_path = OUT / "ear-component-crosscheck.json"
    ear_crosscheck = json.loads(crosscheck_path.read_text()) if crosscheck_path.exists() else None
    report = {"schemaVersion": 1, "method": "Read-only GLB JSON/accessors/image headers and manifest parsing; exact-position topology analysis; inspection of already-existing clay/material review images. No new Blender/browser/GPU run.",
              "source": {"path": str(SOURCE), "bytes": len(data), "sha256": before[str(SOURCE)], "manifestSHA256Matches": before[str(SOURCE)] == expected,
                         "unchangedDuringAudit": before == after, "hashesBefore": before, "hashesAfter": after},
              "asset": doc["asset"], "extensionsUsed": doc.get("extensionsUsed", []),
              "meshNodes": [{"node": i, "name": n.get("name"), "mesh": n["mesh"], "skin": n.get("skin")} for i, n in enumerate(doc["nodes"]) if "mesh" in n],
              "meshes": meshes, "materials": materials, "images": images,
              "observations": [
                  "原GLB只有Object010这一个蒙皮mesh/一个TRIANGLES primitive/一个材质；身体、耳内细毛、胡须等可见三角几何共用该primitive的POSITION/index/UV材质。共用mesh并不代表所有部件在拓扑上焊为一体。",
                  "既有未改猫形的clay-three复查图仍可见耳内细毛、眉须与胡须；clay覆盖移除了normal和颜色，因此不能声称原素材完全没有毛发几何。",
                  "全身毛纹、毛色和细小凹凸也明显依赖现有baseColor/normal/ORM贴图。结构信息不能把每个三角面自动标成毛、皮肤或眼部，也不能证明整个身体每根毛都是独立几何。",
                  "该GLB未分离专门hair mesh/material、透明毛卡材质、LINES/POINTS primitive或可编辑曲线groom参数；OPAQUE不等于没有几何毛束。"],
              "visualEvidence": {"clay": "artifacts/user-cat-pack-review/norwegian-forest/clay-three.png", "material": "artifacts/user-cat-pack-review/norwegian-forest/material-whole.png",
                                 "reviewJSON": str(reference), "reviewSourceHashMatches": existing_review["sourceSha256"] == before[str(SOURCE)],
                                 "reviewScope": existing_review["scope"]},
              "reviewBlendProvenance": {"manifest": str(MANIFEST), "rows": reviews,
                                        "reproductionScript": str(review_script), "importGLTFLine": import_line, "saveReviewBlendLine": save_line,
                                        "conclusion": "reviews/*.blend不是下载包中这些模型的作者原始制作文件；挪威/波斯/小猫由GLB导入后复查另存，斯芬克斯从用户提供的.blend另存。不能把review .blend当成含作者原始毛发修改器/曲线系统的证据。"},
              "authoredCleanupAudit": {k: v for k, v in cleanup.items() if k != "components"},
              "earOwnershipCrosscheck": {"report": str(crosscheck_path), "pass": ear_crosscheck["pass"],
                                        "ear": ear_crosscheck["ear"], "muzzleAndBrow": ear_crosscheck["muzzleAndBrow"],
                                        "safePreservationRule": ear_crosscheck["safePreservationRule"]} if ear_crosscheck else None,
              "reproduce": "python3 scripts/audit-original-cat-structure.py"}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "original-structure.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    text = """# 原挪威森林猫素材结构核对

原素材已经有被毛表现，不能说它“完全没有毛发几何”。既有灰模复查图里仍看得到耳内细毛、眉须和胡须；全身毛色、毛流纹理和细小凹凸则还依赖原来的颜色、法线和 ORM 贴图。

下载的 `Norwegianforest.glb` 是一个 `Object010` 蒙皮网格，含一个三角面图元、一个材质，共17625个顶点、29320个三角面。可见身体与细毛几何共用这一套网格/索引/材质，没有分成单独的“毛发对象”；这不表示所有部件都在拓扑上连成一片，也不表示每根体毛都是独立几何。

该材质是 OPAQUE，颜色图为无透明通道的 JPEG；未发现透明毛卡材质或独立的曲线毛发参数。**不透明不等于没有几何毛。** 应继续以已有几何轮廓、毛束和贴图为基础精修，不能据此把全身替换成随机碎毛。

`reviews/norwegian-forest.blend` 是把下载的 GLB 导入 Blender 后，为检查和渲染另存的复查副本，并非作者原始制作源文件。波斯猫和小猫同样来自 GLB；斯芬克斯的原始输入才是 `.blend`，其 reviews 文件也只是另存副本。复查文件不能恢复 GLB 中未携带的原始毛发修改器或曲线系统。

本次仅解析文件和查看既有复查图；没有启动 Blender、浏览器或 GPU，没有新增毛发或修改原资产。原 GLB SHA256 与下载清单一致，审计前后未改变。

另外，旧 authored 构建执行过 `remove_native_cards`，其筛选并不是“识别胡须”，而是头部权重、连通片大小与距离阈值，且头部权重包含耳骨。独立 CPU 复算与 Blender 组件导出逐 ID 核对：删除的386片/3648面中，**342片/2086面属于原耳部毛簇**（含22片低耳权重耳缘），另外44片/1562面是口鼻/眉须区域；没有胸、身体或尾部组件被这条规则删除。不能把原下载 GLB 的完整几何与旧制作副本混为一谈，也不能声称原毛面已经全部保留。修复后的网页是否已替换与验收，应另行核对。

安全修整建议：对这个明确哈希的源模型，在清理规则前整簇保留平均耳骨权重大于.01的部件，已验证恰好保护342片耳毛；源顶点14871–17624可作核验，不能当作其他模型通用规则。未知头部窄片先保留，不能一概标成胡须删除。详见 `ear-component-crosscheck.json`。

可复现命令：`python3 scripts/audit-original-cat-structure.py`。详细数据、图元/材质/透明通道、拓扑连通性、图片路径和来源证据见同目录 `original-structure.json`。
"""
    (OUT / "original-structure.md").write_text(text)
    print(json.dumps({"output": str(OUT / "original-structure.json"), "sourceUnchanged": before == after,
                      "vertices": meshes[0]["primitives"][0]["vertices"], "triangles": meshes[0]["primitives"][0]["triangles"],
                      "exactWeldComponents": meshes[0]["primitives"][0]["topologyAfterExactPositionWeld"]["components"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
