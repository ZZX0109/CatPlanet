"""Editable, source-preserving Blender Hair Curves study; never writes web assets.

Blender --background --factory-startup --disable-autoexec --threads 3
  --python scripts/build-native-coat-study.py -- --variant source --view head

The source mesh is already the visible coat envelope. Millimetre figures below
are display calibration assumptions (300 mm standing height), not measurements.
"""
from pathlib import Path
import argparse
import bisect
import hashlib
import json
import math
import sys
import time

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/native-coat-study'
AUTHORED = ROOT / 'assets/authored'
SOURCE = AUTHORED / 'norwegian-creator.blend'
OUT.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--variant', choices=['source', 'short', 'long'], default='source')
parser.add_argument('--view', choices=['head', 'side', 'tail', 'head-front'], default='head')
parser.add_argument('--samples', type=int, default=24)
parser.add_argument('--resolution', type=int, default=640)
parser.add_argument('--no-render', action='store_true')
parser.add_argument('--render-saved', action='store_true', help='Render existing editable study without rebuilding any curve')
parser.add_argument('--verify-web-binding', action='store_true', help='Check every exported root against the read-only web reference surface')
parser.add_argument('--field', type=str)
parser.add_argument('--seed', type=int, default=8841)
parser.add_argument('--tail-volume', action='store_true', help='Independent v3 tail support/volume reconstruction; preserves v2 studies')
parser.add_argument('--native-envelope', choices=['source', 'short', 'long'], help='Only sculpt existing coat envelope with a reversible shape key; no new hair geometry')
ARGS = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
if ARGS.tail_volume:
    ARGS.variant = 'long'
if ARGS.native_envelope:
    ARGS.variant = ARGS.native_envelope

VIEWS = {
    'head': ((0, -1.40, 2.16), (3.0, -5.5, 2.0), 1.95),
    'head-front': ((0, -1.47, 2.20), (0, -6, .45), 1.90),
    'side': ((0, .47, 1.5), (7, -2.8, 1.8), 5.85),
    'tail': ((0, 2.22, 1.65), (5, 2.7, 1.35), 2.75),
}

def set_view(scene):
    target, direction, scale = VIEWS[ARGS.view]
    target = Vector(target)
    scene.camera.location = target+Vector(direction)
    scene.camera.rotation_euler = (target-scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera.data.ortho_scale = scale
    bpy.context.view_layer.update()

def capture_scene_config(scene, mesh):
    bpy.context.view_layer.update()
    return {
        'cameraWorldMatrix': [list(row) for row in scene.camera.matrix_world],
        'cameraProjection': scene.camera.data.type, 'cameraOrthoScale': scene.camera.data.ortho_scale,
        'lights': [{'name': o.name, 'matrix': [list(row) for row in o.matrix_world],
                    'energy': o.data.energy, 'color': list(o.data.color), 'size': o.data.size}
                   for o in scene.objects if o.type == 'LIGHT'],
        'worldColor': list(scene.world.node_tree.nodes['Background'].inputs['Color'].default_value),
        'worldStrength': scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value,
        'colorManagement': {'view': scene.view_settings.view_transform, 'look': scene.view_settings.look,
                             'exposure': scene.view_settings.exposure, 'gamma': scene.view_settings.gamma},
        'sourceNormalStrengths': {m.name: [n.inputs['Strength'].default_value for n in m.node_tree.nodes if n.type == 'NORMAL_MAP']
                                  for m in mesh.data.materials},
    }

if ARGS.verify_web_binding:
    reference = OUT/'web-reference'
    ref_manifest = json.loads((reference/'manifest.json').read_text())
    wp = np.fromfile(reference/'positions.bin', dtype='<f4').reshape(-1, 3)
    wt = np.fromfile(reference/'index.bin', dtype='<u4').reshape(-1, 3)
    wu = np.fromfile(reference/'uv.bin', dtype='<f4').reshape(-1, 2)
    tree = BVHTree.FromPolygons([Vector(p) for p in wp], wt.tolist(), all_triangles=True)
    asset = json.loads((OUT/(ARGS.variant+'-asset.json')).read_text())
    bindings, distances, uv_errors = [], [], []
    for curve in asset['curves']:
        p = curve['root']
        root = Vector((p[0], p[2], -p[1]))
        uv = np.array([curve['uv'][0], 1-curve['uv'][1]])
        hit, normal, face, distance = tree.find_nearest(root)
        candidates = tree.find_nearest_range(root, max(1e-5, distance+1e-6))
        best = None
        for candidate, unused_normal, candidate_face, candidate_distance in candidates:
            indices = wt[candidate_face]
            a, b, c = wp[indices]
            v0, v1, v2 = b-a, c-a, np.array(candidate)-a
            aa, ab, bb = np.dot(v0, v0), np.dot(v0, v1), np.dot(v1, v1)
            qa, qb = np.dot(v2, v0), np.dot(v2, v1)
            determinant = max(float(aa*bb-ab*ab), 1e-18)
            s, t = (bb*qa-ab*qb)/determinant, (aa*qb-ab*qa)/determinant
            bary = np.array([1-s-t, s, t])
            reconstructed_uv = bary @ wu[indices]
            uv_error = float(np.linalg.norm(reconstructed_uv-uv))
            score = candidate_distance+uv_error*.01
            if best is None or score < best[0]:
                best = (score, candidate_face, bary, candidate_distance, uv_error)
        _, face, bary, distance, uv_error = best
        distances.append(distance)
        uv_errors.append(uv_error)
        bindings.append({'triangle': int(face), 'barycentric': bary.tolist(), 'distanceUnits': distance, 'uvError': uv_error})
    report = {'version': 1, 'variant': ARGS.variant, 'scope': 'All authored root P mapped to read-only web source by 3D+UV; no web asset modified',
              'referenceSource': ref_manifest['source'], 'roots': len(bindings),
              'distanceUnits': {'max': float(max(distances)), 'median': float(np.median(distances)), 'p99': float(np.percentile(distances, 99))},
              'uvError': {'max': float(max(uv_errors)), 'median': float(np.median(uv_errors)), 'p99': float(np.percentile(uv_errors, 99))},
              'mapping': {'position': '[x,z,-y]', 'uv': '[u,1-v]', 'normalGreenInverted': False}, 'bindings': bindings}
    (OUT/(ARGS.variant+'-web-binding.json')).write_text(json.dumps(report, separators=(',', ':')))
    print('WEB_BINDING_VERIFIED', json.dumps({k: v for k, v in report.items() if k != 'bindings'}), flush=True)
    sys.exit(0)

if ARGS.render_saved:
    saved_stem = 'v3-tail-volume' if ARGS.tail_volume else ARGS.variant
    output_stem = 'v3-tail-volume-long' if ARGS.tail_volume else ARGS.variant
    saved_name = 'native-coat-envelope-'+ARGS.native_envelope if ARGS.native_envelope else 'native-coat-study-'+saved_stem
    render_dir = ROOT/'artifacts/native-envelope-study' if ARGS.native_envelope else OUT
    bpy.ops.wm.open_mainfile(filepath=str(AUTHORED/(saved_name+'.blend')), load_ui=False)
    scene = bpy.context.scene
    set_view(scene)
    scene.cycles.samples = ARGS.samples
    scene.render.resolution_x = scene.render.resolution_y = ARGS.resolution
    manifest = json.loads(scene['nativeEnvelopeStudy' if ARGS.native_envelope else 'nativeCoatStudy'])
    manifest['render']['camera'] = ARGS.view
    manifest['render']['samples'] = ARGS.samples
    manifest['render']['resolution'] = ARGS.resolution
    manifest['sceneConfig'] = capture_scene_config(scene, bpy.data.objects['NorwegianCat_Surface'])
    manifest['sceneConfigSha256'] = hashlib.sha256(json.dumps(manifest['sceneConfig'], sort_keys=True).encode()).hexdigest()
    (render_dir/(output_stem+'-'+ARGS.view+'-manifest.json')).write_text(json.dumps(manifest, indent=2))
    if not ARGS.no_render:
        scene.render.filepath = str(render_dir/(output_stem+'-'+ARGS.view+'.png'))
        bpy.ops.render.render(write_still=True)
    print('RENDERED_SAVED_STUDY', ARGS.variant, ARGS.view, flush=True)
    sys.exit(0)

source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False)
scene = bpy.context.scene
mesh = bpy.data.objects['NorwegianCat_Surface']
rig = mesh.find_armature()
source_data = mesh.data
source_signature = {
    'vertices': len(source_data.vertices), 'polygons': len(source_data.polygons),
    'shapeKeys': len(source_data.shape_keys.key_blocks) if source_data.shape_keys else 0,
    'uvLayers': [u.name for u in source_data.uv_layers],
    'bones': len(rig.data.bones),
}
bpy.context.view_layer.update()
evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
surface = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=bpy.context.evaluated_depsgraph_get())
surface.calc_loop_triangles()
world = mesh.matrix_world
positions = np.array([tuple(world @ v.co) for v in surface.vertices], dtype=np.float64)
height = float(positions[:, 2].max()-positions[:, 2].min())
metres_per_unit = .300 / height
unit_per_mm = .001 / metres_per_unit
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = metres_per_unit

