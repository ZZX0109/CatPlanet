"""Create a lightweight static review copy of the CC0 cat; never edits its source."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Matrix, Vector

root = Path.cwd()
source = root / "assets/source/grab-tabby-cat/cat.glb"
destination = root / "public/models/review/tabby-web.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for obj in meshes:
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(world)
    obj.matrix_world = Matrix.Identity(4)

before = sum(len(o.data.polygons) for o in meshes)
for obj in meshes:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.calc_loop_triangles()
    triangles = len(obj.data.loop_triangles)
    if triangles > 60_000:
        modifier = obj.modifiers.new("Web review detail", "DECIMATE")
        modifier.ratio = 60_000 / triangles
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for face in obj.data.polygons:
        face.use_smooth = True

points = [o.matrix_world @ Vector(corner) for o in meshes for corner in o.bound_box]
low = Vector([min(p[i] for p in points) for i in range(3)])
high = Vector([max(p[i] for p in points) for i in range(3)])
scale = 1.5 / (high.z - low.z)
center = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
transform = Matrix.Scale(scale, 4) @ Matrix.Translation(-center)
for obj in meshes:
    obj.data.transform(transform)
    obj.name = "CC0TabbySurface"

for image in bpy.data.images:
    width, height = image.size
    if max(width, height) > 2048:
        ratio = 2048 / max(width, height)
        image.scale(max(1, round(width * ratio)), max(1, round(height * ratio)))

bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
destination.parent.mkdir(parents=True, exist_ok=True)
options = dict(filepath=str(destination), export_format="GLB", use_selection=True,
               export_animations=False, export_yup=True, export_image_format="AUTO")
supported = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
if "export_jpeg_quality" in supported:
    options["export_jpeg_quality"] = 88
bpy.ops.export_scene.gltf(**options)
after = 0
for obj in meshes:
    obj.data.calc_loop_triangles()
    after += len(obj.data.loop_triangles)
report = {"source":str(source.relative_to(root)), "license":"CC0-1.0",
          "output":str(destination.relative_to(root)), "bytes":destination.stat().st_size,
          "source_faces":before, "preview_triangles":after, "texture_limit":2048,
          "blender":bpy.app.version_string,
          "limitations":["Static surface only", "No independent eyes, rig, morph targets or groom",
                          "AI-generated source requires topology and facial reconstruction before animation"]}
(destination.parent / "tabby-web.json").write_text(json.dumps(report, indent=2),encoding="utf8")
print(json.dumps(report))
