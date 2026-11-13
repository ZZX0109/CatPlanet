"""Independent Maine Coon anatomy and native groom derivative, based on 50 reviewed photos."""
import json
import math
import os
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'model';OUT.mkdir(exist_ok=True)
ROUND=os.environ.get('MAINE_BUILD','v2')
body=bpy.data.objects['GreyTabbyCat_Body']
rig=next(obj for obj in bpy.data.objects if obj.type=='ARMATURE')
scene=bpy.context.scene
scene.frame_set(0)
rig.data.pose_position='REST'
for obj in bpy.data.objects:
    if obj.type=='MESH' and obj.data.shape_keys:
        keys=obj.data.shape_keys
        if keys.animation_data:
            for driver in keys.animation_data.drivers:driver.mute=True
        for key in keys.key_blocks:key.value=0

def smooth(a,b,x):
    t=max(0.,min(1.,(x-a)/(b-a)))
    return t*t*(3-2*t)

def band(x,a,b,fade):return smooth(a-fade,a,x)*(1-smooth(b,b+fade,x))

def warp(point):
    """Continuous canonical-space sculpt, applied consistently to meshes, keys and rig."""
    x,y,z=point
    side=1 if x>=0 else -1
    head=smooth(.175,.215,z)*(1-smooth(-.165,-.140,y))
    muzzle=band(y,-.252,-.225,.012)*band(z,.199,.229,.006)
    chin=band(y,-.247,-.216,.010)*band(z,.197,.211,.006)
    high_cheek=band(abs(x),.020,.043,.009)*band(y,-.222,-.180,.010)*band(z,.235,.257,.008)
    # Broad, blunt whisker pads and a deeper chin; keep the eye/cornea zone smooth.
    x*=1+.24*muzzle+.24*chin
    y-=.0038*muzzle+.0065*chin
    z-=.0038*chin
    x+=side*.0015*high_cheek
    # Taller, more upright ears with a broad base, without a lynx-sized exaggeration.
    ear=band(y,-.220,-.163,.012)*smooth(.014,.024,abs(x))*smooth(.250,.261,z)
    tip=max(0.,min(1.,(z-.253)/.041))
    x-=side*.0035*ear*tip
    y+=.0030*ear*tip
    z+=.0060*ear*tip
    # Long rectangular body and substantial paws; these are artistic proportions,
    # not measurements inferred from photographs.
    chest=band(y,-.15,-.055,.025)*band(z,.12,.24,.035)
    leg=(1-smooth(.11,.16,point.z))*smooth(.010,.021,abs(point.x))*max(band(point.y,-.14,-.065,.018),band(point.y,.05,.18,.018))
    limb_centre_x=side*.026
    x=limb_centre_x+(x-limb_centre_x)*(1+.25*leg)
    limb_centre_y=(-.11+.10*point.z) if point.y<0 else (.125-.20*point.z)
    y=limb_centre_y+(y-limb_centre_y)*(1+.16*leg)
    x*=1.13+.065*chest
    y*=1.13
    z*=1.09
    # Increase distal foot volume around each limb centre, rather than widening stance.
    paw=(1-smooth(.025,.052,point.z))*smooth(.008,.020,abs(point.x))
    centre=side*.027*1.13
    x=centre+(x-centre)*(1+.18*paw)
    y=limb_centre_y*1.13+(y-limb_centre_y*1.13)*(1+.12*paw)
    z+=.0015*paw*smooth(0,.018,point.z)
    # Tail core length, tapered by its original radius and groom later on.
    tail=smooth(.165,.350,point.y)*smooth(.145,.180,point.z)
    y+=.026*tail
    z-=.130*tail**1.20
    x-=.020*math.sin(math.pi*tail)
    return Vector((x,y,z))

def direction_after_warp(root,direction):
    return (warp(root+direction*.001)-warp(root)).normalized()

mods=[mod for mod in body.modifiers if mod.type=='PARTICLE_SYSTEM']
edited_suffixes=('HeadLong','Head01','Head0_F','Jaw','Body01','Body02','BodyLong','TailBase','Tail','Ear_Long')
for mod in mods:mod.show_viewport=False
canonical={}
for mod in mods:
    ps=mod.particle_system
    if not ps.name.endswith(edited_suffixes):continue
    mod.show_viewport=True;body.update_tag();bpy.context.view_layer.update()
    ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    eps=next(system for system in ev.particle_systems if system.name==ps.name)
    canonical[ps.name]=[particle.hair_keys[0].co.copy() for particle in eps.particles]
    mod.show_viewport=False;body.update_tag()
    print('MAINE_CAPTURE_ROOTS',ps.name,len(canonical[ps.name]),flush=True)

