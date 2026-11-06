"""Create three native Blender cat look-development models, not image recolors.

Native authored guides/UV/weights are retained. New body shape keys and baked
stripe-free coat maps define a fuller solid cat, bicolor Ragdoll and Siamese.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts/three-cat-models"
OUT.mkdir(parents=True, exist_ok=True)
SHORT = Path('/Users/afa/Downloads/JC0L219A2_GreyTabbyCat_Walk_3.1.blend')
LONG = Path('/Users/afa/Downloads/GreyTabbyCat-long-native-r3.blend')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--models', default='solid,ragdoll,siamese')
parser.add_argument('--texture-size', type=int, default=2048, help='Resolution of each of the two UV tiles')
args = parser.parse_args(argv)
NAMES = {'solid': '圆胖纯色猫', 'ragdoll': '双色布偶猫', 'siamese': '海豹重点色暹罗猫'}


def smooth(a, b, v):
    t = np.clip((v-a)/(b-a), 0., 1.)
    return t*t*(3-2*t)


def linear(hex_value):
    c = np.array([int(hex_value[i:i+2],16)/255 for i in (0,2,4)], dtype=np.float32)
    return np.where(c <= .04045, c/12.92, ((c+.055)/1.055)**2.4)


def mix(a, b, amount):
    return a*(1-amount[...,None]) + b*amount[...,None]


def field(points, variant):
    x, y, z = points.T
    if variant == 'solid':
        color = np.broadcast_to(linear('8796a5'), (len(points),3)).copy()
    else:
        base = linear('eee4d5') if variant == 'ragdoll' else linear('e7d2b5')
        point = linear('665047') if variant == 'ragdoll' else linear('493026')
        color = np.broadcast_to(base, (len(points),3)).copy()
        face = (1-smooth(-.221,-.168,y))*smooth(.177,.207,z)
        ear = smooth(.251,.267,z)*(1-smooth(-.15,-.115,y))
        tail = smooth(.191,.222,y)
        leg = 1-smooth(.080,.125,z)
        if variant == 'ragdoll':
            # White legs, chest and inverted V; the dark ears and tail remain.
            points_mask = np.maximum.reduce([face,ear,tail])
            color = mix(color, point, points_mask)
            chest = (1-smooth(-.13,-.07,y))*(1-smooth(.205,.228,z))
            underside = (1-smooth(.135,.175,z))*(1-smooth(.18,.22,y))
            width = .024*(1-smooth(.215,.258,z))+.001
            inverted_v = (1-smooth(width-.0015,width+.0015,np.abs(x)))*(1-smooth(-.212,-.191,y))*smooth(.19,.205,z)
            white = np.maximum.reduce([leg*(1-tail),chest,underside,inverted_v])
            color = mix(color, linear('faf7f2'), white)
            # A faint warm mantle, without tabby stripes.
            back = smooth(.205,.258,z)*smooth(-.08,-.015,y)*(1-smooth(.15,.205,y))
            color = mix(color, linear('cbb8a6'), back*.30)
        else:
            points_mask = np.maximum.reduce([face,ear,tail,leg])
            color = mix(color, point, points_mask)
            belly = (1-smooth(.12,.18,z))*(1-points_mask)
            color = mix(color, linear('f4e6cf'), belly*.6)
    # Low-amplitude pigment variation is independent of the old striped images.
    variation = 1+.012*np.sin(x*188+y*137)*np.sin(y*81+z*193)
    color *= variation[:,None]
    # Skin-only pink is carried in a separate packed alpha channel.
    nose = np.exp(-(((x/.0065)**2)+((y+.242)/.0075)**2+((z-.2175)/.0040)**2)*2)
    pads = (1-smooth(.001,.006,z))*.85
    skin = np.maximum(nose,pads)
    return color, skin


def body_map(points, variant):
    p = np.asarray(points, dtype=np.float64)
    q = p.copy()
    x,y,z = p.T
    torso = np.exp(-((y-.025)/.135)**4)*smooth(.075,.13,z)*(1-smooth(.265,.30,z))
    if variant == 'solid':
        q[:,0] *= 1+.60*torso
        belly = np.exp(-((y-.025)/.13)**4)*(1-smooth(.12,.19,z))*smooth(.055,.09,z)
        q[:,2] -= .016*belly
        q[:,2] += .008*torso*smooth(.20,.26,z)
        cheek = (1-smooth(-.195,-.16,y))*smooth(.185,.203,z)*(1-smooth(.228,.236,z))*smooth(.010,.024,np.abs(x))
        forehead = (1-smooth(-.195,-.16,y))*smooth(.248,.261,z)*(1-smooth(.269,.282,z))
        q[:,0] *= 1+.27*cheek+.15*forehead
        head = (1-smooth(-.184,-.150,y))*smooth(.175,.19,z)
        q += .16*head[:,None]*(p-np.array([0.,-.205,.232]))
        # Compact legs and a lower body create a rounder, stockier silhouette.
        q[:,2] -= .012*smooth(.035,.11,z)
        q[:,2] -= .006*smooth(.268,.283,z)*(1-smooth(-.155,-.12,y))
    elif variant == 'ragdoll':
        q[:,0] *= 1+.15*torso
        cheek = (1-smooth(-.20,-.16,y))*smooth(.185,.205,z)*(1-smooth(.225,.24,z))
        q[:,0] *= 1+.10*cheek
    else:
        q[:,0] *= 1-.24*torso
        head = (1-smooth(-.20,-.15,y))*smooth(.18,.205,z)
        wedge = .10+.11*(1-smooth(.21,.255,z))
        q[:,0] *= 1-wedge*head
        # Larger, more open ears reinforce the wedge silhouette.
        ear = smooth(.25,.265,z)*(1-smooth(-.155,-.12,y))
        q[:,0] += np.sign(x)*.004*ear
        q[:,2] += .012*ear
    return q


def add_shape(body, variant):
    base = body.data.shape_keys.key_blocks[0]
    original = np.array([tuple(v.co) for v in base.data],dtype=np.float64)
    target = body_map(original,variant)
    key = body.shape_key_add(name='Miaoxing '+NAMES[variant],from_mix=False)
    key.relative_key = base
    for item, position in zip(key.data,target): item.co = position
    key.value = 1
    body.data.update()
    return {'name':key.name,'maxVertexDisplacement':float(np.max(np.linalg.norm(target-original,axis=1))),
            'maxTorsoHalfWidthBefore':float(np.max(np.abs(original[(original[:,1]>-.07)&(original[:,1]<.13)&(original[:,2]>.14),0]))),
            'maxTorsoHalfWidthAfter':float(np.max(np.abs(target[(original[:,1]>-.07)&(original[:,1]<.13)&(original[:,2]>.14),0])))}


def align_eyes(variant):
    if variant == 'ragdoll': return []
    changes=[]
    for obj in bpy.data.objects:
        if obj.type!='MESH' or not any(t in obj.name for t in ['Pupil','Sclera','Eyelid','Lacrimal']): continue
        coords=np.array([tuple(v.co) for v in obj.data.vertices])
        # These source mesh coordinates share the body's identity transform.
        center=coords.mean(axis=0)
        delta=body_map(center[None,:],variant)[0]-center
        datasets=[key.data for key in obj.data.shape_keys.key_blocks] if obj.data.shape_keys else [obj.data.vertices]
        for data in datasets:
            if variant=='solid':
                values=body_map(np.array([tuple(v.co) for v in data]),variant)
                for v,position in zip(data,values):v.co=position
            else:
                for v in data:v.co+=Vector(delta)
        changes.append({'mesh':obj.name,'translation':delta.tolist(),'uniformHeadScale':1.16 if variant=='solid' else 1})
    return changes


def align_auxiliary(variant):
    changes=[]
    for obj in bpy.data.objects:
        if not obj.name.startswith('GreyTabbyCat_') or obj.name=='GreyTabbyCat_Body':continue
        if obj.type=='MESH' and not any(t in obj.name for t in ['Pupil','Sclera','Eyelid','Lacrimal']):
            blocks=list(obj.data.shape_keys.key_blocks) if obj.data.shape_keys else []
            datasets=[key.data for key in blocks] if blocks else [obj.data.vertices]
            for data in datasets:
                coords=np.array([tuple(v.co) for v in data])
                transformed=body_map(coords,variant)
                for vertex,position in zip(data,transformed):vertex.co=position
            changes.append(obj.name)
        elif obj.type=='CURVE':
            inv=obj.matrix_world.inverted()
            for spline in obj.data.splines:
                for point in spline.bezier_points:
                    for attr in ['co','handle_left','handle_right']:
                        position=obj.matrix_world@getattr(point,attr)
                        mapped=body_map(np.array([tuple(position)]),variant)[0]
                        setattr(point,attr,inv@Vector(mapped))
                for point in spline.points:
                    position=obj.matrix_world@Vector(point.co[:3])
                    mapped=inv@Vector(body_map(np.array([tuple(position)]),variant)[0])
                    point.co=tuple(mapped)+(point.co[3],)
            changes.append(obj.name)
    return changes


def atlas(body, variant, resolution):
    width, height = resolution*2,resolution
    default,_=field(np.array([[0.,0.,.18]]),variant)
    pixels=np.zeros((height,width,4),dtype=np.float32)
    pixels[:,:,:3]=default[0]
    valid=np.zeros((height,width),dtype=bool)
    mesh=body.data
    mesh.calc_loop_triangles()
    uv=np.array([tuple(v.uv) for v in mesh.uv_layers.active.data])
    coords=np.array([tuple(v.co) for v in mesh.shape_keys.key_blocks[0].data])
    for tri in mesh.loop_triangles:
        tex=uv[list(tri.loops)]*np.array([resolution,resolution])
        low=np.maximum(np.floor(tex.min(axis=0)).astype(int),[0,0])
        high=np.minimum(np.ceil(tex.max(axis=0)).astype(int),[width-1,height-1])
        if np.any(high<low):continue
        yy,xx=np.mgrid[low[1]:high[1]+1,low[0]:high[0]+1]
        px,py=xx+.5,yy+.5
        a,b,c=tex
        den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-9:continue
        w0=((b[1]-c[1])*(px-c[0])+(c[0]-b[0])*(py-c[1]))/den
        w1=((c[1]-a[1])*(px-c[0])+(a[0]-c[0])*(py-c[1]))/den
        w2=1-w0-w1
        inside=(w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)
        if not inside.any():continue
        positions=w0[inside,None]*coords[tri.vertices[0]]+w1[inside,None]*coords[tri.vertices[1]]+w2[inside,None]*coords[tri.vertices[2]]
        color,skin=field(positions,variant)
        if body.data.materials[tri.material_index] and body.data.materials[tri.material_index].name=='GreyTabbyCat_Ear_Skin': skin[:]=1
        gy,gx=yy[inside],xx[inside]
        pixels[gy,gx,:3]=color
        pixels[gy,gx,3]=skin
        valid[gy,gx]=True
    for step in range(10):
        old=valid.copy()
        for dy,dx in [(1,0),(-1,0),(0,1),(0,-1)]:
            adjacent=np.roll(old,(dy,dx),(0,1))
            new=adjacent&~valid
            pixels[new]=np.roll(pixels,(dy,dx),(0,1))[new]
            valid[new]=True
    image=bpy.data.images.new('Miaoxing '+variant+' coat atlas',width=width,height=height,alpha=True,float_buffer=True)
    image.colorspace_settings.name='Non-Color'
    image.alpha_mode='CHANNEL_PACKED'
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    return image,{'width':width,'height':height,'coveredPixels':int(valid.sum()),'oldPigmentTexturesUsed':False}


def texture_nodes(tree,image):
    nodes,links=tree.nodes,tree.links
    uv=nodes.new('ShaderNodeTexCoord'); uv.location=(-700,0)
    scale=nodes.new('ShaderNodeVectorMath');scale.operation='MULTIPLY';scale.inputs[1].default_value=(.5,1,1);scale.location=(-500,0)
    tex=nodes.new('ShaderNodeTexImage');tex.image=image;tex.interpolation='Linear';tex.extension='EXTEND';tex.location=(-280,0)
    links.new(uv.outputs['UV'],scale.inputs[0]);links.new(scale.outputs['Vector'],tex.inputs['Vector'])
    return tex


def materials(image,variant):
    pink=linear('b18186' if variant=='solid' else 'd19494' if variant=='ragdoll' else '3b2520')
    counts={'nativeHairMaterials':0,'skinMaterials':0}
    for mat in bpy.data.materials:
        if not mat.use_nodes:continue
        tree=mat.node_tree
        if mat.name.startswith('GreyTabbyCat_Hair_') and 'Beard' not in mat.name:
            tree.nodes.clear()
            tex=texture_nodes(tree,image)
            output=tree.nodes.new('ShaderNodeOutputMaterial');output.location=(650,0)
            shader=tree.nodes.new('ShaderNodeBsdfHairPrincipled');shader.location=(400,0);shader.parametrization='COLOR'
            shader.inputs['Roughness'].default_value=.39 if variant=='siamese' else .48
            if shader.inputs.get('Radial Roughness'):shader.inputs['Radial Roughness'].default_value=.58
            info=tree.nodes.new('ShaderNodeHairInfo');info.location=(-200,-270)
            random=tree.nodes.new('ShaderNodeMapRange');random.inputs['To Min'].default_value=.94;random.inputs['To Max'].default_value=1.06;random.location=(0,-220)
            tree.links.new(info.outputs['Random'],random.inputs['Value'])
            mul=tree.nodes.new('ShaderNodeMixRGB');mul.blend_type='MULTIPLY';mul.inputs[0].default_value=1;mul.location=(170,0)
            tree.links.new(tex.outputs['Color'],mul.inputs[1]);tree.links.new(random.outputs['Result'],mul.inputs[2])
            tree.links.new(mul.outputs[0],shader.inputs['Color']);tree.links.new(shader.outputs[0],output.inputs['Surface'])
            counts['nativeHairMaterials']+=1
        elif mat.name in ['GreyTabbyCat_Body_Skin','GreyTabbyCat_Ear_Skin']:
            tex=texture_nodes(tree,image)
            shader=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled')
            blend=tree.nodes.new('ShaderNodeMixRGB');blend.blend_type='MIX';blend.inputs[2].default_value=tuple(pink)+(1,)
            tree.links.new(tex.outputs['Alpha'],blend.inputs[0]);tree.links.new(tex.outputs['Color'],blend.inputs[1]);tree.links.new(blend.outputs[0],shader.inputs['Base Color'])
            counts['skinMaterials']+=1
        elif mat.name=='GreyTabbyCat_Sclera':
            shader=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled')
            previous=shader.inputs['Base Color'].links[0].from_socket
            bw=tree.nodes.new('ShaderNodeRGBToBW');tree.links.new(previous,bw.inputs[0])
            ramp=tree.nodes.new('ShaderNodeValToRGB')
            colors=[(0,'351c0c'),(.08,'936028'),(.3,'c69742'),(1,'f0d587')] if variant=='solid' else [(0,'081526'),(.08,'174b78'),(.3,'4b9cc4'),(1,'bbdce9')]
            ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
            for i,(position,color) in enumerate(colors):
                e=ramp.color_ramp.elements[0] if i==0 else ramp.color_ramp.elements.new(position)
                e.position=position;e.color=tuple(linear(color))+(1,)
            tree.links.new(bw.outputs[0],ramp.inputs[0]);tree.links.new(ramp.outputs[0],shader.inputs['Base Color'])
    return counts


def groom(body,variant):
    results=[]
    for ps in body.particle_systems:
        if 'Beard' in ps.name:continue
        if variant=='siamese':
            factor=.42
            if 'Long' in ps.name:factor=.24
            if 'HeadBase' in ps.name:factor=.55
        elif variant=='ragdoll':factor=1.18 if any(t in ps.name for t in ['BodyLong','HeadLong','Tail']) else 1
        else:factor=.78 if 'Long' in ps.name else .90
        total_before,total_after=0,0
        for particle in ps.particles:
            keys=particle.hair_keys
            if len(keys)<2:continue
            root=keys[0].co_local.copy()
            original=[k.co_local.copy() for k in keys]
            total_before+=sum((a-b).length for a,b in zip(original[1:],original[:-1]))
            for key in keys[1:]:key.co_local=root+(key.co_local-root)*factor
            total_after+=sum((a.co_local-b.co_local).length for a,b in zip(keys[1:],keys[:-1]))
        results.append({'system':ps.name,'factor':factor,'guides':len(ps.particles),'totalLengthBefore':total_before,'totalLengthAfter':total_after})
    return results


for variant in args.models.split(','):
    if variant not in NAMES:raise RuntimeError('Unknown model '+variant)
    source=LONG if variant=='ragdoll' else SHORT
    before_hash=hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False)
    scene=bpy.context.scene;scene.frame_set(0)
    body=bpy.data.objects['GreyTabbyCat_Body']
    for mod in body.modifiers:
        if mod.type=='PARTICLE_SYSTEM':mod.show_viewport=False
    shape=add_shape(body,variant)
    eyes=align_eyes(variant)
    auxiliary=align_auxiliary(variant)
    print('BUILDING_COAT_ATLAS',variant,flush=True)
    image,atlas_report=atlas(body,variant,args.texture_size)
    material_report=materials(image,variant)
    groom_report=groom(body,variant)
    for img in bpy.data.images:
        if img.filepath:img.filepath=bpy.path.abspath(img.filepath)
    scene['miaoxing_model_variant']=variant
    scene['miaoxing_model_label']=NAMES[variant]
    scene['miaoxing_model_source']=str(source)
    path=ROOT/'assets/authored'/('cat-'+variant+'.blend')
    path.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    if hashlib.sha256(source.read_bytes()).hexdigest()!=before_hash:raise RuntimeError('Source changed')
    report={'variant':variant,'label':NAMES[variant],'source':str(source),'sourceSha256':before_hash,'output':str(path),'shape':shape,'eyeAlignment':eyes,'auxiliaryAlignment':auxiliary,'atlas':atlas_report,'materials':material_report,'groom':groom_report,'originalUnchanged':True,'scope':'Native Blender look-development model; web conversion and full animation QA pending'}
    (OUT/(variant+'-build.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('CAT_MODEL_SAVED',variant,str(path),flush=True)
