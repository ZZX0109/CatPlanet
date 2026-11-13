import json
import math
from pathlib import Path
import bpy
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[1]
body=bpy.data.objects['MaineCoon_Body']
rig=next(obj for obj in bpy.data.objects if obj.type=='ARMATURE')
assert rig.data.pose_position=='REST'
assert all(math.isfinite(value) for vertex in body.data.vertices for value in vertex.co)
assert len(body.data.vertices)==44520
for mod in body.modifiers:
    if mod.type=='PARTICLE_SYSTEM':mod.show_viewport=mod.particle_system.name.endswith(('HeadLong','BodyLong','Tail'))
bpy.context.view_layer.update()
dg=bpy.context.evaluated_depsgraph_get()
ev=body.evaluated_get(dg)
surface=BVHTree.FromObject(body,dg)
attachment=[]
for ps in ev.particle_systems:
    if not ps.name.endswith(('HeadLong','BodyLong','Tail')):continue
    indices=[index*(len(ps.particles)-1)//63 for index in range(64)]
    distances=[]
    for index in indices:
        root=ps.particles[index].hair_keys[0].co.copy()
        hit=surface.find_nearest(root)
        distances.append(hit[3])
    attachment.append({'system':ps.name,'samples':len(indices),'max_surface_distance_m':max(distances),'mean_surface_distance_m':sum(distances)/len(distances)})
tufts=[]
for obj in bpy.data.objects:
    if obj.name.startswith('Maine Lynx Tip'):
        roots=[obj.matrix_world@obj.data.points[index].position for index in range(0,len(obj.data.points),4)]
        distances=[surface.find_nearest(root)[3] for root in roots]
        tufts.append({'object':obj.name,'strands':len(roots),'mean_root_surface_distance_m':sum(distances)/len(distances),'max_root_surface_distance_m':max(distances),'parent_bone':obj.parent_bone})
images=[]
for image in bpy.data.images:
    if image.source in {'FILE','TILED'} and image.filepath:
        packed=bool(image.packed_file) or bool(len(image.packed_files))
        images.append({'name':image.name,'packed':packed})
report={'default_pose':rig.data.pose_position,'finite_geometry':True,'body_vertices':len(body.data.vertices),'native_hair_systems':len(body.particle_systems),'hair_attachment_samples':attachment,'ear_tufts':tufts,'texture_images':images,'all_textures_packed':all(row['packed'] for row in images),'camera':bpy.context.scene.camera.name if bpy.context.scene.camera else None}
assert report['native_hair_systems']==19
assert report['all_textures_packed']
assert max(row['max_surface_distance_m'] for row in attachment)<.001
assert len(tufts)==2
assert max(row['max_root_surface_distance_m'] for row in tufts)<.0002
report['passed']=True
(ROOT/'model/validation.json').write_text(json.dumps(report,indent=2))
print('MAINE_MODEL_VALIDATED',json.dumps(report),flush=True)
