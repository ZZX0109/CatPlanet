"""Author the supplied Sphynx as a separate, genuinely hairless foundation.

Use the bundled Blender 3.6 with --background --factory-startup
--disable-autoexec --python-exit-code 1 --python this-file [-- --render].
The original skin, UVs, normals, rig and source action are not replaced.
"""
from pathlib import Path
import hashlib
import json
import math
import os
import sys
import bpy
import numpy as np
from mathutils import Vector, Matrix

if bpy.app.version[:2] != (3, 6):
    raise RuntimeError('Use Blender 3.6 for the preserved legacy Sphynx source; newer Blender versions may not read it safely.')

ROOT = Path.cwd()
SOURCE = ROOT/'assets/source/user-animal-pack-2026-11-04/sphynx/source/Sphynx.blend'
OUT = ROOT/'public/models/creator'
REVIEW = ROOT/'artifacts/sphynx-creator'
BLEND = ROOT/'assets/authored/sphynx-creator.blend'
OUT.mkdir(parents=True, exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)
source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
import importlib.util
_refine_spec = importlib.util.spec_from_file_location('foundation_face', ROOT/'scripts/refine-foundation-face.py')
face_refinement = importlib.util.module_from_spec(_refine_spec)
_refine_spec.loader.exec_module(face_refinement)

bpy.ops.wm.open_mainfile(filepath=str(SOURCE), use_scripts=False)
scene = bpy.context.scene
scene.frame_set(1)
mesh = bpy.data.objects['sphynx_GEO']
rig = mesh.find_armature()
mesh.name = 'SphynxCat_Surface'
rig.name = 'SphynxCat_Rig'
for bone in rig.pose.bones:
    bone.custom_shape = None
for obj in list(scene.objects):
    if obj not in (mesh, rig):
        bpy.data.objects.remove(obj, do_unlink=True)

base = np.array([tuple(v.co) for v in mesh.data.vertices], dtype=np.float64)
original = base.copy()
groups = {g.name:g.index for g in mesh.vertex_groups}
weights = np.zeros((len(base),len(groups)),dtype=np.float64)
for vertex in mesh.data.vertices:
    for member in vertex.groups:
        weights[vertex.index,member.group] = member.weight
head_bone = rig.data.bones['HeadSkinJnt']
head_names = [b.name for b in [head_bone]+list(head_bone.children_recursive)]
head_weight = np.clip(sum(weights[:,groups[n]]for n in head_names if n in groups),0,1)
eye_names = ('LeftEyeSkinJnt','RightEyeSkinJnt')
eye_bones = [rig.data.bones[n].head_local.copy()for n in eye_names]
right = eye_bones[0]-eye_bones[1]
right.z = 0
right.normalize()
up = Vector((0,0,1))
forward = right.cross(up).normalized()
eye_mid = (eye_bones[0]+eye_bones[1])/2
eye_distance = (eye_bones[0]-eye_bones[1]).length
origin = eye_mid-forward*eye_distance*.27-up*eye_distance*.09
basis = np.array([tuple(right),tuple(forward),tuple(up)])
local = np.einsum('ij,kj->ik',base-np.array(origin),basis)
unit = eye_distance
x,depth,height = (local/unit).T

def smooth(a,b,v):
    t = np.clip((v-a)/(b-a),0,1)
    return t*t*(3-2*t)

# Sphynx proportions and masks are measured from its own eyes and nose bones.
# Source head wrinkles and skin normals stay intact at the neutral endpoint.
head_weight *= smooth(-1.7,-.9,height)
eyes = []
for name,bone_position in zip(eye_names,eye_bones):
    center = np.einsum('j,kj->k',np.array(bone_position)-np.array(origin),basis)
    ellipsoid = np.linalg.norm((local-center)/(unit*np.array((.49,.67,.48))),axis=1)
    mask = 1-smooth(.45,1.42,ellipsoid)
    rigid_ids = np.where(weights[:,groups[name]]>.92)[0]
    mask[rigid_ids] = 1
    # Use the actual globe vertex-weight component, not a painted eye area.
    if len(rigid_ids)<30:
        raise RuntimeError('Sphynx eyeball skin group is incomplete: '+name)
    eyes.append((name,center,mask,rigid_ids))
