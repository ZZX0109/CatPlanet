"""Render the three actual .blend models with identical lighting and framing."""
import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
parser=argparse.ArgumentParser()
parser.add_argument('--models',default='solid,ragdoll,siamese')
parser.add_argument('--views',default='three,face')
parser.add_argument('--resolution',type=int,default=640)
parser.add_argument('--samples',type=int,default=16)
parser.add_argument('--output',default=str(ROOT/'artifacts/cat-reference-study/preview'))
parser.add_argument('--save-stage',action='store_true')
parser.add_argument('--skip-existing',action='store_true',help='Keep already reviewed output frames in this output folder')
args=parser.parse_args(argv)
out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
views={
    'three':((.46,-.65,.34),(0,.015,.14),.56),
    'front':((0,-.75,.28),(0,-.02,.17),.55),
    'side':((.75,-.03,.30),(0,0,.17),.61),
    'face':((.045,-.46,.265),(0,-.18,.218),.190),
}
try:
    preferences=bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type='METAL';preferences.get_devices()
    devices=[]
    for device in preferences.devices:
        device.use=device.type=='METAL'
        if device.use:devices.append(device.name)
except Exception:devices=[]
outputs=[]
for variant in args.models.split(','):
    path=ROOT/'assets/authored'/('cat-'+variant+'-v2.blend')
    bpy.ops.wm.open_mainfile(filepath=str(path),use_scripts=False)
    scene=bpy.context.scene;scene.frame_set(0)
    # Use authored standing geometry for silhouette review. The source walking
    # action is retained, and is not represented as retargeted or QA-passed.
    for obj in bpy.data.objects:
        if obj.type=='ARMATURE':obj.data.pose_position='REST'
    body=bpy.data.objects['GreyTabbyCat_Body']
    if body.data.shape_keys.animation_data:
        for driver in body.data.shape_keys.animation_data.drivers:driver.mute=True
    for key in body.data.shape_keys.key_blocks:
        if key.name!='Basis' and not key.name.startswith('Miaoxing '):key.value=1 if key.name=='repair_face' else 0
    for side in ['L','R']:
        key=body.data.shape_keys.key_blocks.get('blink_u.'+side)
        if key:key.slider_min=-.35;key.value={'solid':.55,'ragdoll':.50,'siamese':.10}[variant]
        for rig in (obj for obj in bpy.data.objects if obj.type=='ARMATURE'):
            control=rig.pose.bones.get('CTR_eye_a.'+side)
            if control:control['pupil']=.40 if variant=='solid' else .30 if variant=='ragdoll' else .22
    for obj in bpy.data.objects:
        if obj.type!='MESH' or 'Sclera' not in obj.name or not obj.data.shape_keys:continue
        ocular_keys=obj.data.shape_keys
        if ocular_keys.animation_data:
            for driver in ocular_keys.animation_data.drivers:driver.mute=True
        for key in ocular_keys.key_blocks:
            if key.name=='pupil_CTR01':key.value=.40 if variant=='solid' else .30 if variant=='ragdoll' else .22
            elif key.name=='pupil_CTR02':key.value=0
    bpy.context.view_layer.update()
    scene.render.engine='CYCLES';scene.cycles.device='GPU' if devices else 'CPU'
    scene.cycles.samples=args.samples;scene.cycles.use_denoising=True;scene.cycles.max_bounces=8
    scene.render.resolution_x=args.resolution;scene.render.resolution_y=args.resolution;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
    scene.render.use_compositing=False;scene.render.use_sequencer=False;scene.render.use_border=False;scene.render.use_motion_blur=False
    scene.use_nodes=False;scene.view_settings.view_transform='AgX'
    for obj in list(bpy.data.objects):
        if obj.get('miaoxing_preview_stage'):bpy.data.objects.remove(obj,do_unlink=True)
    for obj in bpy.data.objects:
        if obj.name.startswith('CTR_') or obj.type=='ARMATURE':obj.hide_render=True
    world=bpy.data.worlds.new('Three cats review world');world.use_nodes=True;scene.world=world
    world.node_tree.nodes['Background'].inputs[0].default_value=(.61,.63,.65,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.25
    floor=bpy.data.materials.new('Three cats floor');floor.diffuse_color=(.72,.69,.64,1)
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.002))
    bpy.context.object.name='Three cats review floor';bpy.context.object['miaoxing_preview_stage']=True;bpy.context.object.data.materials.append(floor)
    for name,location,energy,size in [('Key',(.32,-.38,.7),3.5,.42),('Fill',(-.4,-.1,.5),1.6,.5),('Rim',(.18,.4,.65),2.5,.35)]:
        data=bpy.data.lights.new('Three cats '+name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
        obj=bpy.data.objects.new(data.name,data);scene.collection.objects.link(obj);obj.location=location;obj['miaoxing_preview_stage']=True
        obj.rotation_euler=(Vector((0,0,.18))-obj.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Three cats review camera');camera=bpy.data.objects.new(data.name,data);scene.collection.objects.link(camera);scene.camera=camera
    camera['miaoxing_preview_stage']=True;camera.data.type='ORTHO';camera.data.dof.use_dof=False
    def frame(name):
        location,target,scale=views[name];camera.location=location;camera.data.ortho_scale=scale
        camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(out/(variant+'-'+name+'.png'))
    frame('three')
    if args.save_stage:bpy.ops.wm.save_as_mainfile(filepath=str(path))
    for name in args.views.split(','):
        frame(name)
        if args.skip_existing and Path(scene.render.filepath).is_file():
            outputs.append(scene.render.filepath)
            print('THREE_CAT_RENDER_EXISTING',variant,name,flush=True)
            continue
        print('THREE_CAT_RENDER_START',variant,name,flush=True)
        bpy.ops.render.render(write_still=True)
        outputs.append(scene.render.filepath)
        print('THREE_CAT_RENDER_DONE',variant,name,flush=True)
(out/'render-report.json').write_text(json.dumps({'models':args.models,'views':args.views,'samples':args.samples,'resolution':args.resolution,'sameCameraAndLighting':True,'outputs':outputs},indent=2))