def setup_scene():
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = ARGS.samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 5
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 3
    scene.cycles.transmission_bounces = 3
    scene.cycles.transparent_max_bounces = 4
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.refresh_devices()
    has_metal = False
    for device in prefs.devices:
        device.use = device.type == 'METAL'
        has_metal |= device.type == 'METAL'
    scene.cycles.device = 'GPU' if has_metal else 'CPU'
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 3
    scene.render.resolution_x = ARGS.resolution
    scene.render.resolution_y = ARGS.resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    review_world = bpy.data.worlds.new('Native coat study neutral world')
    review_world.use_nodes = True
    review_world.node_tree.nodes['Background'].inputs['Color'].default_value = (.16, .18, .20, 1)
    review_world.node_tree.nodes['Background'].inputs['Strength'].default_value = .35
    scene.world = review_world
    light_target = Vector((0, -.5, 1.7))
    for name, location, power, size, color in [
        ('Study key', (-3, -4, 6), 550, 4, (1, .97, .92)),
        ('Study fill', (3, -2, 4), 220, 4, (.94, .97, 1)),
        ('Study soft rear', (2, 3, 4), 150, 3, (1, 1, 1)),
    ]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = power
        data.shape = 'DISK'
        data.size = size
        data.color = color
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (light_target-obj.location).to_track_quat('-Z', 'Y').to_euler()
    data = bpy.data.cameras.new('Native coat study camera')
    camera = bpy.data.objects.new(data.name, data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    data.type = 'ORTHO'
    data.dof.use_dof = False
    set_view(scene)

setup_scene()

triangles = np.array([t.vertices[:] for t in surface.loop_triangles], dtype=np.int32)
loop_triangles = np.array([t.loops[:] for t in surface.loop_triangles], dtype=np.int32)
uv_loops = np.array([tuple(d.uv) for d in surface.uv_layers[0].data], dtype=np.float64)
tri_uv = uv_loops[loop_triangles]
tri_pos = positions[triangles]
e1, e2 = tri_pos[:, 1]-tri_pos[:, 0], tri_pos[:, 2]-tri_pos[:, 0]
crosses = np.cross(e1, e2)
area = np.linalg.norm(crosses, axis=1)*.5
face_normals = crosses/np.maximum(2*area[:, None], 1e-12)
uv1, uv2 = tri_uv[:, 1]-tri_uv[:, 0], tri_uv[:, 2]-tri_uv[:, 0]
uv_det = uv1[:, 0]*uv2[:, 1]-uv1[:, 1]*uv2[:, 0]
safe_det = np.where(np.abs(uv_det) > 1e-12, uv_det, 1)
dpdu = (e1*uv2[:, 1, None]-e2*uv1[:, 1, None])/safe_det[:, None]
dpdv = (-e1*uv2[:, 0, None]+e2*uv1[:, 0, None])/safe_det[:, None]
vertex_normals = np.zeros_like(positions)
for corner in range(3):
    np.add.at(vertex_normals, triangles[:, corner], crosses)
vertex_normals /= np.maximum(np.linalg.norm(vertex_normals, axis=1)[:, None], 1e-12)
bvh = BVHTree.FromPolygons([Vector(p) for p in positions], triangles.tolist(), all_triangles=True)
weights = np.zeros((len(positions), len(mesh.vertex_groups)), dtype=np.float32)
for vertex in mesh.data.vertices:
    for membership in vertex.groups:
        weights[vertex.index, membership.group] = membership.weight
groups = {g.name: g.index for g in mesh.vertex_groups}
tail_weights = weights[:, [i for n, i in groups.items() if n.startswith('PantherTail')]].sum(axis=1)
head_weights = weights[:, groups['head']]
triangle_material = np.array([surface.polygons[t.polygon_index].material_index for t in surface.loop_triangles])

def smooth(a, b, x):
    v = np.clip((x-a)/(b-a), 0, 1)
    return v*v*(3-2*v)

def normal_and_uv(index, point):
    p0 = tri_pos[index, 0]
    a, b = e1[index], e2[index]
    q = np.asarray(point)-p0
    aa, ab, bb = np.dot(a, a), np.dot(a, b), np.dot(b, b)
    qa, qb = np.dot(q, a), np.dot(q, b)
    det = max(aa*bb-ab*ab, 1e-18)
    u, v = (bb*qa-ab*qb)/det, (aa*qb-ab*qa)/det
    bary = np.array([1-u-v, u, v])
    bary = np.clip(bary, 0, 1)
    bary /= max(bary.sum(), 1e-12)
    normal = bary @ vertex_normals[triangles[index]]
    normal /= max(np.linalg.norm(normal), 1e-12)
    return normal, bary @ tri_uv[index], bary

field = None
field_path = Path(ARGS.field) if ARGS.field else OUT.parent/'native-coat-flow/blender_uv_ready.bin'
field_manifest = None
if ARGS.variant != 'source' and not ARGS.native_envelope:
    if not field_path.is_file():
        raise RuntimeError('UV flow field is required for this study: '+str(field_path))
    raw = np.fromfile(field_path, dtype='<f4')
    field_size = int(math.sqrt(len(raw)/3))
    field = raw.reshape(field_size, field_size, 3)
    field_manifest = {'path': str(field_path.relative_to(ROOT)), 'sha256': hashlib.sha256(field_path.read_bytes()).hexdigest(),
                      'dimensions': [field_size, field_size, 3], 'layout': 'row0 Image_0 PNG top; theta basis u right / Blender v up',
                      'sample': 'x=u*W-.5; y=(1-v)*H-.5; clamp bilinear', 'components': ['cos(2 theta)', 'sin(2 theta)', 'confidence']}

def sample_field(uv):
    h, w = field.shape[:2]
    x, y = np.clip(uv[0]*w-.5, 0, w-1), np.clip((1-uv[1])*h-.5, 0, h-1)
    x0, y0 = int(x), int(y)
    x1, y1 = min(x0+1, w-1), min(y0+1, h-1)
    fx, fy = x-x0, y-y0
    samples = np.array([field[y0, x0], field[y0, x1], field[y1, x0], field[y1, x1]], dtype=np.float64)
    interpolation = np.array([(1-fx)*(1-fy), fx*(1-fy), (1-fx)*fy, fx*fy])
    confidence = float(np.dot(samples[:, 2], interpolation))
    director = np.sum(samples[:, :2]*(samples[:, 2]*interpolation)[:, None], axis=0)
    director_norm = float(np.linalg.norm(director))
    cancellation_ratio = director_norm/max(confidence, 1e-10)
    if director_norm > 1e-10:
        director /= director_norm
    return np.array([director[0], director[1], confidence, cancellation_ratio])

def anatomical_direction(region, point, normal):
    x, y, z = point
    if region == 'cheek':
        direction = np.array([(.8 if x > 0 else -.8), .52, -.45])
    elif region == 'chest':
        direction = np.array([np.tanh(x/.3)*.14, .08, -1.0])
    else:
        # Tail bones define an actual centreline; follow it toward the tip.
        centers = tail_centers
        j = min(range(len(centers)-1), key=lambda i: np.linalg.norm(point-(centers[i]+centers[i+1])*.5))
        direction = centers[j+1]-centers[j]
        direction /= max(np.linalg.norm(direction), 1e-12)
        direction = direction+np.array([0, 0, -.15])
    direction -= normal*np.dot(direction, normal)
    if np.linalg.norm(direction) < 1e-7:
        direction = np.cross(normal, np.array([1., 0, 0]))
    return direction/max(np.linalg.norm(direction), 1e-12)

tail_centers = [np.array(rig.matrix_world @ rig.pose.bones['PantherTail'+str(i)].head) for i in range(1, 6)]
tail_centers.append(np.array(rig.matrix_world @ rig.pose.bones['PantherTail5'].tail))

def comb_direction(region, point, index, normal, uv):
    anatomical = anatomical_direction(region, point, normal)
    value = sample_field(uv)
    confidence = float(np.clip(value[2], 0, 1))
    if confidence < .35 or value[3] < .65 or abs(uv_det[index]) < 1e-10:
        return anatomical, confidence, True
    theta = .5*math.atan2(float(value[1]), float(value[0]))
    direction = dpdu[index]*math.cos(theta)+dpdv[index]*math.sin(theta)
    direction -= normal*np.dot(direction, normal)
    direction /= max(np.linalg.norm(direction), 1e-12)
    if np.dot(direction, anatomical) < 0:
        direction = -direction
    influence = float(smooth(.35, .68, confidence))
    direction = anatomical*(1-influence)+direction*influence
    direction /= max(np.linalg.norm(direction), 1e-12)
    return direction, confidence, False

def hair_material():
    material = bpy.data.materials.new('Native-root albedo / Principled Hair study')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    hair = nodes.new('ShaderNodeBsdfHairPrincipled')
    hair.model = 'CHIANG'
    hair.parametrization = 'COLOR'
    hair.inputs['Roughness'].default_value = .60
    hair.inputs['Radial Roughness'].default_value = .65
    hair.inputs['Coat'].default_value = 0
    hair.inputs['IOR'].default_value = 1.55
    color = nodes.new('ShaderNodeAttribute')
    color.attribute_name = 'root_color'
    links.new(color.outputs['Color'], hair.inputs['Color'])
    links.new(hair.outputs['BSDF'], output.inputs['Surface'])
    return material

def albedo_sampler():
    image = next(l.from_node.image for l in mesh.data.materials[0].node_tree.links
                 if l.to_node.type == 'BSDF_PRINCIPLED' and l.to_socket.name == 'Base Color')
    iw, ih = image.size[:]
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(ih, iw, 4)
    # Confirmed with a real 1px RGB128 PNG + shader emission bake: byte .pixels
    # is encoded sRGB (.50196), while the shader receives linear (.21586).
    if image.colorspace_settings.name == 'sRGB':
        rgb = pixels[:, :, :3]
        pixels[:, :, :3] = np.where(rgb <= .04045, rgb/12.92, ((rgb+.055)/1.055)**2.4)
    def sample(uv):
        uv = np.asarray(uv)
        x, y = np.clip(uv[..., 0]*iw-.5, 0, iw-1), np.clip(uv[..., 1]*ih-.5, 0, ih-1)
        x0, y0 = x.astype(np.int32), y.astype(np.int32)
        x1, y1 = np.minimum(x0+1, iw-1), np.minimum(y0+1, ih-1)
        fx, fy = (x-x0)[..., None], (y-y0)[..., None]
        return (pixels[y0, x0]*(1-fx)+pixels[y0, x1]*fx)*(1-fy)+(pixels[y1, x0]*(1-fx)+pixels[y1, x1]*fx)*fy
    return sample

def build_tail_volume():
    """Rebuild a filled tail coat from inset support, not a raised fibre cage."""
    global tail_centers
    rng = np.random.default_rng(ARGS.seed+300)
    prefix = 'v3-tail-volume-long'
    binary_dir = OUT/'v3-tail-volume-binary'
    binary_dir.mkdir(exist_ok=True)
    original_copy = mesh.copy()
    original_copy.data = mesh.data.copy()
    original_copy.name = 'V3 reference / original surface and all original shape keys'
    scene.collection.objects.link(original_copy)
    original_copy.hide_render = True
    original_copy.hide_viewport = True
    # The terminal leaf bone points sideways in this asset. Its actual weighted
    # mesh tip supplies the last axis point; the five posed bone heads remain.
    tip_ids = np.where((tail_weights > .7) & (positions[:, 1] > np.percentile(positions[tail_weights > .7, 1], 99)))[0]
    tail_centers = tail_centers[:5]+[positions[tip_ids].mean(axis=0)]
    centers = np.asarray(tail_centers)
    segments = np.diff(centers, axis=0)
    lengths = np.linalg.norm(segments, axis=1)
    arc = np.r_[0., np.cumsum(lengths)]
    total_arc = float(arc[-1])

    def axis_projection(points):
        points = np.asarray(points)
        q = points[:, None, :]-centers[None, :-1, :]
        t = np.clip(np.sum(q*segments[None], axis=2)/np.sum(segments*segments, axis=1)[None], 0, 1)
        closest = centers[None, :-1]+t[:, :, None]*segments[None]
        distance2 = np.sum((points[:, None]-closest)**2, axis=2)
        j = np.argmin(distance2, axis=1)
        s = arc[j]+t[np.arange(len(points)), j]*lengths[j]
        axis = closest[np.arange(len(points)), j]
        radial = points-axis
        radius = np.linalg.norm(radial, axis=1)
        return s, axis, radial, radius

    vertex_s, vertex_axis, radial, vertex_radius = axis_projection(positions)
    fade = smooth(.025, .15, vertex_s/total_arc)*(1-smooth(.91, 1.0, vertex_s/total_arc))
    fade *= smooth(.25, .8, tail_weights)
    inset_units = np.minimum(2.5*unit_per_mm, vertex_radius*.20)*fade
    world_offsets = -radial/np.maximum(vertex_radius[:, None], 1e-12)*inset_units[:, None]
    local_offsets = np.zeros_like(positions)
    bone_linear = {}
    for bone in rig.data.bones:
        bone_linear[bone.name] = np.array((rig.matrix_world @ rig.pose.bones[bone.name].matrix @ bone.matrix_local.inverted() @ rig.matrix_world.inverted() @ mesh.matrix_world).to_3x3())
    for vertex in mesh.data.vertices:
        if inset_units[vertex.index] < 1e-12:
            continue
        jacobian = np.zeros((3, 3))
        norm = 0.
        for membership in vertex.groups:
            name = mesh.vertex_groups[membership.group].name
            if name in bone_linear:
                jacobian += membership.weight*bone_linear[name]
                norm += membership.weight
        if norm > 1e-8:
            jacobian /= norm
        else:
            jacobian = np.array(mesh.matrix_world.to_3x3())
        local_offsets[vertex.index] = np.linalg.solve(jacobian, world_offsets[vertex.index])
    key = mesh.shape_key_add(name='NativeTailSupport_v3_inset_2p5mm', from_mix=False)
    original_local = np.array([tuple(v.co) for v in mesh.data.vertices])
    key.data.foreach_set('co', (original_local+local_offsets).astype(np.float32).ravel())
    key.value = 1
    bpy.context.view_layer.update()
    deformed = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    support_p = np.array([tuple(mesh.matrix_world @ v.co) for v in deformed.data.vertices], dtype=np.float64)
    support_tri = support_p[triangles]
    support_cross = np.cross(support_tri[:, 1]-support_tri[:, 0], support_tri[:, 2]-support_tri[:, 0])
    support_normals = np.zeros_like(support_p)
    for c in range(3):
        np.add.at(support_normals, triangles[:, c], support_cross)
    support_normals /= np.maximum(np.linalg.norm(support_normals, axis=1)[:, None], 1e-12)
    support_error = np.linalg.norm(support_p-(positions+world_offsets), axis=1)
    radius_report = []
    # Radius profile is measured from the actual coat; never assume a cylinder.
    profile_s = np.linspace(0, total_arc, 65)
    profile_radius = np.zeros(len(profile_s))
    tail_ids = tail_weights > .6
    for i, ss in enumerate(profile_s):
        ids = tail_ids & (np.abs(vertex_s-ss) < total_arc*.055)
        if ids.sum() < 3:
            ids = tail_ids & (np.abs(vertex_s-ss) < total_arc*.12)
        profile_radius[i] = np.median(vertex_radius[ids])
    profile_radius[-1] = 0
    for i in range(1, 64):
        profile_radius[i] = .25*profile_radius[i-1]+.5*profile_radius[i]+.25*profile_radius[i+1]
    kernel_x = np.arange(-8, 9)
    kernel = np.exp(-.5*(kernel_x/3.0)**2);kernel /= kernel.sum()
    profile_radius = np.convolve(np.pad(profile_radius, (8, 8), mode='edge'), kernel, mode='valid')
    profile_radius[-1] = 0
    for lo, hi in zip(np.linspace(0, 1, 9)[:-1], np.linspace(0, 1, 9)[1:]):
        ids = tail_ids & (vertex_s/total_arc >= lo) & (vertex_s/total_arc <= hi)
        if ids.any():
            old = vertex_radius[ids]/unit_per_mm
            new = (vertex_radius[ids]-inset_units[ids])/unit_per_mm
            radius_report.append({'sRange': [float(lo), float(hi)], 'count': int(ids.sum()),
                                  'sourceRadiusMmP10P50P90': np.percentile(old, [10, 50, 90]).tolist(),
                                  'supportRadiusMmP10P50P90': np.percentile(new, [10, 50, 90]).tolist()})

    # Smooth the five-joint axis by a Catmull-Rom sample, then parameterize it
    # by arc length so children follow the bent tail rather than floating out.
    dense = []
    for j in range(len(centers)-1):
        p0, p1 = centers[max(0, j-1)], centers[j]
        p2, p3 = centers[j+1], centers[min(len(centers)-1, j+2)]
        for t in np.linspace(0, 1, 40, endpoint=False):
            dense.append(.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t))
    dense.append(centers[-1])
    dense = np.asarray(dense)
    dense_s = np.r_[0., np.cumsum(np.linalg.norm(np.diff(dense, axis=0), axis=1))]
    dense_s *= total_arc/dense_s[-1]
    tangents = np.gradient(dense, axis=0)
    tangents /= np.maximum(np.linalg.norm(tangents, axis=1)[:, None], 1e-12)
    def axis_at(s):
        s = np.asarray(s)
        ss = np.clip(s, 0, total_arc)
        p = np.stack([np.interp(ss, dense_s, dense[:, j]) for j in range(3)], axis=-1)
        tangent = np.stack([np.interp(ss, dense_s, tangents[:, j]) for j in range(3)], axis=-1)
        tangent /= np.maximum(np.linalg.norm(tangent, axis=-1)[..., None], 1e-12)
        p += np.maximum(s-total_arc, 0)[..., None]*tangents[-1]
        u = np.zeros_like(tangent);u[..., 0] = 1
        u -= tangent*np.sum(u*tangent, axis=-1)[..., None]
        u /= np.maximum(np.linalg.norm(u, axis=-1)[..., None], 1e-12)
        v = np.cross(tangent, u)
        return p, tangent, u, v

    count, guide_count, knots = 150000, 2500, 12
    centroid_s = vertex_s[triangles].mean(axis=1)/total_arc
    tail_mask = smooth(.25, .75, tail_weights[triangles].mean(axis=1))*smooth(.015, .09, centroid_s)
    tail_mask *= (triangle_material == 0)
    sample_albedo = albedo_sampler()
    center_rgb = sample_albedo(tri_uv.mean(axis=1))[:, :3]
    pink = (center_rgb[:, 0] > center_rgb[:, 1]*1.25) & (center_rgb[:, 0] > center_rgb[:, 2]*1.25) & ((center_rgb[:, 0]-center_rgb[:, 1]) > .025)
    tail_mask *= ~pink
    cdf = np.cumsum(area*tail_mask)
    def sample_roots(n):
        face = np.searchsorted(cdf, rng.random(n)*cdf[-1])
        q = rng.random((n, 2));a = np.sqrt(q[:, 0])
        bary = np.stack([1-a, a*(1-q[:, 1]), a*q[:, 1]], axis=1)
        original = np.sum(tri_pos[face]*bary[:, :, None], axis=1)
        support = np.sum(support_tri[face]*bary[:, :, None], axis=1)
        uv = np.sum(tri_uv[face]*bary[:, :, None], axis=1)
        normal = np.sum(support_normals[triangles[face]]*bary[:, :, None], axis=1)
        normal /= np.maximum(np.linalg.norm(normal, axis=1)[:, None], 1e-12)
        return face, bary, original, support, uv, normal
    gf, gb, gp, gskin, guv, gn = sample_roots(guide_count)
    gs, ga, gr, gradius = axis_projection(gp)
    unused, gtangent, gu, gv = axis_at(gs)
    gphi = np.arctan2(np.sum(gr*gv, axis=1), np.sum(gr*gu, axis=1))
    guide_directions, guide_confidence = [], []
    for i in range(guide_count):
        direction, confidence, fallback = comb_direction('tail', gp[i], int(gf[i]), gn[i], guv[i])
        if np.dot(direction, gtangent[i]) < 0:
            direction = -direction
        guide_directions.append(direction)
        guide_confidence.append(confidence)
    guide_directions = np.asarray(guide_directions)
    kd = KDTree(guide_count)
    for i, p in enumerate(gp):
        kd.insert(Vector(p), i)
    kd.balance()
    face, bary, original_roots, skin_roots, uv, normal = sample_roots(count)
    parents = np.array([kd.find(Vector(p))[1] for p in original_roots], dtype=np.int32)
    rs, ra, rr, radii = axis_projection(original_roots)
    unused, root_tangent, ru, rv = axis_at(rs)
    phi = np.arctan2(np.sum(rr*rv, axis=1), np.sum(rr*ru, axis=1))
    parent_phi_delta = np.arctan2(np.sin(gphi[parents]-phi), np.cos(gphi[parents]-phi))
    azimuth = -ru*np.sin(phi)[:, None]+rv*np.cos(phi)[:, None]
    native_angular = np.sum(guide_directions[parents]*azimuth, axis=1)
    # Layered radial sampling fills the entire support-to-envelope interval.
    population = rng.random(count)
    layer = np.where(population < .50, 0, np.where(population < .97, 1, 2)).astype(np.int32)
    guide_lengths = np.stack([rng.uniform(11, 22, guide_count), rng.uniform(27, 39, guide_count), rng.uniform(39, 52, guide_count)], axis=1)
    guide_heights = np.stack([rng.uniform(2.5, 6.5, guide_count), rng.uniform(8.0, 13, guide_count), rng.uniform(13, 16, guide_count)], axis=1)
    length_mm = guide_lengths[parents, layer]*rng.uniform(.86, 1.14, count)
    height_mm = guide_heights[parents, layer]*rng.uniform(.88, 1.12, count)
    correlated = .9+.2*np.sin(gs[parents]*87+gphi[parents]*3)
    length_mm *= correlated
    height_mm *= .92+.16*rng.random(count)
    diameter_mm = rng.uniform(.025, .038, count)
    root_profile = np.interp(rs, profile_s, profile_radius)
    radius_ratio = np.clip(radii/np.maximum(root_profile, .03), .65, 1.30)
    # Guide-sized bundles converge gently; distinct children retain staggered
    # length, altitude and taper, so they do not form repeated ribbon cards.
    all_points = np.empty((count, knots, 3), dtype=np.float32)
    all_radii = np.empty((count, knots), dtype=np.float32)
    root_fade = smooth(.02, .18, rs/total_arc)
    skin_inset = np.linalg.norm(original_roots-skin_roots, axis=1)
    points_t0_error = []
    for k, t in enumerate(np.linspace(0, 1, knots)):
        advance = length_mm*unit_per_mm*t*(.88-.60*smooth(.88, 1, rs/total_arc))
        advance += (gs[parents]-rs)*.55*math.sin(t*math.pi/2)
        ss = rs+advance
        beyond = np.maximum(ss-total_arc, 0)
        ss = np.minimum(ss, total_arc)+8*unit_per_mm*np.tanh(beyond/(8*unit_per_mm))
        ax, tangent, u, v = axis_at(ss)
        profile = np.interp(np.minimum(ss, total_arc), profile_s, profile_radius)
        taper = np.sqrt(np.clip((total_arc+8*unit_per_mm-ss)/(28*unit_per_mm), 0, 1))
        base_r = np.maximum(profile*radius_ratio-skin_inset, 0)
        angle = phi+native_angular*(length_mm*unit_per_mm/np.maximum(radii, .07))*.24*t
        angle += parent_phi_delta*.68*math.sin(t*math.pi/2)
        radial_dir = u*np.cos(angle)[:, None]+v*np.sin(angle)[:, None]
        rise_profile = (1-math.exp(-3.7*t))/(1-math.exp(-3.7))*(1-.10*t)
        down_profile = .68*math.sin(math.pi*t)**.85+.32*t
        rise = height_mm*unit_per_mm*np.where(layer == 0, down_profile, rise_profile)*root_fade*taper
        waviness = np.sin(t*math.pi*1.6+gs[parents]*51)*(.10*unit_per_mm)*np.sin(t*math.pi)
        point = ax+radial_dir*(base_r+rise)[:, None]+v*waviness[:, None]
        # Skin binding is exact even where the smoothed centreline differs
        # slightly from the piecewise measured skeleton projection.
        if k == 0:
            point = skin_roots+normal*(.015*unit_per_mm)
        else:
            first_axis, _, first_u, first_v = axis_at(rs)
            skin_model = first_axis+(first_u*np.cos(phi)[:, None]+first_v*np.sin(phi)[:, None])*(np.maximum(radii-skin_inset, 0))[:, None]
            point += (skin_roots-skin_model)*(1-t)**2
        all_points[:, k] = point
        all_radii[:, k] = (diameter_mm*.5-.001)*unit_per_mm*(1-t)**.65+.001*unit_per_mm
    support_bvh = BVHTree.FromPolygons([Vector(p) for p in support_p], triangles.tolist(), all_triangles=True)
    min_clearance = float('inf')
    corrected_inside = 0
    for child in range(count):
        for k in range(1, knots):
            point = Vector(all_points[child, k])
            hit, hit_normal, hit_face, distance = support_bvh.find_nearest(point)
            signed = (point-hit).dot(hit_normal)
            min_clearance = min(min_clearance, signed)
            if signed < .01*unit_per_mm:
                all_points[child, k] = np.array(hit+hit_normal*(.02*unit_per_mm))
                corrected_inside += 1
    # Real spline geometry, with real per-point radii and parent membership.
    hair = bpy.data.hair_curves.new('V3 filled tail / 150k real child fibres')
    hair.add_curves([knots]*count)
    hair.set_types(type='CATMULL_ROM')
    hair.position_data.foreach_set('vector', all_points.ravel())
    a = hair.attributes.new('radius', 'FLOAT', 'POINT');a.data.foreach_set('value', all_radii.ravel())
    colors = sample_albedo(uv).astype(np.float32);colors[:, 3] = 1
    a = hair.attributes.new('root_color', 'FLOAT_COLOR', 'CURVE');a.data.foreach_set('color', colors.ravel())
    a = hair.attributes.new('parent_guide_index', 'INT', 'CURVE');a.data.foreach_set('value', parents)
    a = hair.attributes.new('hair_layer', 'INT', 'CURVE');a.data.foreach_set('value', layer)
    a = hair.attributes.new('surface_uv_coordinate', 'FLOAT2', 'CURVE');a.data.foreach_set('vector', uv.astype(np.float32).ravel())
    hair.surface = mesh;hair.surface_uv_map = source_signature['uvLayers'][0]
    obj = bpy.data.objects.new('V3 tail volume / down awn guard', hair)
    scene.collection.objects.link(obj);hair.materials.append(hair_material())
    obj['bindingNote'] = 'Roots on active inset support. Binary sourceRootP and skinRootP distinguish source binding and actual support; no zero-source-root-error claim.'
    # Editable representative parent curves; rendered children remain actual
    # geometry, not instanced visual substitutes.
    first_child = np.full(guide_count, -1, dtype=np.int32)
    for child, parent in enumerate(parents):
        if first_child[parent] < 0:
            first_child[parent] = child
    valid = first_child >= 0
    guide_points = all_points[first_child[valid]]
    guides_data = bpy.data.hair_curves.new('V3 shared parent guides')
    guides_data.add_curves([knots]*int(valid.sum()));guides_data.set_types(type='CATMULL_ROM')
    guides_data.position_data.foreach_set('vector', guide_points.ravel())
    guide_obj = bpy.data.objects.new('V3 shared guides / editable hidden reference', guides_data)
    scene.collection.objects.link(guide_obj);guide_obj.hide_render = True;guide_obj.hide_viewport = True
    files = {}
    def save_bin(name, values, dtype='<f4'):
        arr = np.asarray(values, dtype=dtype)
        path = binary_dir/(name+'.bin');arr.tofile(path)
        files[name] = {'file': str(path.relative_to(OUT)), 'dtype': str(arr.dtype), 'shape': list(arr.shape),
                       'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    for name, values, dtype in [
        ('positions', all_points, '<f4'), ('radii', all_radii, '<f4'), ('rootColorsLinear', colors, '<f4'),
        ('sourceRootP', original_roots, '<f4'), ('skinRootP', skin_roots, '<f4'), ('sourceRootUV', uv, '<f4'),
        ('skinRootNormals', normal, '<f4'), ('sourceTriangle', face, '<u4'), ('sourceBarycentric', bary, '<f4'),
        ('parentGuide', parents, '<u4'), ('layer', layer, '<u1'), ('sourceVertexOffsetsWorld', world_offsets, '<f4'),
        ('sourceVertexOffsetsLocal', local_offsets, '<f4'), ('originalSurfacePositions', positions, '<f4'),
        ('insetSupportPositions', support_p, '<f4')]:
        save_bin(name, values, dtype)
    arc_lengths = np.linalg.norm(np.diff(all_points, axis=1), axis=2).sum(axis=1)/unit_per_mm
    guide_records = [{'id': int(i), 'sourceRootP': gp[i].tolist(), 'sourceUV': guv[i].tolist(),
                      'direction': guide_directions[i].tolist(), 'confidence': float(guide_confidence[i]),
                      's': float(gs[i]), 'phi': float(gphi[i]), 'representativeChild': int(first_child[i])} for i in range(guide_count)]
    manifest = {
        'version': 3, 'iteration': 2, 'experiment': 'tail-volume reconstruction on reversible inset support', 'variant': 'long',
        'source': str(SOURCE.relative_to(ROOT)), 'sourceSha256': source_hash,
        'sourceFileUntouched': hashlib.sha256(SOURCE.read_bytes()).hexdigest() == source_hash,
        'sourceSignature': source_signature, 'originalCopy': original_copy.name,
        'supportShapeKey': key.name, 'supportShapeKeyValue': 1,
        'supportInsetMaxMm': float(inset_units.max()/unit_per_mm),
        'supportInsetMaxRadiusFraction': float(np.max(inset_units/np.maximum(vertex_radius, 1e-12))),
        'supportPoseReconstructionMaxErrorMm': float(support_error.max()/unit_per_mm),
        'radiusSections': radius_report, 'tailAxisWorld': centers.tolist(),
        'tailAxisTipSource': 'actual top 1% distal tail-weighted mesh points, not the sideways terminal bone endpoint',
        'newCurveCount': count, 'newCurvePointCount': count*knots, 'guideCount': guide_count,
        'layerCounts': {'down': int((layer == 0).sum()), 'awn': int((layer == 1).sum()), 'guard': int((layer == 2).sum())},
        'actualArcLengthMmP0P50P99P100': np.percentile(arc_lengths, [0, 50, 99, 100]).tolist(),
        'diameterMmRange': [float(diameter_mm.min()), float(diameter_mm.max())],
        'rootToSupportSurfaceOffsetMm': .015, 'rootInsetMmP0P50P100': np.percentile(skin_inset/unit_per_mm, [0, 50, 100]).tolist(),
        'minimumControlPointSignedClearanceBeforeRepairMm': min_clearance/unit_per_mm,
        'supportClearanceCorrectedControlPoints': corrected_inside,
        'rootBinding': 'Original source UV/P/triangle+bary stored separately from actual inset skinRootP; inherited pose/morph transfer not yet connected to web',
        'pointSpace': 'Blender world XYZ Z up', 'metresPerSceneUnit': metres_per_unit,
        'webFromBlenderWorld': '[x,z,-y]', 'rootUV': {'space': 'Blender UV up', 'rootUVToWebUV': '[u,1-v]'},
        'colorDomain': 'true linear RGB; sRGB byte texels decoded before bilinear filtering',
        'sourceMaterialMappings': 'UVMap -> identity Mapping -> Image Texture (verified)',
        'pinkBareSurfaceTriangleExclusionCount': int((pink & (tail_mask > 0)).sum()),
        'field': field_manifest, 'seed': ARGS.seed+300, 'files': files, 'guides': guide_records,
        'render': {'camera': ARGS.view, 'engine': 'Cycles', 'device': scene.cycles.device, 'samples': ARGS.samples,
                   'resolution': ARGS.resolution, 'dof': False, 'denoising': True, 'lightsSameAcrossVariants': True},
        'sceneConfig': capture_scene_config(scene, mesh),
    }
    manifest['sceneConfigSha256'] = hashlib.sha256(json.dumps(manifest['sceneConfig'], sort_keys=True).encode()).hexdigest()
    (OUT/(prefix+'-asset.json')).write_text(json.dumps(manifest, separators=(',', ':')))
    review = {k: v for k, v in manifest.items() if k != 'guides'}
    (OUT/(prefix+'-'+ARGS.view+'-manifest.json')).write_text(json.dumps(review, indent=2))
    scene['nativeCoatStudy'] = json.dumps(review)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(AUTHORED/'native-coat-study-v3-tail-volume.blend'), compress=True)
    print('V3_BUILT', json.dumps({k: v for k, v in review.items() if k not in ['files', 'sceneConfig', 'radiusSections']}), flush=True)
    if not ARGS.no_render:
        scene.render.filepath = str(OUT/(prefix+'-'+ARGS.view+'.png'))
        bpy.ops.render.render(write_still=True)

