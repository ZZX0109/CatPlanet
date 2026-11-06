"""Independent reopen checks for the three native look-development models."""
import hashlib
import json
from pathlib import Path

import bpy
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/three-cat-models'

def digest(value):
    return hashlib.sha256(json.dumps(value,separators=(',',':'),sort_keys=True).encode()).hexdigest()


def intrinsic():
    body=bpy.data.objects['GreyTabbyCat_Body']
    mesh=body.data
    return {
        'vertices':len(mesh.vertices),
        'faces':digest([tuple(p.vertices) for p in mesh.polygons]),
        'basis':digest([tuple(v.co) for v in mesh.shape_keys.key_blocks[0].data]),
        'uv':digest([[tuple(v.uv) for v in layer.data] for layer in mesh.uv_layers]),
        'weights':digest([[(g.group,g.weight) for g in v.groups] for v in mesh.vertices]),
        'bones':digest([(o.name,[(b.name,b.parent.name if b.parent else None,[tuple(row) for row in b.matrix_local]) for b in o.data.bones]) for o in bpy.data.objects if o.type=='ARMATURE']),
        'actions':digest([(a.name,[(f.data_path,f.array_index,[(tuple(k.co),tuple(k.handle_left),tuple(k.handle_right)) for k in f.keyframe_points]) for f in a.fcurves]) for a in bpy.data.actions]),
        'hairRoots':{ps.name:digest([tuple(p.hair_keys[0].co_local) if len(p.hair_keys) else None for p in ps.particles]) for ps in body.particle_systems},
        'hairCounts':{ps.name:len(ps.particles) for ps in body.particle_systems},
    }

results={}
for variant in ['solid','ragdoll','siamese']:
    build=json.loads((OUT/(variant+'-build.json')).read_text())
    bpy.ops.wm.open_mainfile(filepath=build['source'],use_scripts=False)
    baseline=intrinsic()
    bpy.ops.wm.open_mainfile(filepath=build['output'],use_scripts=False)
    actual=intrinsic()
    checks={key:actual[key]==baseline[key] for key in baseline}
    checks['originalFileUnchanged']=hashlib.sha256(Path(build['source']).read_bytes()).hexdigest()==build['sourceSha256']
    body=bpy.data.objects['GreyTabbyCat_Body']
    shape=body.data.shape_keys.key_blocks.get(build['shape']['name'])
    checks['bodyShapeEnabled']=shape is not None and shape.value==1
    positions=np.array([tuple(v.co) for v in shape.data])
    checks['finiteShape']=bool(np.isfinite(positions).all())
    uv_image=bpy.data.images.get('Miaoxing '+variant+' coat atlas')
    checks['newCoatAtlasPresent']=uv_image is not None and uv_image.size[0]>=3072
    hair_materials=[m for m in body.data.materials if m and m.name.startswith('GreyTabbyCat_Hair_') and 'Beard' not in m.name]
    checks['noOldHairPigmentInputs']=all(
        all(n.image==uv_image for n in mat.node_tree.nodes if n.bl_idname=='ShaderNodeTexImage')
        for mat in hair_materials)
    checks['threeNativeModel']=bpy.context.scene.get('miaoxing_model_variant')==variant
    if variant=='solid':
        pixels=np.array(uv_image.pixels[:],dtype=np.float32).reshape(-1,4)[:,:3]
        ratios=pixels.max(axis=0)/np.maximum(pixels.min(axis=0),1e-8)
        checks['solidPigmentWithoutStripes']=bool((ratios<1.03).all())
        checks['fullerTorso']=build['shape']['maxTorsoHalfWidthAfter']>build['shape']['maxTorsoHalfWidthBefore']*1.4
    if variant=='siamese':
        checks['slimmerTorso']=build['shape']['maxTorsoHalfWidthAfter']<build['shape']['maxTorsoHalfWidthBefore']*.85
    results[variant]={'checks':checks,'allPassed':all(checks.values()),'vertices':actual['vertices'],'hairSystems':len(actual['hairCounts']),'source':build['source'],'output':build['output'],'fullAnimationValidationPending':True}
    print('THREE_CAT_VERIFIED',variant,results[variant]['allPassed'],checks,flush=True)
report={'models':results,'allPassed':all(r['allPassed'] for r in results.values()),'scope':'Native model integrity, morphology and new pattern-free pigment wiring; visual renders checked separately'}
(OUT/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
if not report['allPassed']:raise RuntimeError('Three-cat verification failed')
