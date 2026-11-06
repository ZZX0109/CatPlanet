"""Inspect Blender or glTF assets without running embedded scripts."""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

source, destination = sys.argv[sys.argv.index("--") + 1 :]
source_path=Path(source).resolve()
if source_path.suffix.lower()=='.blend':
    bpy.ops.wm.open_mainfile(filepath=str(source_path), load_ui=False, use_scripts=False)
elif source_path.suffix.lower()in ('.glb','.gltf'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source_path))
else:
    raise ValueError('Expected a .blend, .glb or .gltf model')
objects = []
for obj in bpy.data.objects:
    item = {"name": obj.name, "type": obj.type, "parent": obj.parent.name if obj.parent else None,
            "hidden_render": obj.hide_render, "dimensions": list(obj.dimensions),
            "location": list(obj.matrix_world.translation)}
    if obj.type == "MESH":
        points = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
        item.update(vertices=len(obj.data.vertices), faces=len(obj.data.polygons),
                    materials=[m.name if m else None for m in obj.data.materials],
                    bounds=[[min(v[i] for v in points) for i in range(3)], [max(v[i] for v in points) for i in range(3)]],
                    modifiers=[{"name":m.name,"type":m.type} for m in obj.modifiers],
                    shape_keys=[k.name for k in obj.data.shape_keys.key_blocks] if obj.data.shape_keys else [])
        item["particles"] = [{"name": ps.name, "type": ps.settings.type,
                              "count": ps.settings.count, "hair_length": ps.settings.hair_length,
                              "hair_step": ps.settings.hair_step,
                              "children": getattr(ps.settings,"child_percent",getattr(ps.settings,"child_nbr",None)),
                              "render_children": getattr(ps.settings,"rendered_child_count",getattr(ps.settings,"ren_child_nbr",None)),
                              "material": ps.settings.material,
                              "guides":len(ps.particles)} for ps in obj.particle_systems]
    if obj.type == "ARMATURE":
        item["bones"] = [{"name":b.name,"head":list(obj.matrix_world @ b.head_local),
                          "tail":list(obj.matrix_world @ b.tail_local)} for b in obj.data.bones]
    objects.append(item)
report = {"blender":bpy.app.version_string,"source":str(Path(source).resolve()),"objects":objects,
          "images":[{"name":i.name,"size":list(i.size),"packed":bool(i.packed_file)} for i in bpy.data.images],
          "materials":[{"name":m.name,"nodes":[{"name":n.name,"type":n.type,
                                                "image":n.image.name if n.type=="TEX_IMAGE" and n.image else None} for n in m.node_tree.nodes] if m.use_nodes else []} for m in bpy.data.materials],
          "actions":[{"name":a.name,"frames":list(a.frame_range)} for a in bpy.data.actions]}
out = Path(destination)
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(report,indent=2),encoding="utf8")
print(json.dumps({"report":str(out),"objects":[{k:v for k,v in x.items() if k not in ("bones",)} for x in objects],"actions":report["actions"]}))
