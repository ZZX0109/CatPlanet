import os
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'renders'/os.environ.get('MAINE_ROUND','v1')
out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
scene.frame_set(0)
if os.environ.get('MAINE_POSE','rest')=='rest':
    for obj in bpy.data.objects:
        if obj.type=='ARMATURE': obj.data.pose_position='REST'
        if obj.type=='MESH' and obj.data.shape_keys:
            keys=obj.data.shape_keys
            if keys.animation_data:
                for driver in keys.animation_data.drivers: driver.mute=True
            for key in keys.key_blocks: key.value=0
bpy.context.view_layer.update()
scene.render.engine='CYCLES'
scene.cycles.samples=int(os.environ.get('MAINE_SAMPLES','16'))
scene.cycles.seed=17
scene.cycles.use_denoising=True
scene.cycles.max_bounces=8
prefs=bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type='METAL';prefs.get_devices()
    gpu=False
    for device in prefs.devices:
        device.use=device.type=='METAL';gpu=gpu or device.use
    scene.cycles.device='GPU' if gpu else 'CPU'
except Exception: scene.cycles.device='CPU'
scene.render.resolution_x=int(os.environ.get('MAINE_RESOLUTION','750'))
scene.render.resolution_y=scene.render.resolution_x
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX'
for obj in bpy.data.objects:
    if obj.name.startswith('CTR_') or obj.type=='ARMATURE':obj.hide_render=True
for obj in list(bpy.data.objects):
    if obj.name in {'Maine review camera','Maine Review Floor','Maine Key','Maine Fill','Maine Rim'}:
        bpy.data.objects.remove(obj,do_unlink=True)

world=bpy.data.worlds.new('Maine review world');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.61,.63,.65,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.30
mat=bpy.data.materials.new('Maine review floor');mat.diffuse_color=(.65,.62,.58,1)
bpy.ops.mesh.primitive_plane_add(size=3,location=(0,0,-.002))
bpy.context.object.name='Maine Review Floor';bpy.context.object.data.materials.append(mat)
for name,location,energy,size in [('Key',(.38,-.45,.8),5.4,.5),('Fill',(-.5,-.2,.6),2.5,.6),('Rim',(.15,.5,.8),4.5,.45)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new('Maine '+name,data);scene.collection.objects.link(obj);obj.location=location
    obj.rotation_euler=(Vector((0,0,.18))-obj.location).to_track_quat('-Z','Y').to_euler()
data=bpy.data.cameras.new('Maine review camera');camera=bpy.data.objects.new('Maine review camera',data)
scene.collection.objects.link(camera);scene.camera=camera;data.type='ORTHO'
views={
 'three':((.52,-.75,.39),(0,.04,.15),.70),
 'front':((0,-.85,.31),(0,0,.16),.50),
 'side':((.9,.02,.30),(0,.07,.16),.88),
 'face':((.13,-.48,.30),(0,-.22,.245),.23),
 'face-front':((0,-.65,.265),(0,-.23,.245),.24),
}
for name in os.environ.get('MAINE_VIEWS','three,front,side,face').split(','):
    location,target,scale=views[name];camera.location=location;data.ortho_scale=scale
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    if os.environ.get('MAINE_WIDE')=='1' and name in {'three','side'}:
        scene.render.resolution_x=1400;scene.render.resolution_y=1000
    else:
        scene.render.resolution_x=int(os.environ.get('MAINE_RESOLUTION','750'));scene.render.resolution_y=scene.render.resolution_x
    scene.render.filepath=str(out/f'{name}.png')
    print('MAINE_RENDER_START',name,flush=True)
    bpy.ops.render.render(write_still=True)
    print('MAINE_RENDER_DONE',name,flush=True)
if os.environ.get('MAINE_SAVE_SCENE')=='1':
    default_view=os.environ.get('MAINE_DEFAULT_VIEW','front')
    location,target,scale=views[default_view];camera.location=location;data.ortho_scale=scale
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.resolution_x=1200;scene.render.resolution_y=1200
    scene.render.filepath=str(out/f'{default_view}.png')
    for obj in bpy.data.objects:
        if obj.type=='ARMATURE':obj.hide_set(True)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                region=area.spaces.active.region_3d
                region.view_rotation=camera.rotation_euler.to_quaternion()
                region.view_location=Vector(target);region.view_distance=.7;region.view_perspective='ORTHO'
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'model/maine-coon.blend'))
    print('MAINE_REVIEW_SCENE_SAVED',flush=True)