def build_native_envelope():
    """Local authored coat envelopes over preserved native topology/materials."""
    study = ROOT/'artifacts/native-envelope-study';study.mkdir(exist_ok=True)
    variant = ARGS.native_envelope
    original_keys = {k.name: hashlib.sha256(np.array([tuple(v.co) for v in k.data], dtype='<f4').tobytes()).hexdigest()
                     for k in mesh.data.shape_keys.key_blocks}
    # Exact-position weld is analysis only. Keep original ear tufts, globes and
    # detached anatomical pieces outside the editable main surface region.
    representatives = {};weld=[];wg=[]
    for i, v in enumerate(mesh.data.vertices):
        key = tuple(np.rint(np.array(v.co)*1e7).astype(np.int64))
        if key not in representatives:
            representatives[key] = len(wg);wg.append([])
        w=representatives[key];weld.append(w);wg[w].append(i)
    parent=list(range(len(wg)))
    def find(i):
        while parent[i]!=i:
            parent[i]=parent[parent[i]];i=parent[i]
        return i
    for edge in mesh.data.edges:
        parent[find(weld[edge.vertices[0]])]=find(weld[edge.vertices[1]])
    components={}
    for w, ids in enumerate(wg):
        components.setdefault(find(w), []).extend(ids)
    main_ids=max(components.values(), key=len)
    main=np.zeros(len(positions));main[main_ids]=1
    x,y,z=positions.T
    eye_indices=[i for n,i in groups.items() if 'eye' in n.lower()]
    eye_w=weights[:,eye_indices].sum(axis=1)
    protected=(z>2.22)|((head_weights>.60)&(z>1.94))|(eye_w>.01)
    editable=main*(~protected)
    chest=smooth(1.43,1.62,z)*(1-smooth(1.94,2.08,z))
    chest*=1-smooth(-1.16,-.96,y)
    chest*=smooth(.20,.55,-vertex_normals[:,1])
    chest*=1-smooth(.37,.56,np.abs(x))
    chest*=editable
    hind_ids=[i for n,i in groups.items() if n in ('PantherLLeg1','PantherLLeg2','PantherRLeg1','PantherRLeg2')]
    hind=weights[:,hind_ids].sum(axis=1)
    breeches=smooth(.25,.55,y)*smooth(.55,.78,z)*(1-smooth(1.42,1.64,z))
    breeches*=smooth(.12,.45,hind)*smooth(.25,.65,np.abs(vertex_normals[:,0]))*editable
    # Skin-weighted existing tail, with the true mesh tip replacing the asset's
    # sideways terminal leaf-bone endpoint. No new surface, cards or curves.
    ids=np.where((tail_weights>.7)&(y>np.percentile(y[tail_weights>.7],99)))[0]
    center=np.array(tail_centers[:5]+[positions[ids].mean(axis=0)])
    seg=np.diff(center,axis=0);lens=np.linalg.norm(seg,axis=1);arc=np.r_[0.,np.cumsum(lens)]
    q=positions[:,None]-center[None,:-1]
    t=np.clip(np.sum(q*seg[None],axis=2)/np.sum(seg*seg,axis=1)[None],0,1)
    closest=center[None,:-1]+t[:,:,None]*seg[None]
    j=np.argmin(np.sum((positions[:,None]-closest)**2,axis=2),axis=1)
    axis=closest[np.arange(len(positions)),j]
    radial=positions-axis;radius=np.linalg.norm(radial,axis=1)
    radial/=np.maximum(radius[:,None],1e-12)
    s=(arc[j]+t[np.arange(len(positions)),j]*lens[j])/arc[-1]
    tail=smooth(.35,.75,tail_weights)*smooth(.035,.18,s)*(1-smooth(.86,1.0,s))*editable
    delta=np.zeros_like(positions)
    if variant=='short':
        delta+=vertex_normals*(-2.2*unit_per_mm*chest)[:,None]
        delta[:,2]+=.4*unit_per_mm*chest
        compact=np.minimum(3.0*unit_per_mm,radius*.16)
        delta-=radial*(compact*tail)[:,None]
    elif variant=='long':
        # A sloping bib, local breeches and an oval tail plume. Belly, back,
        # face and eyes receive no uniform inflate, and no carved fur grooves.
        delta+=vertex_normals*(5.6*unit_per_mm*chest)[:,None]
        delta[:,2]-=2.4*unit_per_mm*chest
        delta[:,0]+=np.sign(x)*3.8*unit_per_mm*breeches
        delta[:,2]-=1.2*unit_per_mm*breeches
        lateral=np.abs(radial[:,0])
        plume=(5.0+2.0*lateral**1.5)*unit_per_mm
        delta+=radial*(plume*tail)[:,None]
        delta[:,2]-=.9*unit_per_mm*tail
    delta*=editable[:,None]
    local_delta=np.zeros_like(delta)
    bone_linear={b.name:np.array((rig.matrix_world@rig.pose.bones[b.name].matrix@b.matrix_local.inverted()@rig.matrix_world.inverted()@mesh.matrix_world).to_3x3())for b in rig.data.bones}
    for vertex in mesh.data.vertices:
        i=vertex.index
        if np.linalg.norm(delta[i])<1e-12:
            continue
        jac=np.zeros((3,3));norm=0.
        for member in vertex.groups:
            name=mesh.vertex_groups[member.group].name
            if name in bone_linear:
                jac+=member.weight*bone_linear[name];norm+=member.weight
        jac=jac/norm if norm>1e-8 else np.array(mesh.matrix_world.to_3x3())
        local_delta[i]=np.linalg.solve(jac,delta[i])
    key_name=None
    if variant!='source':
        key=mesh.shape_key_add(name='CoatEnvelope_native_'+variant,from_mix=False)
        base=np.array([tuple(v.co)for v in mesh.data.vertices])
        key.data.foreach_set('co',(base+local_delta).astype(np.float32).ravel());key.value=1
        key_name=key.name
    bpy.context.view_layer.update()
    final=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    actual=np.array([tuple(mesh.matrix_world@v.co)for v in final.data.vertices])
    error=np.linalg.norm(actual-(positions+delta),axis=1)/unit_per_mm
    unchanged_keys=all(hashlib.sha256(np.array([tuple(v.co)for v in mesh.data.shape_keys.key_blocks[name].data],dtype='<f4').tobytes()).hexdigest()==sha for name,sha in original_keys.items())
    ear_ids=[]
    dump=OUT/'native-component-dump.json'
    if dump.is_file():
        audit=json.loads(dump.read_text())
        ear_ids=sorted({i for c in audit['components'] if c['deletedAllFaces'] and c['earBoneWeight']>.01 for i in c['sourceVertexIds']})
    delta.astype('<f4').tofile(study/(variant+'-offsets-world.bin'))
    local_delta.astype('<f4').tofile(study/(variant+'-offsets-local.bin'))
    config=capture_scene_config(scene,mesh)
    report={'version':1,'variant':variant,'approach':'Existing native coat envelope only; local reversible sculpt, no new fibres/cards/curves',
            'source':str(SOURCE.relative_to(ROOT)),'sourceSha256':source_hash,'sourceSignature':source_signature,
            'sourceFileUntouched':hashlib.sha256(SOURCE.read_bytes()).hexdigest()==source_hash,
            'existingShapeKeysUnchanged':unchanged_keys,'shapeKeyCount':len(mesh.data.shape_keys.key_blocks),'activeCoatKey':key_name,
            'originalEarTuftVertexCount':len(ear_ids),'originalEarTuftMaxOffsetMm':float(np.linalg.norm(delta[ear_ids],axis=1).max()/unit_per_mm)if ear_ids else None,
            'protectedFaceEyeVertices':int(protected.sum()),'protectedFaceEyeMaxOffsetMm':float(np.linalg.norm(delta[protected],axis=1).max()/unit_per_mm),
            'newCurveCount':0,'newFaces':0,'newVertices':0,'metresPerSceneUnit':metres_per_unit,
            'maxWorldOffsetMm':float(np.linalg.norm(delta,axis=1).max()/unit_per_mm),'movedVertices':int((np.linalg.norm(delta,axis=1)>1e-8).sum()),
            'poseSpaceReconstructionMaxErrorMm':float(error.max()),
            'regions':{name:{'weightedVertexCount':int((mask>.001).sum()),'maxOffsetMm':float(np.linalg.norm(delta[mask>.001],axis=1).max()/unit_per_mm)}for name,mask in [('chest',chest),('breeches',breeches),('tail',tail)]},
            'worldOffsetsFile':variant+'-offsets-world.bin','localOffsetsFile':variant+'-offsets-local.bin',
            'offsetLayout':'Float32 little-endian [sourceVertexCount,3], source vertex order unchanged; local offsets are pre-armature shape-key delta',
            'render':{'camera':ARGS.view,'samples':ARGS.samples,'resolution':ARGS.resolution,'denoising':True,'dof':False},
            'sceneConfig':config,'sceneConfigSha256':hashlib.sha256(json.dumps(config,sort_keys=True).encode()).hexdigest(),
            'limitations':'Native texture strand length is unchanged. Smooth envelope silhouette can still read as skin volume; this is a true-render study, not a realism approval.'}
    (study/(variant+'-manifest.json')).write_text(json.dumps(report,indent=2))
    scene['nativeEnvelopeStudy']=json.dumps(report)
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(AUTHORED/('native-coat-envelope-'+variant+'.blend')),compress=True)
    print('NATIVE_ENVELOPE_BUILT',json.dumps({k:v for k,v in report.items()if k not in ('sceneConfig','sourceSignature')}),flush=True)
    if not ARGS.no_render:
        scene.render.filepath=str(study/(variant+'-'+ARGS.view+'.png'));bpy.ops.render.render(write_still=True)
    sparse={k:True for k in ('export_try_sparse_sk','export_try_omit_sparse_sk')if k in bpy.ops.export_scene.gltf.get_rna_type().properties}
    bpy.ops.export_scene.gltf(filepath=str(study/(variant+'.glb')),export_format='GLB',export_extras=True,
      export_animations=True,export_morph=True,export_morph_normal=True,export_morph_tangent=False,export_skins=True,
      export_yup=True,export_cameras=False,export_lights=False,export_current_frame=True,export_rest_position_armature=False,**sparse)

