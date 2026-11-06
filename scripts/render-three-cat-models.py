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
parser.add_argument('--output',default=str(ROOT/'artifacts/three-cat-models/preview'))
parser.add_argument('--save-stage',action='store_true')
args=parser.parse_args(argv)
out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
views={
    'three':((.46,-.65,.36),(0,0,.18),.64),
    'front':((0,-.75,.28),(0,-.02,.17),.55),
    'side':((.75,-.03,.30),(0,0,.17),.61),
    'face':((.12,-.43,.27),(0,-.19,.225),.185),
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
    path=ROOT/'assets/authored'/('cat-'+variant+'.blend')
    bpy.ops.wm.open_mainfile(filepath=str(path),use_scripts=False)
    scene=bpy.context.scene;scene.frame_set(0)
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
    bpy.ops.mesh.primitive_plane_add(size=2,location=(0,0,-.007))
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
        print('THREE_CAT_RENDER_START',variant,name,flush=True)
        bpy.ops.render.render(write_still=True)
        outputs.append(scene.render.filepath)
        print('THREE_CAT_RENDER_DONE',variant,name,flush=True)
(out/'render-report.json').write_text(json.dumps({'models':args.models,'views':args.views,'samples':args.samples,'resolution':args.resolution,'sameCameraAndLighting':True,'outputs':outputs},indent=2))
