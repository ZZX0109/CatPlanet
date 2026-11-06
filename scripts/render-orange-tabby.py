"""Same-camera Cycles previews of the actual orange .blend, with grey control."""
import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

root = Path(__file__).resolve().parents[1]
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--output", default=str(root / "artifacts/orange-cat-study/preview"))
parser.add_argument("--resolution", type=int, default=640)
parser.add_argument("--samples", type=int, default=16)
parser.add_argument("--views", default="three,face")
parser.add_argument("--compare", action="store_true")
parser.add_argument("--save-stage", action="store_true", help="Save preview lighting and camera into the orange copy")
args = parser.parse_args(argv)
out = Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
scene.frame_set(0)
scene.render.engine = "CYCLES"
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 8
scene.render.resolution_x = args.resolution
scene.render.resolution_y = args.resolution
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.use_compositing = False
scene.render.use_sequencer = False
scene.render.use_border = False
scene.render.use_motion_blur = False
scene.use_nodes = False
scene.view_settings.view_transform = "AgX"
try:
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    devices = []
    for device in preferences.devices:
        device.use = device.type == "METAL"
        if device.use: devices.append(device.name)
    scene.cycles.device = "GPU" if devices else "CPU"
    print("RENDER_DEVICES", devices, flush=True)
except Exception:
    scene.cycles.device = "CPU"
for obj in list(bpy.data.objects):
    if obj.get("miaoxing_preview_stage"):
        bpy.data.objects.remove(obj, do_unlink=True)
for obj in bpy.data.objects:
    if obj.name.startswith("CTR_") or obj.type == "ARMATURE": obj.hide_render = True
world = bpy.data.worlds.new("Orange review world"); world.use_nodes = True; scene.world = world
world.node_tree.nodes["Background"].inputs[0].default_value = (.61, .63, .65, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = .25
floor_mat = bpy.data.materials.new("Orange review floor"); floor_mat.diffuse_color = (.72, .69, .64, 1)
bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, -.007))
bpy.context.object.name = "Orange review floor"
bpy.context.object["miaoxing_preview_stage"] = True
bpy.context.object.data.materials.append(floor_mat)
for name, location, energy, size in [("Key", (.32, -.38, .7), 3.5, .42), ("Fill", (-.4, -.1, .5), 1.6, .5), ("Rim", (.18, .4, .65), 2.5, .35)]:
    data = bpy.data.lights.new("Orange review " + name, "AREA"); data.energy = energy; data.shape = "DISK"; data.size = size
    obj = bpy.data.objects.new(data.name, data); scene.collection.objects.link(obj); obj.location = location
    obj["miaoxing_preview_stage"] = True
    obj.rotation_euler = (Vector((0, 0, .18)) - obj.location).to_track_quat("-Z", "Y").to_euler()
data = bpy.data.cameras.new("Orange review camera")
camera = bpy.data.objects.new(data.name, data); scene.collection.objects.link(camera); scene.camera = camera
camera["miaoxing_preview_stage"] = True
camera.data.type = "ORTHO"; camera.data.dof.use_dof = False
views = {
    "three": ((.46, -.65, .36), (0, 0, .18), .60),
    "front": ((0, -.75, .28), (0, -.02, .17), .51),
    "side": ((.75, -.03, .30), (0, 0, .17), .57),
    "face": ((.12, -.43, .27), (0, -.19, .22), .18),
}
palette = bpy.data.node_groups.get("Miaoxing Orange Tabby Palette")
if palette is None: raise RuntimeError("Open the orange variant .blend")
amount = palette.nodes["Orange amount"].outputs[0]
if args.save_stage:
    location, target, scale = views["three"]
    camera.location = location
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = scale
    amount.default_value = 1
    scene.render.filepath = str(out / "orange-three.png")
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
outputs = []
for variant in (["orange", "grey-control"] if args.compare else ["orange"]):
    amount.default_value = 1 if variant == "orange" else 0
    for name in args.views.split(","):
        location, target, scale = views[name]
        camera.location = location
        camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera.data.ortho_scale = scale
        scene.render.filepath = str(out / f"{variant}-{name}.png")
        print("COLOR_RENDER_START", variant, name, flush=True)
        bpy.ops.render.render(write_still=True)
        outputs.append(scene.render.filepath)
        print("COLOR_RENDER_DONE", variant, name, flush=True)
(out / "render-report.json").write_text(json.dumps({"blend": bpy.data.filepath, "engine": scene.render.engine, "samples": args.samples, "resolution": args.resolution, "views": args.views, "pairedLightingAndCamera": args.compare, "outputs": outputs}, indent=2))
