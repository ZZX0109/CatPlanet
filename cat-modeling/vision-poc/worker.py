"""Self-authored geometric fixture calibration only; never a production/model executor."""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector

parser=argparse.ArgumentParser()
parser.add_argument('--mode',choices=['init','reference','render'],required=True)
parser.add_argument('--source',required=True)
parser.add_argument('--base',required=True)
parser.add_argument('--out',required=True)
parser.add_argument('--parameter',type=float)
parser.add_argument('--base-sha256')
parser.add_argument('--candidate-id',required=True)
parser.add_argument('--round',type=int,default=0)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
source=Path(args.source).resolve();base=Path(args.base).resolve();out=Path(args.out).resolve()
if out.exists():raise ValueError('Fresh render directory required')
out.mkdir(parents=True,exist_ok=False)
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
json_hash=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest()
source_before=digest(source)

def material(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True
    nodes=m.node_tree.nodes;nodes.clear();emission=nodes.new('ShaderNodeEmission');emission.inputs['Color'].default_value=(*color,1);emission.inputs['Strength'].default_value=1
    output=nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(emission.outputs[0],output.inputs[0]);return m

def configuration():
    scene=bpy.context.scene
    return {'sceneMarker':scene.get('visionPocFixture'),'resolution':[scene.render.resolution_x,scene.render.resolution_y], 'renderer':scene.render.engine,'samples':scene.cycles.samples,'seed':scene.cycles.seed,'transparent':scene.render.film_transparent,'viewTransform':scene.view_settings.view_transform,
      'cameras':{o.name:{'matrix':[list(row) for row in o.matrix_world],'ortho':o.data.ortho_scale} for o in scene.objects if o.type=='CAMERA'},
      'lights':{o.name:{'matrix':[list(row) for row in o.matrix_world],'energy':o.data.energy} for o in scene.objects if o.type=='LIGHT'},
      'materials':{m.name:[(n.type,[list(v.default_value) if hasattr(v.default_value,'__len__') else v.default_value for v in n.inputs if hasattr(v,'default_value') and isinstance(v.default_value,(float,int)) or (hasattr(v,'default_value') and hasattr(v.default_value,'__len__'))]) for n in m.node_tree.nodes] for m in bpy.data.materials if m.use_nodes},
      'objects':{o.name:{'matrix':[list(row) for row in o.matrix_world]} for o in scene.objects if o.type=='MESH'}}

def structure():
    topology={};uvs={};finite=True;nondegenerate=True;orientation=True;deps=bpy.context.evaluated_depsgraph_get()
    for obj in sorted([o for o in bpy.context.scene.objects if o.type=='MESH'],key=lambda o:o.name):
      data=obj.data;data.calc_loop_triangles();triangles=[list(t.vertices) for t in data.loop_triangles]
      topology[obj.name]={'vertices':len(data.vertices),'triangles':triangles}
      uvs[obj.name]={'layers':len(data.uv_layers),'values':[[list(v.uv) for v in layer.data] for layer in data.uv_layers]}
      evaluated=obj.evaluated_get(deps);mesh=evaluated.to_mesh()
      try:
       for vertex in mesh.vertices:
        finite=finite and all(math.isfinite(x) for x in vertex.co)
       for triangle in triangles:
        a,b,c=[mesh.vertices[i].co for i in triangle];cross=(b-a).cross(c-a)
        oa,ob,oc=[data.vertices[i].co for i in triangle];original=(ob-oa).cross(oc-oa)
        nondegenerate=nondegenerate and cross.length>1e-10
        orientation=orientation and cross.dot(original)>0
      finally:evaluated.to_mesh_clear()
    return {'topologyHash':json_hash(topology),'uvHash':json_hash(uvs),'vertexCounts':{k:v['vertices'] for k,v in topology.items()},'triangleCounts':{k:len(v['triangles']) for k,v in topology.items()},'uvLayerCounts':{k:v['layers'] for k,v in uvs.items()},'finite':finite,'nondegenerate':nondegenerate,'orientationPreserved':orientation}

if args.mode=='init':
    if base.exists():raise ValueError('Frozen base must be created once')
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(source))
    head=bpy.data.objects.get('head')
    if not head or head.type!='MESH':raise ValueError('Authored fixture head absent')
    head.data=head.data.copy();head.shape_key_add(name='Basis')
    for name,factor in [('Shape_headWidth_low',.65),('Shape_headWidth_high',1.35)]:
      key=head.shape_key_add(name=name)
      for vertex in key.data:vertex.co.x*=factor
    root=bpy.data.objects.new('FrozenNormalization',None);bpy.context.scene.collection.objects.link(root)
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    bpy.context.view_layer.update();corners=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box];low=min(p.z for p in corners);high=max(p.z for p in corners);factor=2/(high-low)
    for obj in meshes:obj.parent=root
    root.scale=(factor,)*3;root.location.z=-low*factor
    body=material('FixtureBodyId',(.1,.2,.3));head_id=material('FixtureHeadId',(1,0,0))
    for obj in meshes:
      # Shared GLB mesh datablocks are copied before assigning per-object ID materials.
      if obj is not head:obj.data=obj.data.copy()
      obj.data.materials.clear();obj.data.materials.append(head_id if obj is head else body)
    scene=bpy.context.scene;scene['visionPocFixture']='miaoxing-geometric-calibration-v1';scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=8;scene.cycles.seed=0;scene.cycles.use_denoising=False
    scene.render.resolution_x=256;scene.render.resolution_y=256;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=True;scene.view_settings.view_transform='Standard';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    scene.world=bpy.data.worlds.new('FrozenWorld');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.25
    target=Vector((0,0,1))
    # Coordinates in saved Blender fixture are Z-up; no per-round recentering.
    for name,location in [('front',(0,-6,1)),('three',(4,-6,2.8))]:
      data=bpy.data.cameras.new(name);data.type='ORTHO';data.ortho_scale=2.7;obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=location;obj.rotation_euler=(target-obj.location).to_track_quat('-Z','Y').to_euler()
    light=bpy.data.lights.new('FrozenKey','AREA');light.energy=400;obj=bpy.data.objects.new('FrozenKey',light);scene.collection.objects.link(obj);obj.location=(3,-4,5)
    bpy.context.view_layer.update();bpy.ops.wm.save_as_mainfile(filepath=str(base),check_existing=False)
    report={'mode':'initialized-once','baseSha256':digest(base),'sourceSha256':source_before,'configurationHash':json_hash(configuration()),**structure(),'tools':{'blender':bpy.app.version_string,'renderer':'CYCLES','samples':8,'device':'CPU'},'editableShapeKeys':['Shape_headWidth_low','Shape_headWidth_high'],'limitations':['Authored cuboid cat fixture only','No rig, groom, identity model or real-photo understanding','ID emission mask pass does not test physical fur or material realism']}
    (out/'base.json').write_text(json.dumps(report,indent=2));sys.exit(0)