geometry=[]
processed=set()
for obj in bpy.data.objects:
    if obj.type!='MESH' or not obj.name.startswith('GreyTabbyCat_') or obj.data.as_pointer() in processed:continue
    mesh=obj.data;processed.add(mesh.as_pointer())
    before=[vertex.co.copy() for vertex in mesh.vertices]
    if mesh.shape_keys:
        for key in mesh.shape_keys.key_blocks:
            for point in key.data:point.co=warp(point.co)
        for vertex,point in zip(mesh.vertices,mesh.shape_keys.key_blocks[0].data):vertex.co=point.co
    else:
        for vertex in mesh.vertices:vertex.co=warp(vertex.co)
    mesh.update()
    geometry.append({'object':obj.name,'vertices':len(before),'mean_vertex_displacement':sum((vertex.co-old).length for vertex,old in zip(mesh.vertices,before))/len(before)})

# Update the same rest-space anatomy in the armature. The source walk is kept as
# archival data, but this independent mother model opens in a neutral standing rest pose.
rig.hide_set(False);rig.hide_viewport=False;rig.hide_select=False
for collection in rig.users_collection:collection.hide_select=False
bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bone_positions={bone.name:(bone.head.copy(),bone.tail.copy()) for bone in rig.data.edit_bones}
for bone in rig.data.edit_bones:
    head,tail=bone_positions[bone.name];bone.head=warp(head);bone.tail=warp(tail)
bpy.ops.object.mode_set(mode='OBJECT')
body.update_tag();bpy.context.view_layer.update()
print('MAINE_ANATOMY_SCULPTED',len(geometry),'meshes',len(bone_positions),'bones',flush=True)

def profile(name,root):
    x,y,z=root;side=1 if x>=0 else -1
    cheek=smooth(.019,.036,abs(x))*band(y,-.245,-.165,.014)*band(z,.195,.229,.008)
    chest=band(y,-.177,-.065,.024)*band(z,.115,.235,.02)
    flank=smooth(.024,.039,abs(x))*band(y,-.065,.18,.02)*band(z,.105,.225,.025)
    belly=band(y,-.035,.17,.025)*band(z,.075,.145,.018)
    britch=band(y,.080,.18,.025)*band(z,.045,.19,.022)*smooth(.015,.030,abs(x))
    shoulder=band(y,-.145,-.045,.025)*smooth(.20,.245,z)
    outer=max(chest,flank,belly,britch)
    if name.endswith('HeadLong'):
        return 1+2.6*cheek,.009+.023*cheek,Vector((side*.80,.20,-.56)),.42*cheek
    if name.endswith('Head01'):
        return 1+.60*cheek,.008+.008*cheek,Vector((side*.88,.2,-.36)),.18*cheek
    if name.endswith('Head0_F'):return 1.,.009,None,0.
    if name.endswith('Jaw'):return 1.45,.009,Vector((side*.35,.05,-.94)),.15
    if name.endswith('Ear_Long'):return 1.35,.020,None,0.
    if name.endswith('TailBase'):
        if y<.15 or z<.15:return 1.,.012,None,0.
        return 1.15,.025,None,0.
    if name.endswith('Tail'):
        if y<.15 or z<.15:return 1.,.012,None,0.
        u=max(0.,min(1.,(y-.155)/.205))
        cap=.022+.022*math.sin(math.pi*u)**.8
        return 2.8,cap,None,0.
    if z<.065:return 1.20,.009,None,0.
    is_outer=name.endswith('BodyLong')
    if shoulder>.35:return 1.10,(.020 if is_outer else .014),Vector((side*.12,.92,-.38)),.20
    if chest>.25:
        gradient=1-smooth(.14,.235,z)
        cap=(.023+.021*gradient) if is_outer else (.016+.009*gradient)
        return 1+(2.6 if is_outer else .9)*chest,cap,Vector((side*.32,.04,-.95)),(.58 if is_outer else .18)
    if britch>.3:return (3.6 if is_outer else 1.85),(.053 if is_outer else .029),Vector((side*.26,.40,-.88)),(.55 if is_outer else .18)
    if belly>.25:return (3.7 if is_outer else 1.9),(.055 if is_outer else .029),Vector((side*.18,.32,-.93)),(.55 if is_outer else .18)
    if flank>.25:return (3.2 if is_outer else 1.85),(.047 if is_outer else .027),Vector((side*.32,.70,-.64)),(.52 if is_outer else .18)
    back=band(y,-.045,.175,.025)*smooth(.205,.245,z)
    return 1+(1.4 if is_outer else .45)*back,(.030 if is_outer else .021),Vector((side*.12,.95,-.28)),(.48 if is_outer else .15)*back

