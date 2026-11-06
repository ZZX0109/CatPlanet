"""Local CC0 orbital albedo repair and native, Blink-bound lid micro-fur.

The image operation authors a real material texture which is subsequently baked
to the model UVs. No render plane or view-dependent runtime effect is retained.
"""
import bisect
import itertools
import json
import math
import random
from array import array

import bpy
import numpy as np
from mathutils import Vector
from mathutils.geometry import barycentric_transform


def _smooth(low, high, value):
    t=np.clip((value-low)/(high-low),0,1)
    return t*t*(3-2*t)


def _sample(image,x,y):
    """Bilinear sample, with pixel coordinates measured from the bottom left."""
    height,width=image.shape[:2]
    x=np.clip(x,0,width-1);y=np.clip(y,0,height-1)
    ix=x.astype(np.int32);iy=y.astype(np.int32)
    jx=np.minimum(ix+1,width-1);jy=np.minimum(iy+1,height-1)
    fx=(x-ix)[...,None];fy=(y-iy)[...,None]
    return (image[iy,ix]*(1-fx)+image[iy,jx]*fx)*(1-fy)+(image[jy,ix]*(1-fx)+image[jy,jx]*fx)*fy


def _resize(image,width,height):
    y,x=np.mgrid[0:height,0:width]
    return _sample(image,x*(image.shape[1]-1)/max(1,width-1),y*(image.shape[0]-1)/max(1,height-1))


def _mask(x,y):
    distance=np.minimum(((x-.328)/.265)**2+((y-.006)/.17)**2,((x+.328)/.265)**2+((y-.006)/.17)**2)
    protect_m=(1-_smooth(.055,.15,np.abs(x)))*_smooth(.10,.25,y)
    return (1-_smooth(.55,1.5,distance))*(1-protect_m)