ears = []
ear_names = ('LeftEar1SkinJnt','RightEar1SkinJnt')
for name in ear_names:
    bone = rig.data.bones[name]
    center = np.einsum('j,kj->k',np.array(bone.head_local)-np.array(origin),basis)
    center[2] -= unit*.10
    side = 1 if center[0]>0 else -1
    names = [bone.name]+[b.name for b in bone.children_recursive]
    mask = np.clip(sum(weights[:,groups[n]]for n in names if n in groups),0,1)
    mask = np.maximum(mask, smooth(center[2]-.15*unit,center[2]+.35*unit,local[:,2])*(1-smooth(.45*unit,.80*unit,np.abs(local[:,0]-center[0]))))*head_weight
    mask *= smooth(center[2]-.3*unit,center[2]+.2*unit,local[:,2])
    ears.append((name,side,center,mask))
nose_names = ('LeftNose1SkinJnt','RightNose1SkinJnt')
nose_position = sum((rig.data.bones[n].head_local for n in nose_names),Vector())/2
nose_local = np.einsum('j,kj->k',np.array(nose_position)-np.array(origin),basis)/unit
muzzle = np.exp(-((x/.77)**4+((height-nose_local[2])/.58)**4))*smooth(.35,.78,depth)*head_weight
cheeks = np.exp(-((np.abs(x)-.70)/.60)**2-((height+.24)/.65)**2-((depth-.22)/.95)**2)*head_weight
jaw = (1-smooth(-.35,.02,height))*smooth(-.25,.52,depth)*head_weight
bridge = np.exp(-(x/.29)**2-((height-.04)/.57)**2)*smooth(.30,.60,depth)*head_weight

def protect_eyes(delta,transform):
    for _,center,mask,_ in eyes:
        rigid = transform(center)-center
        delta = delta*(1-mask[:,None])+rigid[None,:]*mask[:,None]
    return delta

def deformation(key,sign):
    d = np.zeros_like(local)
    if key=='headWidth':
        d[:,0] = local[:,0]*.12*head_weight*sign
        d = protect_eyes(d,lambda c:c+np.array((c[0]*.12*sign,0,0)))
    elif key=='headDepth':
        d[:,1] = local[:,1]*.09*head_weight*sign
        d = protect_eyes(d,lambda c:c+np.array((0,c[1]*.09*sign,0)))
    elif key=='cheeks':
        d[:,0] = np.tanh(x/.35)*unit*.105*cheeks*sign
        d[:,1] = unit*.030*cheeks*sign
    elif key=='jaw':
        d[:,0] = local[:,0]*.12*jaw*sign
        d[:,2] = -unit*.025*jaw*sign
    elif key=='muzzle':
        d[:,1] = unit*.13*muzzle*sign
    elif key=='muzzleWidth':
        d[:,0] = local[:,0]*.135*muzzle*sign
    elif key=='noseBridge':
        d[:,1] = unit*.06*bridge*sign
        d[:,2] = unit*.035*bridge*sign
    elif key.startswith('eye'):
        for _,center,mask,_ in eyes:
            q = local-center
            if key=='eyeSize':
                dd=q*.08*sign
            elif key=='eyeSpacing':
                dd=np.zeros_like(local);dd[:,0]=np.sign(center[0])*unit*.06*sign
            else:
                angle=math.radians(6)*np.sign(center[0])*sign
                dd=np.zeros_like(local)
                dd[:,0]=q[:,0]*(math.cos(angle)-1)-q[:,2]*math.sin(angle)
                dd[:,2]=q[:,0]*math.sin(angle)+q[:,2]*(math.cos(angle)-1)
            d+=dd*mask[:,None]
    elif key.startswith('ear'):
        for _,side,center,mask in ears:
            q=local-center
            if key=='earSize':dd=q*.14*sign
            else:
                angle=math.radians(10)*side*sign
                dd=np.zeros_like(local)
                dd[:,0]=q[:,0]*(math.cos(angle)-1)+q[:,2]*math.sin(angle)
                dd[:,2]=-q[:,0]*math.sin(angle)+q[:,2]*(math.cos(angle)-1)
            d+=dd*mask[:,None]
    if key not in ('headWidth','headDepth','eyeSize','eyeSpacing','eyeTilt'):
        # Cheek, jaw, mouth and ear controls must not disturb the optical rim.
        # Keep a full stable orbital island, with a soft anatomical falloff.
        for _,center,_,indices in eyes:
            radius=np.linalg.norm((local-center)/(unit*np.array((.49,.67,.48))),axis=1)
            d*=smooth(.90,1.50,radius)[:,None]
            d[indices]=0
    return d