base_before=digest(base)
if base_before!=args.base_sha256:raise ValueError('Frozen base hash changed before load')
bpy.ops.wm.open_mainfile(filepath=str(base),load_ui=False,use_scripts=False)
if bpy.context.scene.get('visionPocFixture')!='miaoxing-geometric-calibration-v1':raise ValueError('Only the authored POC fixture may be loaded')
# Hidden teacher lives only in reference generation; the image planner never receives it.
parameter=68 if args.mode=='reference' else args.parameter
if parameter is None or not math.isfinite(parameter) or not 0<=parameter<=100:raise ValueError('Bounded parameter required')
head=bpy.data.objects['head'];head.data.shape_keys.key_blocks['Shape_headWidth_low'].value=max(0,(50-parameter)/50);head.data.shape_keys.key_blocks['Shape_headWidth_high'].value=max(0,(parameter-50)/50)
bpy.context.view_layer.update();config_hash=json_hash(configuration());images={}
for view in ['front','three']:
    scene=bpy.context.scene;scene.camera=bpy.data.objects[view];scene.render.filepath=str(out/(view+'.png'));bpy.ops.render.render(write_still=True);images[view]={'file':view+'.png','sha256':digest(out/(view+'.png'))}
report={'candidateId':args.candidate_id,'round':args.round,'baseSha256Before':base_before,'baseSha256After':digest(base),'sourceSha256Before':source_before,'sourceSha256After':digest(source),'configurationHash':config_hash,**structure(),'images':images,'tools':{'blender':bpy.app.version_string,'renderer':'CYCLES','samples':8,'device':'CPU'},'appliedParameter':None if args.mode=='reference' else parameter,'shapeKeyWeights':None if args.mode=='reference' else {name:head.data.shape_keys.key_blocks[name].value for name in ['Shape_headWidth_low','Shape_headWidth_high']}}
(out/'render.json').write_text(json.dumps(report,indent=2))
