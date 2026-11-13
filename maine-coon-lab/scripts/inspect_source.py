import json
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
body=bpy.data.objects['GreyTabbyCat_Body']
report={'objects':[],'vertex_groups':list(body.vertex_groups.keys()),'bones':[]}
for obj in bpy.data.objects:
    if obj.name.startswith('GreyTabbyCat_') and obj.type=='MESH':
        coords=[v.co for v in obj.data.vertices]
        report['objects'].append({'name':obj.name,'vertices':len(coords),'bounds':[[min(v[i] for v in coords),max(v[i] for v in coords)] for i in range(3)],'center':list(sum(coords,Vector())/len(coords)),'keys':list(obj.data.shape_keys.key_blocks.keys()) if obj.data.shape_keys else []})
for obj in bpy.data.objects:
    if obj.type=='ARMATURE':
        report['bones']=[{'name':b.name,'head':list(b.head_local),'tail':list(b.tail_local),'deform':b.use_deform} for b in obj.data.bones if any(t in b.name.lower() for t in ['head','chin','lip','ear','eye','nose','face'])]
(ROOT/'source/structure.json').write_text(json.dumps(report,indent=2))
print('SOURCE_STRUCTURE_WRITTEN',flush=True)