mesh.shape_key_add(name='Basis',from_mix=False)
reports={}
def add_target(name,delta):
    target=mesh.shape_key_add(name=name,from_mix=False)
    points=base+np.einsum('ij,jk->ik',delta,basis)
    assert np.isfinite(points).all()
    target.data.foreach_set('co',points.astype(np.float32).ravel())
    distance=np.linalg.norm(points-base,axis=1)
    reports[name]={'changedVertices':int(np.sum(distance>1e-7)),'maxDisplacementSourceMeters':float(distance.max())}
keys=['headWidth','headDepth','cheeks','jaw','muzzle','muzzleWidth','noseBridge','eyeSize','eyeSpacing','eyeTilt','earSize','earTilt']
for key in keys:
    for suffix,sign in [('low',-1),('high',1)]:add_target('Shape_'+key+'_'+suffix,deformation(key,sign))
add_target('Head_round',deformation('headWidth',.55)+deformation('cheeks',.5)+deformation('jaw',.25)+deformation('muzzle',-.15))
add_target('Head_wedge',deformation('headWidth',-.4)+deformation('cheeks',-.2)+deformation('headDepth',.3)+deformation('muzzle',.3))
face_report = face_refinement.author_face_refinement(mesh, base, basis, origin, [ids for _,_,_,ids in eyes], 'sphynx', head_weight)
face_report.pop('closedPoints')
for _target in mesh.data.shape_keys.key_blocks:
    if _target.name=='Basis':continue
    _points=np.array([tuple(v.co)for v in _target.data])
    _distance=np.linalg.norm(_points-base,axis=1)
    reports[_target.name]={'changedVertices':int(np.sum(_distance>1e-7)),'maxDisplacementSourceMeters':float(_distance.max())}

removed_card_faces = 0
assert np.array_equal(original,np.array([tuple(v.co)for v in mesh.data.vertices]))

# Store the source action without allowing it to overwrite the default pose.
action=rig.animation_data.action
action.use_fake_user=True
track=rig.animation_data.nla_tracks.new()
track.name='Original Sphynx motion (not the default pose)'
track.strips.new(action.name,int(action.frame_range[0]),action)
track.mute=True
rig.animation_data.action=None
bpy.context.view_layer.update()
gaze=sum(((rig.pose.bones[n].tail-rig.pose.bones[n].head).normalized()for n in eye_names),Vector()).normalized()
correction=gaze.rotation_difference(Vector((0,-1,0))).to_matrix().to_4x4()
bone=rig.pose.bones['HeadSkinJnt'];pivot=bone.head.copy()
bone.matrix=Matrix.Translation(pivot)@correction@Matrix.Translation(-pivot)@bone.matrix
bpy.context.view_layer.update()
eye_line=rig.pose.bones[eye_names[0]].head-rig.pose.bones[eye_names[1]].head
roll=-math.atan2(eye_line.z,eye_line.x)
pivot=bone.head.copy()
bone.matrix=Matrix.Translation(pivot)@Matrix.Rotation(roll,4,Vector((0,-1,0)))@Matrix.Translation(-pivot)@bone.matrix
bpy.context.view_layer.update()
paws={'LeftFrontToeSkinJnt':['LeftFrontToeSkinJnt'],'RightFrontToeSkinJnt':['RightFrontToeSkinJnt'],'LeftBackFootSkinJnt':['LeftBackFootSkinJnt','LeftBackToeSkinJnt'],'RightBackFootSkinJnt':['RightBackFootSkinJnt','RightBackToeSkinJnt']}
paw_indices={n:np.where(weights[:,[groups[m]for m in names]].sum(1)>.5)[0]for n,names in paws.items()}
evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
lowest={n:min(evaluated.data.vertices[int(i)].co.z for i in ids)for n,ids in paw_indices.items()}
ground=min(lowest.values())
for name in paws:
    pb=rig.pose.bones[name];transform=pb.matrix.copy();transform.translation.z+=ground-lowest[name];pb.matrix=transform
    bpy.context.view_layer.update()
