"""Build a second, photo-referenced set of the three native cat studies.

Starts from the untouched native assets, preserves the layered hair closures,
and adds breed anatomy independently from stripe-free pigment maps. V1 files
remain available for side-by-side review. These are native look-dev studies;
the changed anatomy still needs animation retargeting before production use.
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
OUT = ROOT / "artifacts/cat-reference-study/build"
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


def field(points, variant, features=None):
    x, y, z = points.T
    if variant == 'solid':
        color = np.broadcast_to(linear('657080'), (len(points),3)).copy()
    else:
        base = linear('e8dfd2') if variant == 'ragdoll' else linear('d8c5a7')
        point = linear('65534b') if variant == 'ragdoll' else linear('30201c')
        color = np.broadcast_to(base, (len(points),3)).copy()
        face = (1-smooth(-.221,-.155,y))*smooth(.175,.215,z)
        if variant == 'siamese':
            # Along the head surface the mask recedes behind the brow, rather
            # than creating a horizontal light stripe between dark ears/face.
            face=(1-smooth(-.204,-.156,y))*smooth(.175,.213,z)
        ear = smooth(.251,.267,z)*(1-smooth(-.15,-.115,y))
        tail = smooth(.168,.202,y)
        if features is not None:tail=smooth(.025,.28,features[:,0])
        # The photos show progressive point shading, without a level boot line.
        front = 1-smooth(-.015,.045,y)
        leg = 1-smooth(.045,.155-front*.025,z)
        if features is not None:
            leg=np.maximum(leg*.65,smooth(.08,.95,features[:,1]))
        if variant == 'ragdoll':
            # White legs, chest and inverted V; the dark ears and tail remain.
            points_mask = np.maximum.reduce([face,ear,tail])
            color = mix(color, point, points_mask)
            chest = (1-smooth(-.13,-.07,y))*(1-smooth(.205,.228,z))
            underside = (1-smooth(.135,.175,z))*(1-smooth(.18,.22,y))
            width = .039*(1-smooth(.200,.253,z))**1.3+.0004
            inverted_v = (1-smooth(width-.001,width+.001,np.abs(x)))*(1-smooth(-.169,-.145,y))*smooth(.188,.204,z)*(1-smooth(.253,.260,z))
            white = np.maximum.reduce([leg*(1-tail),chest,underside,inverted_v])
            color = mix(color, linear('f2eee7'), white)
            # A faint warm mantle, without tabby stripes.
            back = smooth(.135,.218,z)*smooth(-.105,-.025,y)*(1-smooth(.155,.205,y))
            color = mix(color, linear('b9a89b'), back*.65)
        else:
            points_mask = np.maximum.reduce([face,ear,tail,leg])
            color = mix(color, point, points_mask)
            # Darker muzzle/eye area, warmer and softer at mask periphery.
            muzzle = np.exp(-((y+.239)/.029)**2-((z-.221)/.025)**2)
            color = mix(color, linear('211918'), muzzle*.62)
            belly = (1-smooth(.12,.18,z))*(1-points_mask)
            color = mix(color, linear('f4e6cf'), belly*.6)
    # Low-amplitude pigment variation is independent of the old striped images.
    variation = 1+.018*np.sin(x*188+y*137)*np.sin(y*81+z*193)
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
    head = (1-smooth(-.165,-.12,y))*smooth(.145,.185,z)
    cheek = np.exp(-((y+.210)/.037)**4-((z-.208)/.027)**4)*smooth(.005,.020,np.abs(x))
    ear = smooth(.258,.286,z)*(1-smooth(-.155,-.12,y))
    # Shorter limbs are full volumes around each leg axis, not widened spacing.
    limb = (1-smooth(.095,.148,z))*(1-smooth(.18,.205,y))
    leg_y = np.where(y<.025,-.100,.135)
    leg_x = np.sign(x)*.025
    if variant == 'solid':
        torso=np.exp(-((y-.015)/.122)**2)*smooth(.075,.13,z)*(1-smooth(.265,.30,z))
        q[:,0] *= 1+.32*torso
        belly = np.exp(-((y-.025)/.13)**4)*(1-smooth(.12,.19,z))*smooth(.055,.09,z)
        q[:,2] -= .012*belly
        q[:,0] += np.sign(x)*.003*torso*np.exp(-((y+.065)/.055)**2)
        q[:,0] += .52*x*head + np.sign(x)*.010*cheek
        q[:,1] -= .08*(y+.190)*head
        q[:,1] -= .008*head
        q[:,2] += (.34*(z-.225)+.006+.010*(1-smooth(.212,.232,z)))*head
        q[:,2] -= .019*ear
        q[:,0] += .22*(x-leg_x)*limb
        q[:,1] += .20*(y-leg_y)*limb
        paw=1-smooth(.020,.045,z)
        q[:,0] += .12*(x-leg_x)*paw
        q[:,1] += .10*(y-leg_y)*paw
        q[:,2] -= .018*smooth(.025,.115,z)
        # Compact the entire body consistently, including muzzle and toes.
        q[:,1] = .02+(q[:,1]-.02)*.91
    elif variant == 'ragdoll':
        q[:,0] *= 1+.12*torso
        q[:,0] += .23*x*head+np.sign(x)*.0045*cheek
        q[:,2] += .10*(z-.225)*head
        q[:,1] -= .025*(y+.19)*head
        q[:,2] -= .009*ear
        q[:,0] += .08*(x-leg_x)*limb
        q[:,1] += .05*(y-leg_y)*limb
        q[:,1]=.02+(q[:,1]-.02)*1.06
    else:
        q[:,0] *= 1-.19*torso
        wedge = .05+.14*(1-smooth(.205,.256,z))
        q[:,0] *= 1-wedge*head
        q[:,1] += .065*(y+.190)*head
        # Broad ear bases continue the wedge laterally; tips do not just rise.
        ear_base=smooth(.244,.265,z)*(1-smooth(-.155,-.12,y))
        q[:,0] += np.sign(x)*(.007*ear_base+.003*ear)
        q[:,2] += .004*ear
        q[:,0] -= .17*(x-leg_x)*limb
        q[:,1] -= .14*(y-leg_y)*limb
        upper=np.exp(-((y-leg_y)/.045)**2)*smooth(.11,.15,z)*(1-smooth(.20,.23,z))
        q[:,0] -= .13*(x-leg_x)*upper
        neck=np.exp(-((y+.128)/.040)**4)*smooth(.17,.21,z)
        q[:,0] *= 1-.16*neck
        q[:,1] -= .006*head
        q[:,2] += .005*head
        q[:,1]=.02+(q[:,1]-.02)*1.06
        tail_band=smooth(.178,.214,y)
        tail_center=.20973+(y-.125)*.00712
        q[:,0] *= 1-.22*tail_band
        q[:,2] = tail_center+(q[:,2]-tail_center)*(1-.18*tail_band)
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
    changes=[]
    for obj in bpy.data.objects:
        if obj.type!='MESH' or not any(t in obj.name for t in ['Pupil','Sclera','Eyelid','Lacrimal']): continue
        coords=np.array([tuple(v.co) for v in obj.data.vertices])
        # These source mesh coordinates share the body's identity transform.
        center=coords.mean(axis=0)
        delta=body_map(center[None,:],variant)[0]-center
        datasets=[key.data for key in obj.data.shape_keys.key_blocks] if obj.data.shape_keys else [obj.data.vertices]
        for data in datasets:
            values=body_map(np.array([tuple(v.co) for v in data]),variant)
            for v,position in zip(data,values):v.co=position
        changes.append({'mesh':obj.name,'translation':delta.tolist(),'sameDeformationAsOrbitalRim':True})
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
    group_names={g.index:g.name for g in body.vertex_groups}
    features=np.zeros((len(mesh.vertices),2),dtype=np.float32)
    for vertex in mesh.vertices:
        for group in vertex.groups:
            name=group_names[group.group]
            if name.startswith('DEF_tail_') or name=='DEF_ta':features[vertex.index,0]+=group.weight
            if name.startswith(('DEF_toe','DEF_palm','DEF_shin')):
                features[vertex.index,1]+=group.weight
            elif name.startswith('DEF_arm.001'):features[vertex.index,1]+=group.weight*.6
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
        attributes=w0[inside,None]*features[tri.vertices[0]]+w1[inside,None]*features[tri.vertices[1]]+w2[inside,None]*features[tri.vertices[2]]
        color,skin=field(positions,variant,attributes)
        if body.data.materials[tri.material_index] and body.data.materials[tri.material_index].name=='GreyTabbyCat_Ear_Skin': skin[:]=.38 if variant=='ragdoll' else .55 if variant=='solid' else 1
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
    pink=linear('716572' if variant=='solid' else 'bd878b' if variant=='ragdoll' else '332420')
    counts={'nativeHairMaterials':0,'skinMaterials':0,'nativeHairClosuresPreserved':0}
    for mat in bpy.data.materials:
        if not mat.use_nodes:continue
        tree=mat.node_tree
        if mat.name.startswith('GreyTabbyCat_Hair_') and 'Beard' not in mat.name:
            tex=texture_nodes(tree,image)
            neutral=tree.nodes.new('ShaderNodeRGB')
            neutral.label='Neutralize former tabby pigment mask'
            neutral.outputs[0].default_value=(.5,.5,.5,1)
            # Feed pigment into the original graph before its authored tonal,
            # root/tip, random and optical processing. The white sheen closures
            # keep their original values instead of receiving body color.
            for node in list(tree.nodes):
                if node.bl_idname!='ShaderNodeTexImage' or node==tex or not node.image:continue
                name=node.image.name
                replacement=tex.outputs['Color'] if 'BaseColor' in name else neutral.outputs[0] if 'BodyHair_Mask' in name else None
                if replacement is not None:
                    for link in list(node.outputs['Color'].links):
                        tree.links.new(replacement,link.to_socket)
            for node in list(tree.nodes):
                if node.bl_idname!='ShaderNodeHairInfo':continue
                original_links=list(node.outputs['Random'].links)
                if not original_links:continue
                calm=tree.nodes.new('ShaderNodeMapRange')
                calm.label='Narrow strand variation for a non-agouti coat'
                calm.inputs['To Min'].default_value=.40 if variant=='ragdoll' else .46
                calm.inputs['To Max'].default_value=.60 if variant=='ragdoll' else .54
                tree.links.new(node.outputs['Random'],calm.inputs['Value'])
                for link in original_links:tree.links.new(calm.outputs['Result'],link.to_socket)
            counts['nativeHairClosuresPreserved']+=sum(n.bl_idname in ['ShaderNodeBsdfHairPrincipled','ShaderNodeBsdfHair','ShaderNodeBsdfDiffuse','ShaderNodeBsdfPrincipled'] for n in tree.nodes)
            counts['nativeHairMaterials']+=1
        elif mat.name in ['GreyTabbyCat_Body_Skin','GreyTabbyCat_Ear_Skin']:
            tex=texture_nodes(tree,image)
            shader=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled')
            blend=tree.nodes.new('ShaderNodeMixRGB');blend.blend_type='MIX';blend.inputs[2].default_value=tuple(pink)+(1,)
            tree.links.new(tex.outputs['Alpha'],blend.inputs[0]);tree.links.new(tex.outputs['Color'],blend.inputs[1]);tree.links.new(blend.outputs[0],shader.inputs['Base Color'])
            for normal in tree.nodes:
                if normal.bl_idname=='ShaderNodeNormalMap':normal.inputs['Strength'].default_value*=.25 if variant=='siamese' else .6
            counts['skinMaterials']+=1
        elif mat.name=='GreyTabbyCat_Sclera':
            shader=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled')
            previous=shader.inputs['Base Color'].links[0].from_socket
            hsv=tree.nodes.new('ShaderNodeHueSaturation')
            hsv.label='Preserve native radial iris texture and corneal optics'
            hsv.inputs['Hue'].default_value=.43 if variant=='solid' else .92
            hsv.inputs['Saturation'].default_value=1.08 if variant=='solid' else .85
            hsv.inputs['Value'].default_value=1.18 if variant=='solid' else .85
            tree.links.new(previous,hsv.inputs['Color']);tree.links.new(hsv.outputs[0],shader.inputs['Base Color'])
    return counts


def groom(body,variant):
    results=[]
    for ps in body.particle_systems:
        if 'Beard' in ps.name:continue
        if variant=='siamese':
            factor=.30
            if 'Long' in ps.name:factor=.16
            if 'HeadBase' in ps.name:factor=.42
        elif variant=='ragdoll':
            factor=.90
            if 'BodyLong' in ps.name:factor=.70
            if 'HeadLong' in ps.name:factor=.65
            if 'Tail' in ps.name:factor=1.02
        else:factor=.55 if 'Long' in ps.name else .78
        settings_before={name:getattr(ps.settings,name) for name in ['roughness_1','roughness_2','roughness_endpoint','kink_amplitude','radius_scale','clump_factor','kink']}
        disturbance={'solid':.18,'ragdoll':.35,'siamese':.075}[variant]
        for name in ['roughness_1','roughness_2','roughness_endpoint','kink_amplitude']:
            setattr(ps.settings,name,getattr(ps.settings,name)*disturbance)
        ps.settings.radius_scale *= {'solid':.8,'ragdoll':.8,'siamese':.55}[variant]
        ps.settings.clump_factor *= {'solid':.6,'ragdoll':.8,'siamese':.35}[variant]
        if variant in ['solid','siamese']:ps.settings.kink='NO'
        total_before,total_after=0,0
        for particle in ps.particles:
            keys=particle.hair_keys
            if len(keys)<2:continue
            root=keys[0].co_local.copy()
            original=[k.co_local.copy() for k in keys]
            total_before+=sum((a-b).length for a,b in zip(original[1:],original[:-1]))
            strand_factor=factor
            if variant=='ragdoll':
                px,py,pz=particle.location
                if 'HeadLong' in ps.name and abs(px)>.015 and -.20<py<-.10 and pz>.16:strand_factor*=1.4
                if 'BodyLong' in ps.name and pz<.13:strand_factor*=1.3
                if 'Tail' in ps.name:strand_factor*=1+.30*math.exp(-((py-.265)/.075)**4)
            for key in keys[1:]:key.co_local=root+(key.co_local-root)*strand_factor
            total_after+=sum((a.co_local-b.co_local).length for a,b in zip(keys[1:],keys[:-1]))
        results.append({'system':ps.name,'factor':factor,'guides':len(ps.particles),'totalLengthBefore':total_before,'totalLengthAfter':total_after,'settingsBefore':settings_before,'settingsAfter':{name:getattr(ps.settings,name) for name in settings_before}})
    return results


def review_expression(body,variant):
    """Save a reproducible, four-paw static review state without walk repairs."""
    frozen=[]
    for rig in (obj for obj in bpy.data.objects if obj.type=='ARMATURE'):
        rig.data.pose_position='REST'
    keys=body.data.shape_keys
    if keys.animation_data:
        for driver in keys.animation_data.drivers:
            driver.mute=True;frozen.append(driver.data_path)
    for key in keys.key_blocks:
        if key.name!='Basis' and not key.name.startswith('Miaoxing '):
            key.value=1 if key.name=='repair_face' else 0
    # The source's upper-blink key is a corrective that raises the skin rim,
    # confirmed by inspecting its deltas, rather than a conventional close key.
    opening={'solid':.55,'ragdoll':.50,'siamese':.10}[variant]
    for side in ['L','R']:
        key=keys.key_blocks.get('blink_u.'+side)
        if key:key.slider_min=-.35;key.value=opening
        for rig in (obj for obj in bpy.data.objects if obj.type=='ARMATURE'):
            control=rig.pose.bones.get('CTR_eye_a.'+side)
            if control:control['pupil']=.40 if variant=='solid' else .30 if variant=='ragdoll' else .22
    for obj in bpy.data.objects:
        if obj.type!='MESH' or 'Sclera' not in obj.name or not obj.data.shape_keys:continue
        ocular_keys=obj.data.shape_keys
        if ocular_keys.animation_data:
            for driver in ocular_keys.animation_data.drivers:driver.mute=True
        for key in ocular_keys.key_blocks:
            if key.name=='pupil_CTR01':key.value=.40 if variant=='solid' else .30 if variant=='ragdoll' else .22
            elif key.name=='pupil_CTR02':key.value=0
    bpy.context.view_layer.update()
    return {'pose':'REST','walkActionRetained':True,'walkCorrectiveDriversMutedForStaticReview':frozen,'upperBlinkValue':opening,'pupilShapeDriversFrozenForStaticReview':True}


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
    expression_report=review_expression(body,variant)
    for img in bpy.data.images:
        if img.filepath:img.filepath=bpy.path.abspath(img.filepath)
    scene['miaoxing_model_variant']=variant
    scene['miaoxing_model_label']=NAMES[variant]
    scene['miaoxing_model_source']=str(source)
    path=ROOT/'assets/authored'/('cat-'+variant+'-v2.blend')
    path.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    if hashlib.sha256(source.read_bytes()).hexdigest()!=before_hash:raise RuntimeError('Source changed')
    report={'variant':variant,'revision':'photo-reference-v2','label':NAMES[variant],'source':str(source),'sourceSha256':before_hash,'output':str(path),'shape':shape,'eyeAlignment':eyes,'auxiliaryAlignment':auxiliary,'atlas':atlas_report,'materials':material_report,'groom':groom_report,'reviewPose':expression_report,'originalUnchanged':True,'scope':'Native Blender look-development model; web conversion and full animation retargeting/QA pending'}
    (OUT/(variant+'-build.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('CAT_MODEL_SAVED',variant,str(path),flush=True)