def repair_orbital_albedo(image,output_path):
    """Extend actual adjacent fur colors, adding resolved directional filaments.

    The rejected eye-picture footprint stays unchanged. A multiscale harmonic
    extension carries the genuine brow/cheek colors through that footprint;
    genuine high-frequency safe brow fur and tapered, outward groomed filaments
    provide detail rather than a flat tan overlay or copied eye highlights.
    """
    width,height=image.size
    values=np.empty(width*height*4,dtype=np.float32)
    image.pixels.foreach_get(values)
    raw=values.reshape(height,width,4)
    linear=np.where(raw[:,:,:3]<=.04045,raw[:,:,:3]/12.92,((raw[:,:,:3]+.055)/1.055)**2.4)
    py,px=np.mgrid[0:height,0:width]
    x=(px+.5)/width*2.6-1.3
    y=(py+.5)/height*2.6-1.15
    mask=_mask(x,y).astype(np.float32)
    # Filter source fur only for the broad color solve, never the final texture.
    low=_resize(_resize(linear,384,384),width,height).astype(np.float32)
    previous=None
    for side in (64,128,256,512,1024,width):
        if side>width:
            continue
        level_source=_resize(low,side,side).astype(np.float32)
        gy,gx=np.mgrid[0:side,0:side]
        unknown=_mask((gx+.5)/side*2.6-1.3,(gy+.5)/side*2.6-1.15)>.015
        result=level_source.copy()if previous is None else _resize(previous,side,side).astype(np.float32)
        result[~unknown]=level_source[~unknown]
        for _ in range(220 if side==64 else 65 if side<=512 else 24):
            average=(np.roll(result,1,axis=0)+np.roll(result,-1,axis=0)+np.roll(result,1,axis=1)+np.roll(result,-1,axis=1))*.25
            result[unknown]=average[unknown]
        previous=result
    repaired=previous
    # Quilt small, overlapping REAL safe-brow microtexture patches at roughly
    # native density. A continuous .28-scaled source Y stretched hairs 3.6x
    # into long wooden grooves; bounded patches cannot propagate those clumps.
    # Each patch rotates with the local groom and uses only high-frequency RGB.
    detail=np.zeros((height,width,3),dtype=np.float32)
    detail_weights=np.zeros((height,width),dtype=np.float32)
    rng=random.Random(7208)
    patch=22;step=11
    for cy in range(int(.91/2.6*height),int(1.40/2.6*height),step):
        for cx in range(int(.60/2.6*width),int(2.00/2.6*width),step):
            if mask[min(height-1,cy),min(width-1,cx)]<.005:
                continue
            xx=(cx+.5)/width*2.6-1.3;yy=(cy+.5)/height*2.6-1.15
            sign=1 if xx>0 else -1
            dx,dy=sign*.7,.85 if yy>.006 else -.8
            if abs(xx)<.20:
                dx,dy=-sign*.35,-1
            theta=math.atan2(dy,dx)+rng.uniform(-.48,.48)
            beta=math.pi/2-theta
            bottom=max(0,cy-patch//2);top=min(height,cy+patch//2+1)
            left=max(0,cx-patch//2);right=min(width,cx+patch//2+1)
            gy,gx=np.mgrid[bottom:top,left:right];gx=gx-cx;gy=gy-cy
            center_x=(rng.uniform(-.65,-.13)+1.3)/2.6*width
            center_y=(rng.uniform(.27,.46)+1.15)/2.6*height
            source_x=center_x+(gx*math.cos(beta)-gy*math.sin(beta))*1.65
            source_y=center_y+(gx*math.sin(beta)+gy*math.cos(beta))*1.65
            frequency=_sample(linear,source_x,source_y)-_sample(low,source_x,source_y)
            window=np.exp(-2.5*((gx/(patch/2))**2+(gy/(patch/2))**2))
            detail[bottom:top,left:right]+=np.clip(frequency,-.16,.16)*window[...,None]
            detail_weights[bottom:top,left:right]+=window
    detail/=np.maximum(detail_weights,.0001)[...,None]
    repaired=np.maximum(0,repaired+detail*.90)
    # Tapered shafts at submillimeter head scale, groomed away from the opening.
    # Shadows/pigment and light tips are separate, keeping the field from looking
    # like bright parallel scratch marks. Seeded construction is reproducible.
    grain=np.zeros((height,width),dtype=np.float32)
    rng=random.Random(1834)
    for sign in (-1,1):
        for _ in range(5200):
            xx=sign*.328+rng.uniform(-.325,.325)
            yy=.006+rng.uniform(-.21,.21)
            if float(_mask(np.array(xx),np.array(yy)))<.015:
                continue
            dx=sign*(.65+.25*abs(xx-sign*.328)/.325)
            dy=.85 if yy>.006 else -.8
            if abs(xx)<.20:
                dx,dy=-sign*.35,-1
            theta=math.atan2(dy,dx)+rng.uniform(-.48,.48)
            dx,dy=math.cos(theta),math.sin(theta)
            length=rng.uniform(.008,.018)*width/2.6
            norm=math.hypot(dx,dy);dx/=norm;dy/=norm
            cx=(xx+1.3)/2.6*width;cy=(yy+1.15)/2.6*height
            reach=int(length+3)
            left=max(0,int(cx)-reach);right=min(width,int(cx)+reach+1)
            bottom=max(0,int(cy)-reach);top=min(height,int(cy)+reach+1)
            yy_grid,xx_grid=np.mgrid[bottom:top,left:right]
            along=(xx_grid-cx)*dx+(yy_grid-cy)*dy
            cross=-(xx_grid-cx)*dy+(yy_grid-cy)*dx
            t=np.clip(along/max(length,.01),0,1)
            cross-=.35*np.sin(t*math.pi)
            sigma=rng.uniform(.8,1.3)*(1-.55*t)
            shaft=np.exp(-.5*(cross/np.maximum(.2,sigma))**2)*np.sin(math.pi*t)**.6
            shaft[(along<0)|(along>length)]=0
            grain[bottom:top,left:right]+=shaft*rng.uniform(-.28,.34)
    repaired*=np.clip(1+grain[...,None],.62,1.44)
    final=linear*(1-mask[...,None])+repaired*mask[...,None]
    final=np.where(final<=.0031308,final*12.92,1.055*np.maximum(final,0)**(1/2.4)-.055)
    raw[:,:,:3]=np.clip(final,0,1)
    image.pixels.foreach_set(np.ascontiguousarray(raw,dtype=np.float32).ravel())
    image.update()
    image.filepath_raw=str(output_path)
    image.file_format='PNG'
    image.save()
    image['orbitalRepair']='CC0 boundary harmonic colors + safe-brow high-frequency fur + directional tapered shafts; unchanged old-eye exclusion'
    return {'method':'CC0 neighboring fur extension with directional filament detail','painted_pixels':int(np.count_nonzero(mask>.015)),'filament_candidates_per_eye':5200,'old_eye_mask_unchanged':True}


def build_lid_fur(lid,count=260):
    """Short strands follow a root and shortest-arc surface-frame rotation.

    Rotation is evaluated on complete endpoint poses, never on a residual key.
    The existing native factor dictionary receives the exact Moebius finite
    differences through its available ordinary/Blink/Combo factor sets. Between
    endpoints the GLB uses normal multilinear native-morph interpolation.
    """
    mesh=lid.data
    mesh.calc_loop_triangles()
    basis=[point.co.copy()for point in mesh.shape_keys.key_blocks['Basis'].data]
    triangles=[];cumulative=[];area=0
    for tri in mesh.loop_triangles:
        if tri.area<1e-10 or tri.normal.y>-.30:
            continue
        area+=tri.area;triangles.append(tri);cumulative.append(area)
    if not triangles:
        return None,{}
    seed=204+sum(ord(char)for char in lid.name)
    rng=random.Random(seed)
    vertices=[];faces=[];uvs=[];bindings=[]
    uv_layer=mesh.uv_layers.active
    for _ in range(count):
        tri=triangles[bisect.bisect_left(cumulative,rng.random()*area)]
        s=math.sqrt(rng.random());t=rng.random();weights=(1-s,s*(1-t),s*t)
        total=sum(weights);weights=tuple(weight/total for weight in weights)
        a,b,c=[basis[index]for index in tri.vertices]
        normal=(b-a).cross(c-a).normalized()
        root=a*weights[0]+b*weights[1]+c*weights[2]
        # Blender +Z is the authored up axis; fur flows toward brow or cheek.
        flow=Vector(((1 if root.x>0 else -1)*.35,0,1 if 'Upper' in lid.name else -1))
        flow-=normal*flow.dot(normal)
        if flow.length_squared<1e-10:
            flow=b-a
        flow.normalize();lateral=normal.cross(flow).normalized()
        length=rng.uniform(.004,.009)
        width=rng.uniform(.00035,.00065)
        points=[root-lateral*width,root+lateral*width,root+flow*length*.55-lateral*width*.5,root+flow*length*.55+lateral*width*.5,root+flow*length]
        lofts=[.00025,.00025,.0008,.0008,.0013]
        first=len(vertices)
        for point,loft in zip(points,lofts):
            offset=normal*loft
            bindings.append((tuple(tri.vertices),Vector(weights),point+offset-root))
            vertices.append(point+offset)
        texture_uv=sum((uv_layer.data[index].uv*weight for index,weight in zip(tri.loops,weights)),Vector((0,0)))
        uvs.extend([texture_uv]*5)
        faces.extend(((first,first+1,first+3,first+2),(first+2,first+3,first+4)))
    data=bpy.data.meshes.new(f'NativeBound_{lid.name}_ShortFur')
    data.from_pydata(vertices,[],faces);data.update()
    uv=data.uv_layers.new(name='CoatUV')
    for loop in data.loops:
        uv.data[loop.index].uv=uvs[loop.vertex_index]
    material=lid.data.materials[0].copy();material.name=f'Fine lid coat: {lid.name}'
    shader=material.node_tree.nodes.get('Principled BSDF')
    for link in list(shader.inputs['Normal'].links):
        material.node_tree.links.remove(link)
    shader.inputs['Roughness'].default_value=.94
    material.use_backface_culling=False
    data.materials.append(material)
    obj=bpy.data.objects.new(f'Fur_{lid.name}',data)
    bpy.context.collection.objects.link(obj)
    obj['creatorPart']='eyes';obj['templateId']='structural-cat-v2'
    obj['boundSurface']=lid.name
    obj['binding']='Common root barycentric position + shortest-arc basis-normal frame rotation; complete-pose Moebius native cross corrections'
    obj['bindingMode']='root-shortest-arc-moebius-v1'
    obj.shape_key_add(name='Basis')
    def factors(name):
        blink=name.startswith('Blink_')
        if name=='Blink':
            return frozenset(('Blink',))
        base_name=name[6:]if blink else name
        result=set(base_name[6:].split('__')if base_name.startswith('Combo_')else (base_name,))
        if blink:
            result.add('Blink')
        return frozenset(result)
    entries={factors(key.name):(key.name,[point.co-basis[index]for index,point in enumerate(key.data)])for key in mesh.shape_keys.key_blocks if key.name!='Basis'}
    pose_cache={}
    normal_cache={}
    for ids,_,_ in bindings:
        if ids not in normal_cache:
            a,b,c=[basis[index]for index in ids]
            normal_cache[ids]=(b-a).cross(c-a).normalized()
    def full_pose(factor_set):
        if factor_set in pose_cache:
            return pose_cache[factor_set]
        coordinates=[point.copy()for point in basis]
        for source_factors,(_,deltas)in entries.items():
            if source_factors.issubset(factor_set):
                for index,delta in enumerate(deltas):
                    coordinates[index]+=delta
        points=[]
        for start in range(0,len(bindings),5):
            ids,bary,_=bindings[start]
            a,b,c=[coordinates[index]for index in ids]
            posed_normal=(b-a).cross(c-a).normalized()
            base_normal=normal_cache[ids]
            if posed_normal.length_squared<1e-10:
                posed_normal=base_normal
            rotation=base_normal.rotation_difference(posed_normal)
            root=sum((coordinates[index]*weight for index,weight in zip(ids,bary)),Vector())
            points.extend(root+rotation@bindings[index][2]for index in range(start,start+5))
        pose_cache[factor_set]=points
        return points
    factor_dictionary={}
    for factor_set,(name,_)in entries.items():
        ordered=sorted(factor_set)
        correction=[Vector()for _ in vertices]
        for size in range(len(ordered)+1):
            sign=(-1)**(len(ordered)-size)
            for subset in itertools.combinations(ordered,size):
                points=full_pose(frozenset(subset))
                for index,point in enumerate(points):
                    correction[index]+=point*sign
        if max(point.length for point in correction)<1e-7:
            continue
        target=obj.shape_key_add(name=name)
        for index,point in enumerate(target.data):
            point.co=vertices[index]+correction[index]
        factor_dictionary[name]=ordered
    for axis,name in enumerate(('LidRootTriangleA','LidRootTriangleB','LidRootTriangleC')):
        attribute=data.attributes.new(name=name,type='INT',domain='POINT')
        attribute.data.foreach_set('value',array('i',(binding[0][axis]for binding in bindings)))
    attribute=data.attributes.new(name='LidRootBarycentric',type='FLOAT_VECTOR',domain='POINT')
    attribute.data.foreach_set('vector',array('f',(value for _,bary,_ in bindings for value in bary)))
    attribute=data.attributes.new(name='LidRestOffset',type='FLOAT_VECTOR',domain='POINT')
    attribute.data.foreach_set('vector',array('f',(value for _,_,offset in bindings for value in offset)))
    attribute=data.attributes.new(name='LidBasisNormal',type='FLOAT_VECTOR',domain='POINT')
    attribute.data.foreach_set('vector',array('f',(value for ids,_,_ in bindings for value in normal_cache[ids])))
    obj['bindingFactors']=json.dumps(factor_dictionary)
    report={'surface':lid.name,'strands':count,'vertices':len(vertices),'nonzero_native_targets':len(obj.data.shape_keys.key_blocks)-1,'has_blink':obj.data.shape_keys.key_blocks.get('Blink')is not None,'binding':'Root + shortest-arc frame; full-pose Moebius native factors','max_factor_order':max(map(len,entries)),'cached_endpoint_poses':len(pose_cache)}
    obj['bindingAudit']=json.dumps(report)
    return obj,report