standing_basis={b.name:b.matrix_basis.copy()for b in rig.pose.bones}
evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
points=[mesh.matrix_world@v.co for v in evaluated.data.vertices]
low=Vector(tuple(min(p[a]for p in points)for a in range(3)))
high=Vector(tuple(max(p[a]for p in points)for a in range(3)))
scale=3/(high.z-ground)
root=bpy.data.objects.new('SphynxCat_Creator',None)
scene.collection.objects.link(root)
root.scale=(scale,)*3
root.location=(0,0,-ground*scale)
rig.parent=root
bpy.context.view_layer.update()
def canonical(p):
    q=mesh.matrix_world@Vector(p)
    return [float(q.x),float(q.z),float(-q.y)]
head_ids=np.where(head_weight>.55)[0]
evalpoints=[canonical(evaluated.data.vertices[int(i)].co)for i in head_ids]
bounds={'min':[min(p[a]for p in evalpoints)for a in range(3)],'max':[max(p[a]for p in evalpoints)for a in range(3)]}
landmarks={
    'eyeCenters':[canonical(sum((evaluated.data.vertices[int(i)].co for i in ids),Vector())/len(ids))for _,_,_,ids in eyes],
    'earBases':[canonical(rig.pose.bones[n].head)for n in ear_names],
    'muzzleCenter':canonical(sum((rig.pose.bones[n].head for n in nose_names),Vector())/2),
}
paw_report={n:{'minY':min(canonical(evaluated.data.vertices[int(i)].co)[1]for i in ids)}for n,ids in paw_indices.items()}
gaze=sum(((rig.pose.bones[n].tail-rig.pose.bones[n].head).normalized()for n in eye_names),Vector()).normalized()
pose={'name':'standing-front','sourceFrame':1,'headForward':[float(gaze.x),float(gaze.z),float(-gaze.y)],'paws':paw_report,'groundSpread':max(p['minY']for p in paw_report.values())-min(p['minY']for p in paw_report.values())}
eye_geometry=[]
for eye_index,eye_ids in enumerate(face_report['eyeIds']):
    eye_points=[canonical(evaluated.data.vertices[int(i)].co)for i in eye_ids]
    eye_geometry.append({'side':'L'if eye_index==0 else'R','center':[float(np.mean([p[a]for p in eye_points]))for a in range(3)],'min':[min(p[a]for p in eye_points)for a in range(3)],'max':[max(p[a]for p in eye_points)for a in range(3)]})