if ARGS.native_envelope:
    build_native_envelope()
    sys.exit(0)

if ARGS.tail_volume:
    build_tail_volume()
    sys.exit(0)

root_records = []
curve_positions = []
curve_radii = []
curve_colors = []
curve_regions = []
region_reports = []
if ARGS.variant != 'source':
    rng = np.random.default_rng(ARGS.seed)
    centers = tri_pos.mean(axis=1)
    x, y, z = centers.T
    tw = tail_weights[triangles].mean(axis=1)
    hw = head_weights[triangles].mean(axis=1)
    # Muzzle centre is z=2.229, y=-1.983. The earlier broad neck mask reached
    # the lower lip and made a beard; this patch stays below and behind it.
    chest = smooth(1.60, 1.76, z)*(1-smooth(1.97, 2.08, z)) * (1-smooth(-1.00, -.82, y))
    chest *= smooth(-1.85, -1.75, y)
    chest *= smooth(-.08, -.45, face_normals[:, 1]) * (1-smooth(.40, .56, np.abs(x)))
    cheek = smooth(.25, .35, np.abs(x))*(1-smooth(.49, .57, np.abs(x)))
    cheek *= smooth(2.20, 2.28, z)*(1-smooth(2.51, 2.61, z)) * smooth(.25, .55, hw)
    cheek *= smooth(-1.78, -1.68, y)*(1-smooth(-1.30, -1.12, y))
    tail = smooth(.5, .8, tw)*smooth(1.7, 2.1, y)*(1-smooth(2.9, 3.25, y))
    sample_albedo = albedo_sampler()
    knots = 9
    # Local studies deliberately leave the rest of the source coat untouched.
    for region_index, (region, mask, count) in enumerate([
        ('chest', chest, 12000), ('cheek', cheek, 6500), ('tail', tail, 10000),
    ]):
        mask = mask*(triangle_material == 0)*(area > 1e-10)
        cdf = np.cumsum(area*mask)
        if not cdf[-1] > 0:
            raise RuntimeError('Empty anatomical study patch: '+region)
        start = len(root_records)
        for unused in range(count):
            tri = int(np.searchsorted(cdf, rng.random()*cdf[-1]))
            q = rng.random(2)
            a = math.sqrt(q[0])
            bary = np.array([1-a, a*(1-q[1]), a*q[1]])
            root = bary @ tri_pos[tri]
            normal, uv, bary = normal_and_uv(tri, root)
            direction, confidence, fallback = comb_direction(region, root, tri, normal, uv)
            cross = np.cross(normal, direction)
            # Correlated millimetre-scale bend: neighbours share a small clump,
            # without reusing an old raised guide cage or adding random frizz.
            phase = float(np.dot(root, np.array([107.0, 71.0, 89.0])))
            shared = math.sin(phase)*math.sin(float(np.dot(root, np.array([43., -61., 37.]))))
            if ARGS.variant == 'short':
                length_mm = {'chest': 4.8, 'cheek': 2.7, 'tail': 5.8}[region]*(.70+.60*rng.random())
                loft_mm = {'chest': .55, 'cheek': .30, 'tail': .65}[region]*(.8+.4*rng.random())
            else:
                population = rng.random()
                if region == 'chest':
                    length_mm, loft_mm = (3.5, .32) if population < .48 else ((11.5, .85) if population < .90 else (25, 1.7))
                elif region == 'cheek':
                    length_mm, loft_mm = (3.0, .32) if population < .92 else (7.2, .65)
                else:
                    length_mm, loft_mm = (6.5, .45) if population < .70 else (22, 1.5)
                length_mm *= .80+.40*rng.random()
                loft_mm *= .85+.30*rng.random()
            length, loft = length_mm*unit_per_mm, loft_mm*unit_per_mm
            diameter_mm = .025+.013*rng.random()
            radius = diameter_mm*.5*unit_per_mm
            root_color = sample_albedo(uv).copy()
            root_color[3] = 1
            points = [root+normal*(.018*unit_per_mm)]
            base = root.copy()
            last_direction = direction
            current_tri = tri
            for k in range(1, knots):
                t = k/(knots-1)
                # Small lateral bundling is shared locally, always surface-bound.
                advance = last_direction*(length/(knots-1))+cross*(shared*.10*length/(knots-1)*math.sin(t*math.pi))
                hit, hit_normal, hit_tri, distance = bvh.find_nearest(Vector(base+advance), length*.40)
                if hit is None:
                    hit, hit_normal, hit_tri, distance = bvh.find_nearest(Vector(base+advance))
                base = np.array(hit)
                current_tri = hit_tri
                n, next_uv, _ = normal_and_uv(current_tri, base)
                next_direction, _, _ = comb_direction(region, base, current_tri, n, next_uv)
                if np.dot(next_direction, last_direction) < 0:
                    next_direction = -next_direction
                last_direction = last_direction*.55+next_direction*.45
                last_direction -= n*np.dot(last_direction, n)
                last_direction /= max(np.linalg.norm(last_direction), 1e-12)
                # Existing mesh = outer coat envelope; rise only 0.3-3 mm.
                rise = loft*(math.sin(math.pi*t)**.9*.82+.18*t)+.018*unit_per_mm
                points.append(base+n*rise)
            points = np.asarray(points)
            curve_positions.extend(points)
            curve_radii.extend([radius*(1-k/(knots-1))**.68+.0015*unit_per_mm for k in range(knots)])
            curve_colors.append(root_color)
            curve_regions.append(region_index)
            root_records.append({'triangle': tri, 'vertices': triangles[tri].tolist(), 'barycentric': bary.tolist(),
                                 'uv': uv.tolist(), 'region': region, 'sourceMaterial': 0,
                                 'root': root.tolist(), 'controlPoints': points.tolist(),
                                 'normal': normal.tolist(), 'rootColorLinear': root_color.tolist(),
                                 'flowConfidence': confidence, 'anatomicalFallback': fallback,
                                 'nominalLengthMm': length_mm, 'loftAssumptionMm': loft_mm,
                                 'actualArcLengthMm': float(np.linalg.norm(np.diff(points, axis=0), axis=1).sum()/unit_per_mm),
                                 'diameterMm': diameter_mm})
        region_reports.append({'region': region, 'curves': len(root_records)-start,
                               'rootPatchAreaSquareMm': float(cdf[-1]/unit_per_mm**2),
                               'anatomicalFallbackCurves': sum(r['anatomicalFallback'] for r in root_records[start:])})
        print('BUILT_REGION', region_reports[-1], flush=True)
    curves = bpy.data.hair_curves.new('Native coat '+ARGS.variant+' / editable attached curves')
    curves.add_curves([knots]*len(root_records))
    curves.set_types(type='CATMULL_ROM')
    curves.position_data.foreach_set('vector', np.asarray(curve_positions, dtype=np.float32).ravel())
    radius_attr = curves.attributes.new('radius', 'FLOAT', 'POINT')
    radius_attr.data.foreach_set('value', np.asarray(curve_radii, dtype=np.float32))
    color_attr = curves.attributes.new('root_color', 'FLOAT_COLOR', 'CURVE')
    color_attr.data.foreach_set('color', np.asarray(curve_colors, dtype=np.float32).ravel())
    region_attr = curves.attributes.new('anatomical_region', 'INT', 'CURVE')
    region_attr.data.foreach_set('value', np.asarray(curve_regions, dtype=np.int32))
    uv_attr = curves.attributes.new('surface_uv_coordinate', 'FLOAT2', 'CURVE')
    uv_attr.data.foreach_set('vector', np.asarray([r['uv'] for r in root_records], dtype=np.float32).ravel())
    triangle_attr = curves.attributes.new('source_triangle', 'INT', 'CURVE')
    triangle_attr.data.foreach_set('value', np.asarray([r['triangle'] for r in root_records], dtype=np.int32))
    curves.surface = mesh
    curves.surface_uv_map = surface.uv_layers[0].name
    hair_object = bpy.data.objects.new('Native coat study '+ARGS.variant, curves)
    scene.collection.objects.link(hair_object)
    curves.materials.append(hair_material())
    # The edit data are world-space against the saved, posed source. No deceptive
    # modifier claim: runtime skin/morph transfer must use exported root binding.
    hair_object['bindingNote'] = 'surface+UV metadata; JSON triangle/barycentric roots. Current points are authored world-space; animation transfer is not yet implemented.'
    hair_object['sourceUnchanged'] = True
    asset = {'version': 1, 'kind': 'editable-blender-hair-curves-study', 'variant': ARGS.variant,
             'source': str(SOURCE.relative_to(ROOT)), 'sourceSha256': source_hash,
             'pointSpace': 'Blender world, Z up', 'metresPerUnit': metres_per_unit,
             'sceneWorldMatrix': [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
             'sourceMeshWorldMatrix': [list(row) for row in mesh.matrix_world],
             'webFromBlenderWorld': [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]],
             'rootUV': {'space': 'Blender UV up', 'rootUVToWebUV': '[u, 1-v]', 'normalGreenInverted': False},
             'knotsPerCurve': knots, 'field': field_manifest, 'regions': region_reports,
             'anatomicalFallbacks': {'chest': 'down the chest toward belly; slight lateral fan',
                                    'cheek': 'away from eyes toward lateral cheek/back/down',
                                    'tail': 'nearest actual tail bone centreline, root to tip; slight gravity'},
             'binding': 'source evaluated loop_triangle ordinal + source vertex IDs + barycentric + Blender UVMap',
             'curves': root_records}
    (OUT/(ARGS.variant+'-asset.json')).write_text(json.dumps(asset, separators=(',', ':')))

