"""Make a reversible orange coat variant of the local Grey Tabby Blender asset.

Run with Blender 4.5, --disable-autoexec, and the source .blend already opened.
Only color-node links are changed. Existing fur guides, masks, rig and UV stay.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
argsv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--output", default=str(ROOT / "assets/authored/orange-tabby-short.blend"))
parser.add_argument("--report", default=str(ROOT / "artifacts/orange-cat-study/build-report.json"))
args = parser.parse_args(argsv)
source = Path(bpy.data.filepath).resolve()
output = Path(args.output).resolve()
if source == output:
    raise RuntimeError("Use a separate output file; the original model must be preserved")
if bpy.data.node_groups.get("Miaoxing Orange Tabby Palette"):
    raise RuntimeError("Open the original grey source when rebuilding the orange variant")
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()


def signature():
    report = {"meshes": {}, "rigs": {}, "hair": {}, "actions": {}}
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            h = hashlib.sha256()
            for v in obj.data.vertices:
                h.update(repr(tuple(v.co)).encode())
            uv = hashlib.sha256()
            for layer in obj.data.uv_layers:
                for loop in layer.data:
                    uv.update(repr(tuple(loop.uv)).encode())
            report["meshes"][obj.name] = {"vertices": len(obj.data.vertices), "positions": h.hexdigest(), "uv": uv.hexdigest()}
            for ps in obj.particle_systems:
                guide_hash = hashlib.sha256()
                for particle in ps.particles:
                    guide_hash.update(repr((tuple(particle.location), particle.size)).encode())
                    for key in particle.hair_keys:
                        guide_hash.update(repr(tuple(key.co_local)).encode())
                report["hair"][obj.name + ":" + ps.name] = {
                    "particles": len(ps.particles), "guides": guide_hash.hexdigest(),
                    "children": ps.settings.rendered_child_count,
                    "material": ps.settings.material,
                }
        if obj.type == "ARMATURE":
            report["rigs"][obj.name] = len(obj.data.bones)
    for action in bpy.data.actions:
        report["actions"][action.name] = list(action.frame_range)
    return report

before = signature()


def rgba(hex_value):
    values = [int(hex_value[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values) + (1.0,)


group = bpy.data.node_groups.new("Miaoxing Orange Tabby Palette", "ShaderNodeTree")
group.interface.new_socket(name="Original coat", in_out="INPUT", socket_type="NodeSocketColor")
group.interface.new_socket(name="Preserve pink skin", in_out="INPUT", socket_type="NodeSocketFloat")
group.interface.new_socket(name="Coat color", in_out="OUTPUT", socket_type="NodeSocketColor")
nodes, links = group.nodes, group.links
input_node = nodes.new("NodeGroupInput"); input_node.location = (-700, 80)
output_node = nodes.new("NodeGroupOutput"); output_node.location = (650, 80)
amount = nodes.new("ShaderNodeValue"); amount.name = "Orange amount"; amount.label = "橘色程度 · 0 原色 / 1 橘猫"; amount.outputs[0].default_value = 1
amount.location = (160, -240)
luma = nodes.new("ShaderNodeRGBToBW"); luma.location = (-480, 180)
links.new(input_node.outputs[0], luma.inputs[0])
palette = nodes.new("ShaderNodeValToRGB"); palette.name = "Ginger pigments"; palette.label = "深橘条纹 → 金橘底毛 → 奶油色浅毛"; palette.location = (-220, 180)
ramp = palette.color_ramp
ramp.interpolation = "LINEAR"
colors = [(0.0, "8f4c1d"), (.02, "b9712c"), (.08, "d99543"), (.25, "edb66d"), (.6, "f6d6a5"), (1.0, "fff3de")]
ramp.elements.remove(ramp.elements[1])
for i, (position, color) in enumerate(colors):
    element = ramp.elements[0] if i == 0 else ramp.elements.new(position)
    element.position = position; element.color = rgba(color)
links.new(luma.outputs[0], palette.inputs[0])
# Pink nose/ear skin is retained rather than converted to fur pigment.
channels = nodes.new("ShaderNodeSeparateRGB"); channels.location = (-480, -160)
links.new(input_node.outputs[0], channels.inputs[0])

def math_node(operation, a=None, b=None, label=""):
    node = nodes.new("ShaderNodeMath"); node.operation = operation; node.label = label
    for index, value in enumerate((a, b)):
        if value is None: continue
        if isinstance(value, (float, int)): node.inputs[index].default_value = value
        else: links.new(value, node.inputs[index])
    return node.outputs[0]

pink = math_node("MULTIPLY", math_node("GREATER_THAN", channels.outputs[0], math_node("MULTIPLY", channels.outputs[1], 1.5)), input_node.outputs[1], "保留鼻子与耳内粉色")
protect = nodes.new("ShaderNodeMixRGB"); protect.blend_type = "MIX"; protect.location = (100, 100)
links.new(pink, protect.inputs[0]); links.new(palette.outputs[0], protect.inputs[1]); links.new(input_node.outputs[0], protect.inputs[2])
blend = nodes.new("ShaderNodeMixRGB"); blend.blend_type = "MIX"; blend.location = (400, 80)
links.new(amount.outputs[0], blend.inputs[0]); links.new(input_node.outputs[0], blend.inputs[1]); links.new(protect.outputs[0], blend.inputs[2])
links.new(blend.outputs[0], output_node.inputs[0])
# Arrange the mask math so the shared palette remains editable.
index = 0
for node in nodes:
    if node.bl_idname == "ShaderNodeMath":
        node.location = (-200 + index % 3 * 155, -360 - index // 3 * 140)
        index += 1

changed = []
for mat in bpy.data.materials:
    is_coat = mat.name == "GreyTabbyCat_Body_Skin" or mat.name.startswith("GreyTabbyCat_Hair_")
    if not is_coat or "Beard" in mat.name or not mat.use_nodes:
        continue
    tree = mat.node_tree
    for shader in list(tree.nodes):
        if shader.bl_idname == "ShaderNodeBsdfHairPrincipled":
            name = "Tint" if shader.parametrization == "MELANIN" else "Color"
        elif shader.bl_idname == "ShaderNodeBsdfHair" or shader.bl_idname == "ShaderNodeBsdfDiffuse":
            name = "Color"
        elif shader.bl_idname == "ShaderNodeBsdfPrincipled":
            name = "Base Color"
        else:
            continue
        target = shader.inputs.get(name)
        if target is None or not target.is_linked: continue
        original = target.links[0].from_socket
        transfer = tree.nodes.new("ShaderNodeGroup"); transfer.node_tree = group
        transfer.name = "Miaoxing orange: " + shader.name
        transfer.label = "橘猫配色 · 保留原条纹与毛色细节"
        transfer.location = (shader.location.x - 210, shader.location.y)
        transfer.inputs[1].default_value = 1 if mat.name == "GreyTabbyCat_Body_Skin" else 0
        tree.links.new(original, transfer.inputs[0])
        tree.links.new(transfer.outputs[0], target)
        changed.append({"material": mat.name, "shader": shader.name, "input": name, "connections": 1})

if not changed:
    raise RuntimeError("No compatible Grey Tabby coat textures found")

after = signature()
if before != after:
    raise RuntimeError("Unexpected geometry, UV, fur or rig change")
# Absolute texture paths keep the independent copy usable from its new folder.
for image in bpy.data.images:
    if image.filepath:
        image.filepath = bpy.path.abspath(image.filepath)
bpy.context.scene["miaoxing_coat_variant"] = "orange-tabby-v1"
bpy.context.scene["miaoxing_coat_source"] = str(source)
bpy.context.scene["miaoxing_coat_notes"] = "原灰虎斑的橘色配色副本；条纹位置不变，原骨架、毛束与动作保留。"
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(output))
if hashlib.sha256(source.read_bytes()).hexdigest() != source_hash:
    raise RuntimeError("The original source file changed")
report = {"source": str(source), "sourceSha256": source_hash, "output": str(output), "variant": "orange-tabby-v1", "materialChanges": changed,
          "originalUnchanged": True, "structureUnchanged": before == after, "structure": before,
          "pattern": "Original UV markings retained; grey pigments remapped to ginger, pink skin masked out",
          "limitations": ["Blender material variant; not a new breed or new stripe layout", "Not converted or published as a web asset"]}
report_path = Path(args.report); report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
print("ORANGE_TABBY_SAVED", str(output), "color branches:", len(changed), flush=True)
