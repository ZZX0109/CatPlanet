"""Check native face endpoints, combinations and optical invariance in Blender.
Run with the correct Blender for the authored file and -- norwegian|sphynx.
This does not substitute for browser eye-occlusion or visual art review.
"""
import bpy, json, sys
import numpy as np
from pathlib import Path
name=sys.argv[-1]
root=Path.cwd();bpy.ops.wm.open_mainfile(filepath=str(root/('assets/authored/'+name+'-creator.blend')),use_scripts=False)
mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH' and o.find_armature())
blocks=mesh.data.shape_keys.key_blocks
base=np.array([tuple(v.co)for v in blocks['Basis'].data])
deltas={key.name:np.array([tuple(v.co)for v in key.data])-base for key in blocks if key.name!='Basis'}
eyes={i for poly in mesh.data.polygons if mesh.data.materials[poly.material_index].get('creatorRole')=='eye-globe' for i in poly.vertices}
eyes=np.array(sorted(eyes),dtype=int)
face_targets=[name for name in deltas if not name.startswith('Blink')]
triangles=[]
for poly in mesh.data.polygons:
 for i in range(1,len(poly.vertices)-1):triangles.append((poly.vertices[0],poly.vertices[i],poly.vertices[i+1]))
triangles=np.array(triangles,dtype=int)
def normals(points):
 a,b,c=points[triangles[:,0]],points[triangles[:,1]],points[triangles[:,2]]
 return np.cross(b-a,c-a)
reference=normals(base);areas=np.linalg.norm(reference,axis=1);reliable=areas>1e-11
cases=[('neutral',{})]+[(name,{name:1.0})for name in face_targets]
cases += [('combined-high',{name:1 for name in face_targets if name.endswith('_high')}),('combined-low',{name:1 for name in face_targets if name.endswith('_low')}),('round-high',{'Head_round':1,**{name:1 for name in face_targets if name.endswith('_high')}}),('wedge-low',{'Head_wedge':1,**{name:1 for name in face_targets if name.endswith('_low')}})]
results=[]
for label,weights in cases:
 opened=base.copy()
 for key,value in weights.items():opened+=deltas[key]*value
 closed=opened+deltas['Blink']
 for key,value in weights.items():closed+=deltas.get('Blink_'+key,np.zeros_like(base))*value
 n=normals(opened)
 inverted=(np.einsum('ij,ij->i',n,reference)<0)&reliable
 finite=bool(np.isfinite(opened).all()and np.isfinite(closed).all())
 eye_motion=float(np.linalg.norm((closed-opened)[eyes],axis=1).max())
 if not finite or eye_motion>1e-6:raise RuntimeError('Invalid face state '+label)
 results.append({'case':label,'finite':finite,'blinkGlobeDisplacement':eye_motion,'openInvertedTriangles':int(inverted.sum())})
report={'base':name,'sourceBindVertices':len(base),'nativeTargets':len(deltas),'nativeBlendReopened':True,'allDefaultWeightsZero':all(abs(k.value)<1e-8 for k in blocks),'opticalVertices':len(eyes),'cases':results,'scope':'Native geometry finite endpoints/mixtures and unchanged optical vertices under Blink; browser rays separately test actual occlusion.'}
out=root/'artifacts/table-refinement/verification';out.mkdir(parents=True,exist_ok=True)
(out/(name+'-native-audit.json')).write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items()if k!='cases'}))
print('MAX_INVERTED',max(case['openInvertedTriangles']for case in results))