manifest = {
    'version': 2, 'variant': ARGS.variant, 'source': str(SOURCE.relative_to(ROOT)),
    'sourceSha256': source_hash, 'sourceUntouched': hashlib.sha256(SOURCE.read_bytes()).hexdigest() == source_hash,
    'sourceSignature': source_signature,
    'coordinateSystem': 'Blender world XYZ, Z up, cat forward approximately -Y',
    'sourceSurfaceHeightUnits': height, 'metresPerSceneUnit': metres_per_unit,
    'calibrationAssumption': '300 mm standing height for display only, not measured anatomy',
    'newCurveCount': len(root_records), 'newCurvePointCount': len(curve_positions),
    'regions': region_reports, 'flowField': field_manifest,
    'shader': 'Principled Hair BSDF CHIANG / COLOR root albedo' if root_records else 'unaltered source materials',
    'render': {'camera': ARGS.view, 'engine': 'Cycles', 'device': scene.cycles.device,
               'samples': ARGS.samples, 'resolution': ARGS.resolution,
               'dof': False, 'denoising': True, 'lightsSameAcrossVariants': True},
}
scene_config = capture_scene_config(scene, mesh)
manifest['sceneConfig'] = scene_config
manifest['sceneConfigSha256'] = hashlib.sha256(json.dumps(scene_config, sort_keys=True).encode()).hexdigest()
(OUT / (ARGS.variant+'-'+ARGS.view+'-manifest.json')).write_text(json.dumps(manifest, indent=2))
scene['nativeCoatStudy'] = json.dumps(manifest)
bpy.context.preferences.filepaths.save_version = 0
blend_path = AUTHORED / ('native-coat-study-'+ARGS.variant+'.blend')
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), compress=True)
if not ARGS.no_render:
    scene.render.filepath = str(OUT / (ARGS.variant+'-'+ARGS.view+'.png'))
    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    print('STUDY_RENDER_SECONDS', time.perf_counter()-started)
print('NATIVE_COAT_STUDY', json.dumps(manifest))
