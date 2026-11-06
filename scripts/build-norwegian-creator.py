"""Create a conservative, editable copy of the supplied Norwegian Forest cat.

Run with Blender --background --factory-startup --disable-autoexec --threads 3
--python-exit-code 1 --python scripts/build-norwegian-creator.py

The downloaded source is never overwritten. Shape keys use an anatomical head
frame, original skin weights and connected eye components. Neutral mesh, UVs,
rig, textures and original animation are retained. This is not a hair groom.
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

ROOT = Path.cwd()
SOURCE = ROOT / 'assets/source/user-animal-pack-2026-11-04/norwegian-forest/source/Norwegianforest.glb'
OUT = ROOT / 'public/models/creator'
REVIEW = ROOT / 'artifacts/norwegian-creator'
BLEND = ROOT / 'assets/authored/norwegian-creator.blend'
OUT.mkdir(parents=True, exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)
source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
import importlib.util
_refine_spec = importlib.util.spec_from_file_location('foundation_face', ROOT/'scripts/refine-foundation-face.py')
face_refinement = importlib.util.module_from_spec(_refine_spec)
_refine_spec.loader.exec_module(face_refinement)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
scene = bpy.context.scene
scene.frame_set(1)
mesh = bpy.data.objects['Object010']
rig = mesh.find_armature()
mesh.name = 'NorwegianCat_Surface'
rig.name = 'NorwegianCat_Rig'
for bone in rig.pose.bones:
    bone.custom_shape = None
for obj in list(scene.objects):
    if obj.type == 'MESH' and obj != mesh:
        bpy.data.objects.remove(obj, do_unlink=True)

base = np.array([tuple(v.co) for v in mesh.data.vertices], dtype=np.float64)
original = base.copy()
groups = {g.name: g.index for g in mesh.vertex_groups}
weights = np.zeros((len(base), len(groups)), dtype=np.float64)
for vertex in mesh.data.vertices:
    for membership in vertex.groups:
        weights[vertex.index, membership.group] = membership.weight
head_names = [n for n in groups if n in ('head', 'jaw') or 'eye' in n or 'Bone008' in n or 'Bone009' in n]
head_weight = np.clip(sum(weights[:, groups[n]] for n in head_names), 0, 1)
eye_bones = [rig.data.bones[n].head_local.copy() for n in ('PantherL_eye', 'PantherR_eye')]
right = eye_bones[0] - eye_bones[1]
right.z = 0
right.normalize()
up = Vector((0, 0, 1))
forward = right.cross(up).normalized()
eye_mid = (eye_bones[0] + eye_bones[1]) / 2
origin = eye_mid - forward * .010 - up * .004
basis = np.array([tuple(right), tuple(forward), tuple(up)])
local = (base - np.array(origin)) @ basis.T

def smooth(a, b, value):
    t = np.clip((value-a)/(b-a), 0, 1)
    return t*t*(3-2*t)

head_weight *= smooth(.192, .222, base[:, 2])

# Discover the actual disconnected eyeballs rather than guessing a screen mask.
parent = list(range(len(base)))
def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i
for edge in mesh.data.edges:
    a, b = map(find, edge.vertices)
    parent[a] = b
components = {}
for i in range(len(base)):
    components.setdefault(find(i), []).append(i)
eye_components = []
for name, bone_position in zip(('L', 'R'), eye_bones):
    candidates = []
    for indices in components.values():
        if not 100 <= len(indices) <= 200:
            continue
        center = base[indices].mean(axis=0)
        distance = np.linalg.norm(center-np.array(bone_position))
        if distance < .012:
            candidates.append((distance, indices, center))
    if not candidates:
        raise RuntimeError('Could not locate the original eyeball component')
    _, indices, center = min(candidates, key=lambda item: item[0])
    eye_components.append((name, indices, (center-np.array(origin))@basis.T))

eyes = []
for name, indices, center in eye_components:
    radii = np.array((.020, .026, .021))
    radius = np.linalg.norm((local-center)/radii, axis=1)
    mask = 1-smooth(.56, 1.5, radius)
    mask[indices] = 1
    eyes.append((name, indices, center, mask))

# Source ear hair and facial whiskers share the body material. The old size/head
# heuristic removed both; preserve the artist's ear coat using its original ear
# skin weights. In this source all 342 ear components have mean weight > .024,
# while the 44 muzzle/brow whisker components have exactly zero ear weight.
native_ear_bones = [n for n in groups if 'Bone008' in n or 'Bone009' in n]
native_ear_weights = np.clip(sum(weights[:, groups[n]] for n in native_ear_bones), 0, 1)
native_coat_report = {'earBones':native_ear_bones}
removed_card_faces = face_refinement.remove_native_cards(
    mesh, base, head_weight, [indices for _,indices,_,_ in eyes],
    preserve_weights=native_ear_weights, report=native_coat_report)

ear_names = ('PantherRibcageBone001Bone001Bone001Bone008', 'PantherRibcageBone001Bone001Bone001Bone009')
ears = []
for name in ear_names:
    pos = np.array(rig.data.bones[name].head_local)
    center = (pos-np.array(origin))@basis.T
    root = center.copy()
    root[2] -= .010
    side = 1 if center[0] > 0 else -1
    ear_group = sum(weights[:, groups[n]] for n in groups if (('Bone008' in n and '(1)' not in n and side == 1) or ('Bone009' in n and side == -1) or (side == -1 and 'Bone008Bone001 (1)' in n)))
    spatial = smooth(root[2]-.004, root[2]+.016, local[:, 2]) * (1-smooth(.022, .049, np.abs(local[:, 0]-center[0])))
    mask = np.clip(np.maximum(ear_group, spatial), 0, 1)*head_weight
    mask *= smooth(root[2]-.009, root[2]+.009, local[:, 2])
    ears.append((side, root, mask))

x, depth, height = local.T
# Head width/depth may combine with the round preset. Attenuate only the back
# neck transition; the optical rim, muzzle and the whole head silhouette retain
# their existing ranges. This avoids folding the source's sharply weighted ring.
back_neck = (1-smooth(.225,.250,base[:,2]))*(1-smooth(.010,.030,depth))
head_deform_weight = head_weight*(1-.70*back_neck)
muzzle = np.exp(-((x/.030)**4 + ((height+.026)/.024)**4)) * smooth(.007, .030, depth) * head_weight
cheeks = np.exp(-((np.abs(x)-.033)/.024)**2-((height+.015)/.025)**2-((depth-.002)/.035)**2)*head_weight
# The jaw control belongs to the forward chin, not the back-neck ring.
jaw_mask = (1-smooth(-.016, .003, height))*smooth(.006, .027, depth)*head_weight
bridge = np.exp(-(x/.014)**2-((height+.004)/.022)**2)*smooth(.006, .022, depth)*head_weight

def protect_eyes(delta, transform):
    """Keep each eyeball rigid while moving its socket, not stretching its iris."""
    for _, _, center, mask in eyes:
        rigid = transform(center)-center
        delta = delta*(1-mask[:, None]) + rigid[None, :]*mask[:, None]
    if key not in ('headWidth','headDepth','eyeSize','eyeSpacing','eyeTilt'):
        for _, indices, _, _ in eyes:
            delta[indices]=0
    return delta

def deformation(key, sign):
    delta = np.zeros_like(local)
    if key == 'headWidth':
        delta[:, 0] = x*.12*head_deform_weight*sign
        delta = protect_eyes(delta, lambda c: c+np.array((c[0]*.12*sign, 0, 0)))
    elif key == 'headDepth':
        delta[:, 1] = depth*.09*head_deform_weight*sign
        delta = protect_eyes(delta, lambda c: c+np.array((0, c[1]*.09*sign, 0)))
    elif key == 'cheeks':
        delta[:, 0] = np.tanh(x/.016)*.0050*cheeks*sign
        delta[:, 1] = .0016*cheeks*sign
    elif key == 'jaw':
        delta[:, 0] = x*.115*jaw_mask*sign
        delta[:, 2] = -.0014*jaw_mask*sign
    elif key == 'muzzle':
        delta[:, 1] = .0055*muzzle*sign
    elif key == 'muzzleWidth':
        delta[:, 0] = x*.14*muzzle*sign
    elif key == 'noseBridge':
        delta[:, 1] = .0027*bridge*sign
        delta[:, 2] = .0018*bridge*sign
    elif key.startswith('eye'):
        for _, _, center, mask in eyes:
            offset = local-center
            if key == 'eyeSize':
                d = offset*.095*sign
            elif key == 'eyeSpacing':
                d = np.zeros_like(local)
                d[:, 0] = np.sign(center[0])*.0024*sign
            elif key == 'eyeTilt':
                angle = math.radians(7)*np.sign(center[0])*sign
                d = np.zeros_like(local)
                d[:, 0] = offset[:, 0]*(math.cos(angle)-1)-offset[:, 2]*math.sin(angle)
                d[:, 2] = offset[:, 0]*math.sin(angle)+offset[:, 2]*(math.cos(angle)-1)
            delta += d*mask[:, None]
    elif key.startswith('ear'):
        for side, center, mask in ears:
            offset = local-center
            if key == 'earSize':
                d = offset*.17*sign
            else:
                angle = math.radians(12)*side*sign
                d = np.zeros_like(local)
                d[:, 0] = offset[:, 0]*(math.cos(angle)-1)+offset[:, 2]*math.sin(angle)
                d[:, 2] = -offset[:, 0]*math.sin(angle)+offset[:, 2]*(math.cos(angle)-1)
            delta += d*mask[:, None]
    if key not in ('headWidth','headDepth','eyeSize','eyeSpacing','eyeTilt'):
        for _, indices, _, _ in eyes:
            delta[indices]=0
    return delta

mesh.shape_key_add(name='Basis', from_mix=False)
reports = {}
def add_target(name, delta):
    target = mesh.shape_key_add(name=name, from_mix=False)
    target.slider_min = 0
    target.slider_max = 1
    points = base + delta@basis
    target.data.foreach_set('co', points.astype(np.float32).ravel())
    displacement = np.linalg.norm(points-base, axis=1)
    reports[name] = {'changedVertices': int(np.sum(displacement > 1e-7)), 'maxDisplacementSourceMeters': float(displacement.max())}

keys = ['headWidth', 'headDepth', 'cheeks', 'jaw', 'muzzle', 'muzzleWidth', 'noseBridge', 'eyeSize', 'eyeSpacing', 'eyeTilt', 'earSize', 'earTilt']
for key in keys:
    for suffix, sign in (('low', -1), ('high', 1)):
        add_target('Shape_'+key+'_'+suffix, deformation(key, sign))
round_delta = deformation('headWidth', .55)+deformation('cheeks', .6)+deformation('jaw', .25)+deformation('muzzle', -.18)
wedge_delta = deformation('headWidth', -.45)+deformation('cheeks', -.25)+deformation('headDepth', .35)+deformation('muzzle', .35)
add_target('Head_round', round_delta)
add_target('Head_wedge', wedge_delta)
face_report = face_refinement.author_face_refinement(mesh, base, basis, origin, [indices for _,indices,_,_ in eyes], 'norwegian', head_weight)
face_report.pop('closedPoints')
for _target in mesh.data.shape_keys.key_blocks:
    if _target.name=='Basis':continue
    _points=np.array([tuple(v.co)for v in _target.data])
    _distance=np.linalg.norm(_points-base,axis=1)
    reports[_target.name]={'changedVertices':int(np.sum(_distance>1e-7)),'maxDisplacementSourceMeters':float(_distance.max())}

assert np.array_equal(original, np.array([tuple(v.co)for v in mesh.data.vertices]))

# Use the source's quiet grounded stance, then align the actual neck/head with
# the body's forward axis. This is a persistent pose, not a camera trick. The
# untouched source action remains in a muted NLA track for independent export.
scene.frame_set(53)
bpy.context.view_layer.update()
source_action = rig.animation_data.action
source_action_slot = rig.animation_data.action_slot
source_action.use_fake_user = True
existing_tracks = [track for track in rig.animation_data.nla_tracks if any(strip.action == source_action for strip in track.strips)]
if existing_tracks:
    track = existing_tracks[0]
else:
    track = rig.animation_data.nla_tracks.new()
    strip = track.strips.new(source_action.name, int(source_action.frame_range[0]), source_action)
    strip.action_slot = source_action_slot
track.name = 'Source animation (not the default pose)'
track.mute = True
rig.animation_data.action = None
bpy.context.view_layer.update()
posed_right = rig.pose.bones['PantherL_eye'].head - rig.pose.bones['PantherR_eye'].head
posed_forward = posed_right.cross(up)
posed_forward.z = 0
posed_forward.normalize()
yaw_correction = -math.pi/2-math.atan2(posed_forward.y, posed_forward.x)
yaw_correction = math.atan2(math.sin(yaw_correction), math.cos(yaw_correction))
for name, fraction in [('neck_01', .40), ('neck_02', .35), ('head', .25)]:
    bone = rig.pose.bones[name]
    pivot = bone.head.copy()
    correction = Matrix.Translation(pivot) @ Matrix.Rotation(yaw_correction*fraction, 4, 'Z') @ Matrix.Translation(-pivot)
    bone.matrix = correction @ bone.matrix
    bpy.context.view_layer.update()
# Remove the source's sideways head lean so the default eye line is level.
eye_line = rig.pose.bones['PantherL_eye'].head-rig.pose.bones['PantherR_eye'].head
roll_correction = -math.atan2(eye_line.z, eye_line.x)
bone = rig.pose.bones['head']
pivot = bone.head.copy()
correction = Matrix.Translation(pivot) @ Matrix.Rotation(roll_correction, 4, Vector((0, -1, 0))) @ Matrix.Translation(-pivot)
bone.matrix = correction @ bone.matrix
bpy.context.view_layer.update()

# Ground each paw using its real skinned sole vertices. Translating the palm
# bone by this tiny offset also moves its digit children and preserves topology.
paw_names = ['PantherLLegPalm', 'PantherRLegPalm', 'PantherLLegPalm (1)', 'PantherRLegPalm (1)']
paw_indices = {}
for palm_name in paw_names:
    suffix = ' (1)' if '(1)' in palm_name else ''
    prefix = palm_name.replace('Palm'+suffix, '')
    member_names = [prefix+'Palm'+suffix, prefix+'Digit01'+suffix, prefix+'Digit02'+suffix]
    ids = [groups[name]for name in member_names]
    paw_indices[palm_name] = np.where(weights[:, ids].sum(axis=1)>.75)[0]
deps = bpy.context.evaluated_depsgraph_get()
evaluated = mesh.evaluated_get(deps)
paw_low = {name:min(evaluated.data.vertices[int(i)].co.z for i in ids)for name, ids in paw_indices.items()}
sole_height = min(paw_low.values())
for name in paw_names:
    bone = rig.pose.bones[name]
    transform = bone.matrix.copy()
    transform.translation.z += sole_height-paw_low[name]
    bone.matrix = transform
    bpy.context.view_layer.update()
standing_basis = {bone.name: bone.matrix_basis.copy()for bone in rig.pose.bones}

# Keep the source coordinate system inside a single normalizing root. glTF's
# conversion then yields Y-up/+Z-facing. No source mesh point is transformed.
bpy.context.view_layer.update()
points = [mesh.matrix_world@Vector(c)for c in mesh.evaluated_get(bpy.context.evaluated_depsgraph_get()).bound_box]
low = Vector(tuple(min(p[i]for p in points)for i in range(3)))
high = Vector(tuple(max(p[i]for p in points)for i in range(3)))
scale = 3/(high.z-low.z)
angle = 0.0  # Source body faces -Y; glTF conversion makes this +Z.
rotation = Matrix.Rotation(angle, 4, 'Z')
root = bpy.data.objects.new('NorwegianCat_Creator', None)
scene.collection.objects.link(root)
root.rotation_euler.z = angle
root.scale = (scale,)*3
root.location = (0, 0, -low.z*scale)
for obj in list(scene.objects):
    if obj != root and obj.parent is None:
        obj.parent = root
bpy.context.view_layer.update()

def canonical(source_position):
    p = root.matrix_world@Vector(source_position)
    return [float(p.x), float(p.z), float(-p.y)]

# Bounds and picking landmarks refer to the actual posed neutral asset, not an
# axis-aligned box inflated by all morph endpoints at once.
deps = bpy.context.evaluated_depsgraph_get()
evaluated = mesh.evaluated_get(deps)
head_indices = np.where(head_weight > .6)[0]
world_head = [canonical(evaluated.data.vertices[int(i)].co)for i in head_indices]
head_bounds = {'min': [min(p[a]for p in world_head)for a in range(3)], 'max': [max(p[a]for p in world_head)for a in range(3)]}
landmarks = {
    'eyeCenters': [canonical(sum((evaluated.data.vertices[int(i)].co for i in indices), Vector())/len(indices))for _, indices, _, _ in eyes],
    'earBases': [canonical(rig.pose.bones[name].matrix @ rig.data.bones[name].matrix_local.inverted() @ Vector(np.array(origin)+center@basis))for name, (_, center, _) in zip(ear_names, ears)],
    'muzzleCenter': canonical(sum((evaluated.data.vertices[int(i)].co for i in np.where(muzzle>.75)[0]), Vector())/int(np.sum(muzzle>.75))),
}
# Compact landmark/sole samples let independent browser tests check the
# exported pose rather than trusting a posture label.
paw_report = {}
for name, indices in paw_indices.items():
    points = [canonical(evaluated.data.vertices[int(i)].co)for i in indices]
    bottom = min(point[1]for point in points)
    paw_report[name] = {'minY':bottom, 'center':[float(np.mean([point[a]for point in points]))for a in range(3)]}
posed_eye_right = np.array(landmarks['eyeCenters'][0])-np.array(landmarks['eyeCenters'][1])
posed_gaze = np.cross(posed_eye_right, np.array([0, 1, 0]))
if posed_gaze[2] < 0: posed_gaze = -posed_gaze
posed_gaze = posed_gaze / np.linalg.norm(posed_gaze)
pose_report = {'name':'standing-front', 'sourceFrame':53, 'yawCorrectionDegrees':math.degrees(yaw_correction), 'rollCorrectionDegrees':math.degrees(roll_correction), 'headForward':posed_gaze.tolist(), 'bodyForward':[0,0,1], 'paws':paw_report, 'groundSpread':max(p['minY']for p in paw_report.values())-min(p['minY']for p in paw_report.values())}
eye_geometry = []
for eye_index, eye_ids in enumerate(face_report['eyeIds']):
    eye_points = [canonical(evaluated.data.vertices[int(i)].co)for i in eye_ids]
    eye_geometry.append({'side':'L'if eye_index==0 else'R','center':[float(np.mean([p[a]for p in eye_points]))for a in range(3)],'min':[min(p[a]for p in eye_points)for a in range(3)],'max':[max(p[a]for p in eye_points)for a in range(3)]})
extras = {
    'creatorTemplateId': 'norwegian-cat-v1',
    'creatorEyeGeometry':eye_geometry,
    'creatorHeadBounds': head_bounds,
    'creatorLandmarks': landmarks,
    'creatorFeatures': {'blink': True, 'fur': False},
    'creatorDefaultPose': pose_report,
    'creatorFaceRefinement': {k:v for k,v in face_report.items()if k!='eyeIds'},
    'creatorGroom': {'removedWhiskerCards':bool(removed_card_faces),'removedCardFaces':removed_card_faces},
    'creatorNativeCoat': native_coat_report,
    'creatorRuntimeFur': {'implementation':'lib/norwegian-fur.ts', 'regions':['head','ruff','body'], 'geometry':'real mesh strands rooted on evaluated skinned and morphed surface', 'nativeGlbFur':False},
    'creatorSourceSha256': source_hash,
    'creatorSourceLicense': 'User supplied; permission for redistribution/export not verified',
}
for key, value in extras.items():
    scene[key] = value
    root[key] = value
mesh['creatorPart'] = 'head'
for key in mesh.data.shape_keys.key_blocks:
    key.value = 0

BLEND.parent.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
temporary_glb = OUT/'.norwegian-cat.build.glb'
_sparse_export = {key: True for key in ('export_try_sparse_sk','export_try_omit_sparse_sk') if key in bpy.ops.export_scene.gltf.get_rna_type().properties}
bpy.ops.export_scene.gltf(filepath=str(temporary_glb), export_format='GLB', export_extras=True, export_animations=True, export_morph=True, export_morph_normal=True, export_morph_tangent=False, export_skins=True, export_yup=True, export_cameras=False, export_lights=False, export_current_frame=True, export_rest_position_armature=False, **_sparse_export)
os.replace(temporary_glb, OUT/'norwegian-cat.glb')
# Animation sampling changes pose channels. Restore the authored default for
# inspection renders; the saved .blend already contains this stance.
rig.animation_data.action = None
for name, matrix in standing_basis.items():
    rig.pose.bones[name].matrix_basis = matrix
bpy.context.view_layer.update()

manifest = {
    'templateId': 'norwegian-cat-v1', 'modelUrl': '/models/creator/norwegian-cat.glb',
    'source': str(SOURCE.relative_to(ROOT)), 'sourceSha256': source_hash,
    'sourceUnchanged': hashlib.sha256(SOURCE.read_bytes()).hexdigest()==source_hash,
    'outputSha256': hashlib.sha256((OUT/'norwegian-cat.glb').read_bytes()).hexdigest(),
    'neutralMeshUnchanged': True, 'defaultPose': pose_report, 'sourceVertices': len(base),
    'boneCount': len(rig.data.bones), 'blender': bpy.app.version_string,
    'shapeTargets': reports, 'shapeControlKeys': ['headRound', 'headWedge']+keys,
    'headBounds': head_bounds, 'landmarks': landmarks,
    'features': {'blink': True, 'fur': False, 'originalAnimationRetained': True},
    'notes': 'Original body bind mesh, UVs, material, textures, skin weights and animation preserved; authored grounded standing front pose. Conservative authored local shape keys; no reconstructed head, simulated hair groom, or certified production rig behavior.',
    **extras,
}
(OUT/'norwegian-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
(REVIEW/'build-report.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps(manifest, ensure_ascii=False))

if '--render' in sys.argv:
    render_output = REVIEW/'blender'
    render_output.mkdir(parents=True, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 800
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'Filmic'
    scene.view_settings.look = 'Medium High Contrast'
    world = bpy.data.worlds.new('Norwegian review world')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.25, .25, .25, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .5
    scene.world = world
    target = Vector((0, -(landmarks['muzzleCenter'][2]+landmarks['eyeCenters'][0][2])/2, 2.51))
    def aim(obj):
        obj.rotation_euler = (target-obj.location).to_track_quat('-Z', 'Y').to_euler()
    for name, location, power, size, color in [
        ('Key', (-3, -4, 6), 450, 4, (1, .97, .92)),
        ('Fill', (3, -1, 4), 160, 4, (.92, .96, 1)),
        ('Rim', (1, 2, 5), 300, 3, (1, 1, 1)),
    ]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = power
        data.shape = 'DISK'
        data.size = size
        data.color = color
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = location
        aim(obj)
    camera_data = bpy.data.cameras.new('Comparison camera')
    camera = bpy.data.objects.new('Comparison camera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 1.40
    clay = bpy.data.materials.new('Comparison clay')
    clay.use_nodes = True
    bsdf = clay.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (.42, .42, .42, 1)
    bsdf.inputs['Roughness'].default_value = .85
    def capture(name, direction, gray=False):
        camera.location = target+Vector(direction)*5
        aim(camera)
        scene.view_layers[0].material_override = clay if gray else None
        scene.render.filepath = str(render_output/(name+'.png'))
        bpy.ops.render.render(write_still=True)
    capture('neutral-material-front', (0, -1, 0))
    capture('neutral-material-side', (1, 0, 0))
    capture('neutral-clay-three', (.5, -1, .16), True)
    capture('neutral-material-three', (.5, -1, .16))
    for name in ('Shape_headWidth_high', 'Shape_cheeks_high', 'Shape_muzzle_low', 'Shape_eyeSpacing_high', 'Shape_eyeSize_high', 'Shape_earSize_low'):
        mesh.data.shape_keys.key_blocks[name].value = .8
    capture('edited-clay-three', (.5, -1, .16), True)
    capture('edited-material-front', (0, -1, 0))
    capture('edited-material-side', (1, 0, 0))
    capture('edited-material-three', (.5, -1, .16))
    # Whole-body views explicitly show the grounded, genuinely forward stance.
    for key in mesh.data.shape_keys.key_blocks:
        key.value = 0
    target = Vector((0, 0, 1.5))
    camera_data.ortho_scale = 3.65
    capture('standing-authored-front', (0, -1, 0))
    target = Vector((0, .6, 1.5))
    camera_data.ortho_scale = 6.5
    capture('standing-authored-side', (1, 0, 0))