extras={'creatorEyeGeometry':eye_geometry,'creatorFaceRefinement':{k:v for k,v in face_report.items()if k!='eyeIds'},'creatorGroom':{'removedWhiskerCards':False,'removedCardFaces':0},'creatorTemplateId':'sphynx-cat-v1','creatorBaseId':'sphynx','creatorHeadBounds':bounds,'creatorLandmarks':landmarks,'creatorFeatures':{'blink':True,'fur':False},'creatorDefaultPose':pose,'creatorSourceSha256':source_hash,'creatorSourceLicense':'User supplied; permission for redistribution/export not verified','creatorSkin':'Original hairless Sphynx albedo, normal-map wrinkles, anatomical mesh and UVs'}
for key,value in extras.items():scene[key]=value;root[key]=value
mesh['creatorPart']='head'
for key in mesh.data.shape_keys.key_blocks:key.value=0
BLEND.parent.mkdir(parents=True,exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND),compress=True)
temp=OUT/'.sphynx-cat.build.glb'
_sparse_export = {key: True for key in ('export_try_sparse_sk','export_try_omit_sparse_sk') if key in bpy.ops.export_scene.gltf.get_rna_type().properties}
bpy.ops.export_scene.gltf(filepath=str(temp),export_format='GLB',export_extras=True,export_animations=True,export_morph=True,export_morph_normal=True,export_skins=True,export_yup=True,export_cameras=False,export_lights=False,export_current_frame=True,export_rest_position_armature=False, **_sparse_export)
os.replace(temp,OUT/'sphynx-cat.glb')
rig.animation_data.action=None
for name,matrix in standing_basis.items():rig.pose.bones[name].matrix_basis=matrix
bpy.context.view_layer.update()
manifest={'templateId':'sphynx-cat-v1','baseId':'sphynx','modelUrl':'/models/creator/sphynx-cat.glb','source':str(SOURCE.relative_to(ROOT)),'sourceSha256':source_hash,'sourceUnchanged':hashlib.sha256(SOURCE.read_bytes()).hexdigest()==source_hash,'outputSha256':hashlib.sha256((OUT/'sphynx-cat.glb').read_bytes()).hexdigest(),'blender':bpy.app.version_string,'boneCount':len(rig.data.bones),'sourceVertices':len(base),'neutralMeshUnchanged':True,'shapeTargets':reports,'headBounds':bounds,'landmarks':landmarks,'defaultPose':pose,**extras}
(OUT/'sphynx-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(REVIEW/'build-report.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print('SPHYNX_CREATOR_COMPLETE',json.dumps({'bones':len(rig.data.bones),'targets':len(reports),'pose':pose,'sha256':manifest['outputSha256']}))

if '--render'in sys.argv:
    scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.cycles.use_denoising=True
    scene.render.resolution_x=800;scene.render.resolution_y=800;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
    scene.view_settings.view_transform='Filmic';scene.view_settings.look='Medium High Contrast'
    world=bpy.data.worlds.new('Sphynx neutral studio');world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.25,.25,.25,1);world.node_tree.nodes['Background'].inputs[1].default_value=.5;scene.world=world
    center=Vector((0,-sum(p[2]for p in landmarks['eyeCenters'])/2,sum(p[1]for p in landmarks['eyeCenters'])/2))
    evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    full_points=[mesh.matrix_world@v.co for v in evaluated.data.vertices]
    full_min=Vector(tuple(min(p[a]for p in full_points)for a in range(3)))
    full_max=Vector(tuple(max(p[a]for p in full_points)for a in range(3)))
    target=center.copy()
    def aim(obj):obj.rotation_euler=(target-obj.location).to_track_quat('-Z','Y').to_euler()
    for name,position,power,size in [('Key',(-3,-4,6),450,4),('Fill',(3,-1,4),160,4),('Rim',(1,2,5),300,3)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
        obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=position;aim(obj)
    data=bpy.data.cameras.new('Sphynx review');camera=bpy.data.objects.new('Sphynx review',data);scene.collection.objects.link(camera);scene.camera=camera;data.type='ORTHO'
    def capture(name,direction,full=False):
        global target
        if full:target=(full_min+full_max)/2;data.ortho_scale=(full_max.y-full_min.y)*1.15 if direction[0] else 3.65
        else:target=center.copy();data.ortho_scale=1.45
        camera.location=target+Vector(direction)*5;aim(camera);scene.render.filepath=str(REVIEW/(name+'.png'));bpy.ops.render.render(write_still=True)
    capture('head-front',(0,-1,0));capture('head-three',(.55,-1,.08));capture('standing-front',(0,-1,0),True);capture('standing-side',(1,0,0),True)
    for name in ('Shape_headWidth_high','Shape_cheeks_high','Shape_muzzle_low','Shape_eyeSpacing_high','Shape_eyeSize_high'):
        mesh.data.shape_keys.key_blocks[name].value=.8
    capture('edited-head-three',(.55,-1,.08))
