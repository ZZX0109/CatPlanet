"""Import a supplied cat in Blender and create local, unmodified-model views.

Usage: Blender --background --factory-startup --disable-autoexec
       --python-exit-code 1 --python scripts/review-imported-cat.py -- SOURCE KEY
Original files and downloaded textures are never overwritten.
"""
import bpy
import hashlib
import json
import re
import sys
from pathlib import Path
from mathutils import Vector

ROOT=Path.cwd()
source_arg,key=sys.argv[sys.argv.index('--')+1:]
if not re.fullmatch(r'[a-z0-9-]+',key):
    raise ValueError('Invalid review key')
source=Path(source_arg).resolve()
source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
output=ROOT/'artifacts/user-cat-pack-review'/key
output.mkdir(parents=True,exist_ok=True)
if source.suffix.lower()=='.blend':
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
elif source.suffix.lower()in ('.glb','.gltf'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
else:
    raise ValueError('Unsupported review source')

scene=bpy.context.scene
scene.frame_set(1)
bpy.context.view_layer.update()
rigs=[o for o in scene.objects if o.type=='ARMATURE']
widgets={bone.custom_shape for rig in rigs for bone in rig.pose.bones if bone.custom_shape}
meshes=[o for o in scene.objects if o.type=='MESH' and o not in widgets and len(o.data.polygons)>100]
if not meshes:
    raise ValueError('No cat surface found')
for obj in widgets:
    obj.hide_render=True
    obj.hide_set(True)
depsgraph=bpy.context.evaluated_depsgraph_get()
points=[obj.matrix_world@Vector(corner)for obj in meshes for corner in obj.evaluated_get(depsgraph).bound_box]
low=Vector(tuple(min(p[i]for p in points)for i in range(3)))
high=Vector(tuple(max(p[i]for p in points)for i in range(3)))
height=high.z-low.z
if height<=0:
    raise ValueError('Invalid model bounds')
center=(low+high)/2
eye_positions=[]
head_positions=[]
for rig in rigs:
    for bone in rig.pose.bones:
        name=bone.name.lower()
        position=rig.matrix_world@bone.head
        if 'eye'in name and not re.search('lid|upper|lower|down|up|side|corner|inner|outer',name):
            eye_positions.append(position)
        if re.search(r'(^head$|headskinjnt| head$)',name):
            head_positions.append(position)
eye_center=sum(eye_positions,Vector())/len(eye_positions)if eye_positions else Vector((center.x,low.y+height*.12,low.z+height*.78))
head_origin=sum(head_positions,Vector())/len(head_positions)if head_positions else eye_center+Vector((0,height*.1,0))
forward=eye_center-head_origin
forward.z=0
if forward.length<1e-6:
    forward=Vector((0,-1,0))
forward.normalize()
right=forward.cross(Vector((0,0,1))).normalized()
head_target=eye_center+Vector((0,0,height*.035))

for obj in list(scene.objects):
    if obj.type in ('LIGHT','CAMERA'):
        obj.hide_render=True
world=bpy.data.worlds.new('Local review neutral world')
world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.32,.32,.32,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.45
scene.world=world
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=32
scene.cycles.use_denoising=True
scene.render.resolution_x=900
scene.render.resolution_y=900
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
scene.view_settings.view_transform='Filmic'
scene.view_settings.look='Medium High Contrast'
scene.view_settings.exposure=0
scene.view_settings.gamma=1

def aim(obj,target):
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()

for name,direction,power,size,color in [
    ('Review main',(-2,-2.6,3),60,1.7,(1,.97,.92)),
    ('Review fill',(2.5,-1,1.5),20,1.5,(.9,.95,1)),
    ('Review rim',(1,2.2,3),35,1.4,(1,1,1)),
]:
    light=bpy.data.lights.new(name,'AREA')
    light.energy=power*height*height
    light.shape='DISK'
    light.size=size*height
    light.color=color
    obj=bpy.data.objects.new(name,light)
    scene.collection.objects.link(obj)
    obj.location=center+Vector(direction)*height
    aim(obj,center)

bpy.ops.mesh.primitive_plane_add(size=height*200,location=(center.x,center.y,low.z-height*.005))
floor=bpy.context.object
floor.name='Review floor'
floor_material=bpy.data.materials.new('Review neutral floor')
floor_material.diffuse_color=(.22,.22,.22,1)
floor.data.materials.append(floor_material)
camera_data=bpy.data.cameras.new('Review camera')
camera=bpy.data.objects.new('Review camera',camera_data)
scene.collection.objects.link(camera)
scene.camera=camera
camera_data.type='ORTHO'
camera_data.clip_start=height*.001
camera_data.clip_end=height*1000

def frame(target,direction,scale):
    camera.location=target+direction.normalized()*height*5
    aim(camera,target)
    camera_data.ortho_scale=scale

def capture(name,target,direction,scale):
    frame(target,direction,scale)
    scene.render.filepath=str(output/(name+'.png'))
    bpy.ops.render.render(write_still=True)

whole_scale=max(height,high.y-low.y)*1.08
three=forward*2.6+right*1.5+Vector((0,0,.7))
capture('material-whole',center,Vector((1.5,-2.6,.8)),whole_scale)
capture('material-front',head_target,forward, height*.58)
capture('material-three',head_target,three,height*.58)
capture('material-side',head_target,right,height*.58)
clay=bpy.data.materials.new('Review geometry clay')
clay.use_nodes=True
shader=clay.node_tree.nodes.get('Principled BSDF')
shader.inputs['Base Color'].default_value=(.42,.42,.42,1)
shader.inputs['Roughness'].default_value=.85
scene.view_layers[0].material_override=clay
capture('clay-front',head_target,forward,height*.58)
capture('clay-three',head_target,three,height*.58)
scene.view_layers[0].material_override=None
frame(center,Vector((1.5,-2.6,.8)),whole_scale)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            view=area.spaces.active.region_3d
            view.view_location=center
            view.view_distance=whole_scale*1.8
            view.view_rotation=camera.rotation_euler.to_quaternion()
            area.spaces.active.shading.type='MATERIAL'
bpy.context.preferences.filepaths.save_version=0
saved=source.parents[2]/'reviews'/(key+'.blend')
saved.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(saved),compress=True)
unchanged=hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
if not unchanged:
    raise RuntimeError('Source file changed during review')
report={'key':key,'source':str(source.relative_to(ROOT)),'sourceSha256':source_hash,'sourceUnchanged':unchanged,'blender':bpy.app.version_string,'reviewBlend':str(saved.relative_to(ROOT)),'bounds':[list(low),list(high)],'eyeBonesFound':len(eye_positions),'meshes':[o.name for o in meshes],'views':[p.name for p in output.glob('*.png')],'scope':'Actual Blender renders of the supplied asset at frame 1. No shape edits, added fur or model optimization. Local inspection only; does not certify customization or visual quality.'}
(output/'review.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
