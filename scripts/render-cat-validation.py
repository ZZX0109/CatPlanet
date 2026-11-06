"""Read-only Blender counterpart of the shared visual scenario. Run in background.
blender -b approved.blend --python scripts/render-cat-validation.py -- --design appearance.json --output artifacts/blender-review-NEW
Never saves or overwrites the source .blend. A fresh output directory is required.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--design', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
root = Path(__file__).resolve().parents[1]
scenario = json.loads((root / 'lib/cat-visual-scenario.json').read_text())
design = json.loads(Path(args.design).read_text())
out = Path(args.output).resolve()
if root / 'artifacts' not in out.parents:
    raise ValueError('Output must be a fresh directory below artifacts/')
out.mkdir(parents=True, exist_ok=False)
source = Path(bpy.data.filepath)
if not bpy.data.filepath or not source.is_file():
    raise ValueError('Load an approved source .blend before rendering')

# Blender is Z-up; common review stage is glTF Y-up. Do not modify source coordinates.
def to_blender(v):
    return Vector((v[0], -v[2], v[1]))

scene = bpy.context.scene
source_pose_frame = 1 if design.get('coatType') == 'hairless' else 53
scene.frame_set(source_pose_frame)
for obj in scene.objects:
    obj.animation_data_clear()
shape = design.get('shape', {})
weights = {'Head_round': shape.get('headRound', 0) / 100, 'Head_wedge': shape.get('headWedge', 0) / 100, 'Blink': 0}
for key, value in shape.items():
    if 'Fur' in key or key in ('headRound', 'headWedge'):
        continue
    weights['Shape_' + key + '_low'] = max(0, (50 - value) / 50)
    weights['Shape_' + key + '_high'] = max(0, (value - 50) / 50)
meshes = [obj for obj in scene.objects if obj.type == 'MESH' and not obj.hide_render]
actual_targets = set()
for obj in meshes:
    if obj.data.shape_keys:
        obj.data.shape_keys.animation_data_clear()
        for key in obj.data.shape_keys.key_blocks:
            if key.name == 'Basis':
                continue
            actual_targets.add(key.name)
            key.value = weights.get(key.name, 0)
required = set(weights) - {'Blink'}
missing = sorted(required - actual_targets)
if missing:
    (out / 'validation.json').write_text(json.dumps({'status': 'blocked', 'scenario': scenario, 'design': design, 'missingMorphs': missing}, indent=2))
    raise ValueError('Source cannot apply design controls: ' + ', '.join(missing))

for obj in list(scene.objects):
    if obj.type in ('LIGHT', 'CAMERA'):
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
corners = [obj.evaluated_get(depsgraph).matrix_world @ Vector(corner) for obj in meshes for corner in obj.evaluated_get(depsgraph).bound_box]
if not corners:
    raise ValueError('No visible source meshes')
low = Vector(tuple(min(point[i] for point in corners) for i in range(3)))
high = Vector(tuple(max(point[i] for point in corners) for i in range(3)))
factor = scenario['normalizedHeight'] / (high.z - low.z)
# Keep models untouched: move camera/lights into source coordinates.
center = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
target = center + to_blender(scenario['camera']['target']) / factor
scene.world = bpy.data.worlds.new('Miaoxing isolated review world')
scene.world.use_nodes = True
nodes = scene.world.node_tree.nodes
links = scene.world.node_tree.links
environment = nodes['Background']
environment.inputs['Color'].default_value = (1, 1, 1, 1)
environment.inputs['Strength'].default_value = scenario['ambient']
background = nodes.new('ShaderNodeBackground')
hex_color = scenario['background'].lstrip('#')
rgb = [int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4)]
background.inputs['Color'].default_value = tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb) + (1,)
background.inputs['Strength'].default_value = 1
ray = nodes.new('ShaderNodeLightPath')
mix = nodes.new('ShaderNodeMixShader')
links.new(ray.outputs['Is Camera Ray'], mix.inputs[0])
links.new(environment.outputs[0], mix.inputs[1])
links.new(background.outputs[0], mix.inputs[2])
links.new(mix.outputs[0], nodes['World Output'].inputs['Surface'])
for index, light in enumerate(scenario['lights']):
    data = bpy.data.lights.new('Review light ' + str(index), 'SUN')
    data.energy = light['intensity']
    c = light['color'].lstrip('#')
    rgb = [int(c[i:i+2], 16) / 255 for i in (0, 2, 4)]
    data.color = tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb)
    obj = bpy.data.objects.new(data.name, data)
    scene.collection.objects.link(obj)
    obj.location = center + to_blender(light['position']) / factor
    obj.rotation_euler = (target - obj.location).to_track_quat('-Z', 'Y').to_euler()
camera_data = bpy.data.cameras.new('Shared review camera')
camera_data.type = 'ORTHO'
camera_data.ortho_scale = scenario['camera']['span'] / factor
camera = bpy.data.objects.new(camera_data.name, camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.seed = 0
scene.cycles.device = 'CPU'
scene.cycles.use_denoising = False
scene.view_settings.view_transform = 'Standard'
scene.view_settings.exposure = 0
scene.render.resolution_x = scenario['width']
scene.render.resolution_y = scenario['height']
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.render.use_compositing = False
scene.render.use_sequencer = False
scene.render.use_border = False
scene.render.use_motion_blur = False
images = {}
for view, position in scenario['views'].items():
    camera.location = center + to_blender(position) / factor
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    path = out / (view + '.png')
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    images[view] = {'file': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
report = {'status': 'rendered-not-approved', 'scenario': scenario, 'design': design, 'sourcePoseFrame': source_pose_frame, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
          'fixtureOnly': any(bool(obj.get('fixtureOnly')) for obj in scene.objects),
          'tools': {'blender': bpy.app.version_string, 'renderer': scene.render.engine, 'samples': scene.cycles.samples, 'seed': scene.cycles.seed, 'denoising': False},
          'images': images, 'morphs': sorted(actual_targets), 'nativeHairPortable': False,
          'hairObjects': [obj.name for obj in scene.objects if obj.type in ('CURVES', 'CURVE')],
          'materials': [{'name': mat.name, 'nodes': [node.type for node in mat.node_tree.nodes] if mat.use_nodes else []} for mat in bpy.data.materials],
          'bones': [{'object': obj.name, 'bones': [{'name': bone.name, 'matrix': [list(row) for row in bone.matrix]} for bone in obj.pose.bones]} for obj in scene.objects if obj.type == 'ARMATURE'],
          'limitations': ['Native groom is not regenerated from web groom controls.', 'Source rig pose must be checked manually against stand; source frame 53 Norwegian / 1 Sphynx follows the builders, not semantic verification.',
                          'Cycles native hair BSDF, sun energy, environment and color output differ from Three; these are nominal shared conditions, not numerical equivalence.']}
(out / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