groom=[]
for mod in mods:
    ps=mod.particle_system
    if ps.name not in canonical:continue
    mod.show_viewport=True;body.update_tag();bpy.context.view_layer.update()
    ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    eps=next(system for system in ev.particle_systems if system.name==ps.name)
    emod=next(m for m in ev.modifiers if m.type=='PARTICLE_SYSTEM' and m.particle_system.name==ps.name)
    lengths=[];scales=[];fixed_roots=[]
    for p,ep,root_old in zip(ps.particles,eps.particles,canonical[ps.name]):
        keys=p.hair_keys
        if len(keys)<2:continue
        original=[key.co.copy() for key in ep.hair_keys];root=original[0]
        scale,cap,direction,weight=profile(ps.name,root_old)
        delta=original[-1]-root;length=delta.length
        scale=min(scale,cap/max(length,1e-8))
        if scale<1.05:weight=0
        desired=delta*scale
        if direction is not None and length>1e-8:
            direction=direction_after_warp(root_old,direction.normalized())
            desired=desired.lerp(direction*length*scale,weight)
            if desired.length>1e-8:desired=desired.normalized()*length*scale
        correction=desired-delta*scale
        for index in range(1,len(keys)):
            t=index/(len(keys)-1)
            point=root+(original[index]-root)*scale+correction*smooth(.15,1,t)
            ep.hair_keys[index].co_object_set(ev,emod,ep,point)
            keys[index].co_local=ep.hair_keys[index].co_local.copy()
        lengths.append(desired.length);scales.append(scale)
    if ps.name.endswith('HeadLong'):ps.settings.rendered_child_count=6
    if ps.name.endswith('BodyLong'):ps.settings.rendered_child_count=8
    groom.append({'system':ps.name,'guides':len(lengths),'max_length':max(lengths,default=0),'mean_length':sum(lengths)/max(1,len(lengths)),'mean_scale':sum(scales)/max(1,len(scales))})
    mod.show_viewport=False;body.update_tag()
    print('MAINE_GROOMED',groom[-1],flush=True)

def ear_tufts():
    import random
    randomizer=random.Random(5048)
    mat=bpy.data.materials.new('Maine lynx-tip keratin');mat.use_nodes=True
    nodes=mat.node_tree.nodes;nodes.clear()
    output=nodes.new('ShaderNodeOutputMaterial');hair=nodes.new('ShaderNodeBsdfHairPrincipled')
    hair.parametrization='COLOR';hair.inputs['Color'].default_value=(.055,.045,.034,1)
    hair.inputs['Roughness'].default_value=.42
    mat.node_tree.links.new(hair.outputs[0],output.inputs['Surface'])
    for side,suffix in [(1,'L'),(-1,'R')]:
        tip=warp(Vector((side*.041,-.209,.291)))
        base=warp(Vector((side*.032,-.195,.277)))
        axis=(tip-base).normalized()
        positions=[];radii=[]
        count=74
        for _ in range(count):
            root=tip+Vector((randomizer.uniform(-.0018,.0018),randomizer.uniform(-.0018,.0018),randomizer.uniform(-.002,.0008)))
            length=randomizer.uniform(.008,.017)
            lean=Vector((side*.18,randomizer.uniform(-.12,.12),.2))
            for t in (0.,.33,.68,1.):
                positions.extend(root+axis*length*t+lean*length*t*t)
                radii.append(.000040*(1-t*.94))
        curves=bpy.data.hair_curves.new('Maine ear-tip '+suffix);curves.add_curves([4]*count)
        curves.points.foreach_set('position',positions)
        attr=curves.attributes.new('radius','FLOAT','POINT');attr.data.foreach_set('value',radii)
        curves.materials.append(mat)
        obj=bpy.data.objects.new('Maine Lynx Tip '+suffix,curves);scene.collection.objects.link(obj)
        matrix=obj.matrix_world.copy();obj.parent=rig;obj.parent_type='BONE';obj.parent_bone='DEF_ear_c.'+suffix
        bpy.context.view_layer.update();obj.matrix_world=matrix;bpy.context.view_layer.update()

ear_tufts()
for mod in mods:
    ps=mod.particle_system
    mod.show_render=True
    ps.settings.child_percent=1
    ps.settings.display_percentage=15
    mod.show_viewport=ps.name.endswith(('HeadBase','HeadLong','BodyBase','BodyLong','Tail','Ear_Long'))
for action in bpy.data.actions:action.name='Source walk (Maine anatomy not yet retargeted)'
for obj in bpy.data.objects:
    if obj.name.startswith('GreyTabbyCat_'):obj.name=obj.name.replace('GreyTabbyCat_','MaineCoon_',1)
rig.data.pose_position='REST'
scene['MaineCoonReferenceCount']=50
scene['MaineCoonReferenceManifest']='../references/selected-50.json'
scene['MaineCoonStatus']='Independent neutral standing anatomy and groom study; inherited animation is not validated.'
report={'reference_count':50,'geometry':geometry,'groom':groom,'base_vertices':len(body.data.vertices),'bone_count':len(rig.data.bones),'new_ear_tip_strands':148,'default_pose':'neutral standing rest','model_path':str(OUT/f'maine-coon-{ROUND}.blend')}
(OUT/f'maine-coon-{ROUND}-report.json').write_text(json.dumps(report,indent=2))
for image in bpy.data.images:
    if image.filepath:
        try:image.pack()
        except Exception:pass
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/f'maine-coon-{ROUND}.blend'))
print('MAINE_MODEL_SAVED',report['model_path'],flush=True)
