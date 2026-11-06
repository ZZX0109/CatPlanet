"""Reopen original/variant and compare cat data independently of the color builder."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy

root = Path(__file__).resolve().parents[1]
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--report", default=str(root / "artifacts/orange-cat-study/build-report.json"))
args = parser.parse_args(argv)
report_path = Path(args.report)
build = json.loads(report_path.read_text())


def digest(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def mechanics():
    result = {"meshes": {}, "rigs": {}, "hair": {}, "actions": {}, "otherMaterials": {}}
    for obj in bpy.data.objects:
        if obj.get("miaoxing_preview_stage"): continue
        if obj.type == "MESH":
            data = obj.data
            result["meshes"][obj.name] = digest({
                "vertices": [tuple(v.co) for v in data.vertices],
                "faces": [tuple(p.vertices) for p in data.polygons],
                "uv": {layer.name: [tuple(v.uv) for v in layer.data] for layer in data.uv_layers},
                "groups": [group.name for group in obj.vertex_groups],
                "weights": [[(group.group, group.weight) for group in v.groups] for v in data.vertices],
                "shapes": {key.name: [tuple(v.co) for v in key.data] for key in data.shape_keys.key_blocks} if data.shape_keys else {},
            })
            for ps in obj.particle_systems:
                settings = ps.settings
                result["hair"][obj.name + ":" + ps.name] = digest({
                    "guides": [(tuple(p.location), p.size, [tuple(key.co_local) for key in p.hair_keys]) for p in ps.particles],
                    "count": settings.count, "length": settings.hair_length,
                    "children": settings.rendered_child_count, "material": settings.material,
                    "densityGroup": ps.vertex_group_density, "lengthGroup": ps.vertex_group_length,
                })
        if obj.type == "ARMATURE":
            result["rigs"][obj.name] = digest([(b.name, b.parent.name if b.parent else None, [tuple(row) for row in b.matrix_local]) for b in obj.data.bones])
    for action in bpy.data.actions:
        result["actions"][action.name] = digest([(curve.data_path, curve.array_index, [(tuple(k.co), tuple(k.handle_left), tuple(k.handle_right), k.interpolation) for k in curve.keyframe_points]) for curve in action.fcurves])
    for mat in bpy.data.materials:
        if mat.name == "GreyTabbyCat_Body_Skin" or mat.name.startswith("GreyTabbyCat_Hair_") and "Beard" not in mat.name:
            continue
        if not mat.node_tree: continue
        nodes = []
        for node in mat.node_tree.nodes:
            values = []
            for socket in node.inputs:
                value = getattr(socket, "default_value", None)
                try: value = list(value)
                except TypeError: pass
                values.append((socket.name, value))
            nodes.append((node.name, node.bl_idname, values, getattr(getattr(node, "image", None), "name", None)))
        links = [(l.from_node.name, l.from_socket.name, l.to_node.name, l.to_socket.name) for l in mat.node_tree.links]
        result["otherMaterials"][mat.name] = digest({"nodes": nodes, "links": links})
    return result


bpy.ops.wm.open_mainfile(filepath=build["source"], use_scripts=False)
source = mechanics()
bpy.ops.wm.open_mainfile(filepath=build["output"], use_scripts=False)
variant = mechanics()
# A preview floor material is new, rather than a modification of the cat.
checks = {}
for category in source:
    checks[category + "Match"] = all(variant[category].get(name) == value for name, value in source[category].items())
checks["originalFileUnchanged"] = hashlib.sha256(Path(build["source"]).read_bytes()).hexdigest() == build["sourceSha256"]
palette = bpy.data.node_groups.get("Miaoxing Orange Tabby Palette")
checks["orangeEnabledOnReopen"] = palette is not None and palette.nodes["Orange amount"].outputs[0].default_value == 1
missing = []
for image in bpy.data.images:
    if not image.users or not image.filepath or image.source not in {"FILE", "TILED"}: continue
    if image.packed_file or len(image.packed_files): continue
    filepath = bpy.path.abspath(image.filepath)
    paths = [filepath.replace("<UDIM>", str(tile.number)) for tile in image.tiles] if image.source == "TILED" else [filepath]
    missing.extend(p for p in paths if not Path(p).exists())
checks["textureDependenciesAvailable"] = not missing
result = {"checks": checks, "allPassed": all(checks.values()), "source": build["source"], "variant": build["output"], "originalCounts": {key: len(value) for key, value in source.items()}, "missingImages": missing, "comparison": "Original cat meshes, faces, UVs, weights, shape keys, rest bones, action curves, native guides and non-coat materials"}
report_path.with_name("verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
print("ORANGE_VARIANT_VERIFIED", result["allPassed"], checks, flush=True)
if not result["allPassed"]: raise RuntimeError("Orange variant verification failed")
