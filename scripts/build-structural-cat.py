"""Rebuild an editable CC0 feline head, with physical eye sockets and lids.

Run with the project-local Blender. Source geometry is never overwritten.
The GLB is Y-up; all authored coordinates below use X-right/Y-up/Z-forward.
"""
import bpy
import bmesh
import json
import math
import os
import runpy
import hashlib
from array import array
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path.cwd()
REFINEMENT_ROUND = int(os.environ.get("CAT_REFINEMENT_ROUND", "8"))
def output_path(variable,default):
    value=Path(os.environ.get(variable,default))
    return value if value.is_absolute()else ROOT/value

OUT = output_path('CAT_CREATOR_OUT','public/models/creator')
SOURCE = output_path('CAT_CREATOR_SOURCE','assets/authored')
ARTIFACTS = output_path('CAT_CREATOR_ARTIFACTS','artifacts/structural-cat')
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
ARTIFACTS.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.import_scene.gltf(filepath=str(ROOT / "public/models/review/tabby-web.glb"))
skin = next(o for o in bpy.context.scene.objects if o.type == "MESH")
skin.name = "Skin_Head"
lat = Vector((.956, 0, -.293)).normalized()
forward = Vector((.293, 0, .956)).normalized()
origin = Vector((-.278, 1.071, .557))
scale = 4.4


def blender(p):
    return Vector((p[0], -p[2], p[1]))


def authored(p):
    return Vector((p[0], p[2], -p[1]))


def smoothstep(a,b,value):
    t=max(0,min(1,(value-a)/(b-a)))
    return t*t*(3-2*t)


world = skin.matrix_world.copy()
for v in skin.data.vertices:
    q = authored(world @ v.co) - origin
    p = Vector((q.dot(lat), q.y, q.dot(forward))) * scale
    v.co = blender(p)
skin.matrix_world.identity()
skin.parent = None
bm = bmesh.new()
bm.from_mesh(skin.data)
# Keep the real skull and muzzle, not shoulders/tail; the open neck is capped.
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00015)
for point, normal in [((0,0,0),(1,0,0)),((0,0,-.84),(0,0,-1)),((0,1.5,0),(0,1,0))]:
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=Vector(point),plane_no=Vector(normal),clear_outer=True,clear_inner=False)
bm.to_mesh(skin.data)
bm.free()
skin.data.materials.clear()
for layer in list(skin.data.uv_layers):
    skin.data.uv_layers.remove(layer)
bpy.context.view_layer.objects.active = skin
skin.select_set(True)
mirror = skin.modifiers.new("Symmetric anatomical base", "MIRROR")
mirror.use_clip = True
mirror.use_mirror_merge = True
mirror.merge_threshold = .012
bpy.ops.object.modifier_apply(modifier=mirror.name)
bm=bmesh.new()
bm.from_mesh(skin.data)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.0003)
bmesh.ops.holes_fill(bm,edges=[e for e in bm.edges if e.is_boundary],sides=0)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bm.to_mesh(skin.data)
bm.free()
remesh = skin.modifiers.new("Clean continuous sculpt surface", "REMESH")
remesh.mode = "VOXEL"
remesh.voxel_size = .028 if REFINEMENT_ROUND >= 1 else .034
remesh.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier=remesh.name)
smooth = skin.modifiers.new("Remove baked eye ridges", "SMOOTH")
smooth.factor = .55 if REFINEMENT_ROUND >= 1 else 1.05
smooth.iterations = 6 if REFINEMENT_ROUND >= 1 else 5
bpy.ops.object.modifier_apply(modifier=smooth.name)

# Remove any small disconnected remnants left by the source crop.
bm = bmesh.new()
bm.from_mesh(skin.data)
visited = set()
components = []
for v in bm.verts:
    if v in visited:
        continue
    stack = [v]
    component = []
    visited.add(v)
    while stack:
        q = stack.pop()
        component.append(q)
        for edge in q.link_edges:
            other = edge.other_vert(q)
            if other not in visited:
                visited.add(other)
                stack.append(other)
    components.append(component)
if components:
    largest = max(components, key=len)
    keep = set(largest)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in keep], context="VERTS")
bm.to_mesh(skin.data)
bm.free()

EYE_X = .328
EYE_Y = .006
EYE_Z = -.190 if REFINEMENT_ROUND >= 8 else (-.215 if REFINEMENT_ROUND >= 1 else -.19)
EYE_R = .235
APERTURE_X = .178 if REFINEMENT_ROUND >= 1 else .196
APERTURE_Y = .104 if REFINEMENT_ROUND >= 6 else (.098 if REFINEMENT_ROUND >= 1 else .086)

if REFINEMENT_ROUND >= 1:
    # The source is a fur-covered scan-like surface, not an anatomical orbital
    # plane. Its painted-eye ridges left a steep funnel when actual holes were
    # opened. Re-sculpt the whole periorbital mask before cutting, including the
    # lower orbital support and medial bridge, rather than inflating a lid ring.
    skin.data.update()
    samples=[(vertex,authored(vertex.co),authored(vertex.normal))for vertex in skin.data.vertices]
    updates=[]
    for vertex,p,normal in samples:
        side=-1 if p.x<0 else 1
        radius=math.sqrt(((p.x-side*EYE_X)/.32)**2+((p.y-EYE_Y)/.25)**2)
        if p.z>-.46 and normal.z>-.1 and radius<1.95:
            t=max(0,min(1,(radius-1.2)/.75))
            weight=1-t*t*(3-2*t)
            n=max(0,min(1,(normal.z+.1)/.55))
            weight *= n*n*(3-2*n)
            target=.055-.28*p.x*p.x+.18*max(0,-p.y)-.12*p.y*p.y
            p.z += max(-.11,min(.11,target-p.z))*weight
            updates.append((vertex,blender(p)))
    for vertex,co in updates:
        vertex.co=co
    # Rebuild the closed sculpt after the orbital projection, before making
    # holes. This eliminates the few tangential voxel slivers that would fold
    # when a front-facing sample moves past an adjacent side-facing sample.
    rebuild=skin.modifiers.new("Fair orbital skin topology","REMESH")
    rebuild.mode="VOXEL"
    rebuild.voxel_size=.028
    rebuild.use_smooth_shade=True
    bpy.ops.object.modifier_apply(modifier=rebuild.name)
    fair=skin.modifiers.new("Fair orbital skin surface","SMOOTH")
    fair.factor=.42
    fair.iterations=3
    bpy.ops.object.modifier_apply(modifier=fair.name)

if REFINEMENT_ROUND >= 2:
    # Smooth the scanned pinna separately from the facial features. Voxel fur
    # ridges in the ear are not anatomical cartilage and should not survive as
    # lumps in a texture-free mother model.
    bm=bmesh.new()
    bm.from_mesh(skin.data)
    for iteration in range(14):
        updates={}
        for vertex in bm.verts:
            p=authored(vertex.co)
            weight=smoothstep(.38,.68,p.y)*smoothstep(.35,.55,abs(p.x))
            if weight and vertex.link_edges:
                average=sum((edge.other_vert(vertex).co for edge in vertex.link_edges),Vector())/len(vertex.link_edges)
                updates[vertex]=vertex.co.lerp(average,.24*weight)
        for vertex,co in updates.items():
            vertex.co=co
    bm.to_mesh(skin.data)
    bm.free()
    skin.data.update()
    samples=[(vertex,authored(vertex.co),authored(vertex.normal))for vertex in skin.data.vertices]
    for vertex,p,normal in samples:
        if p.z>-.15 and normal.z>.1 and -.80<p.y<-.29:
            # Two subtle whisker pads, a genuine philtrum valley and a shallow
            # lip separation distinguish muzzle tissue from the original slab.
            for side in (-1,1):
                p.z += .040*math.exp(-2.4*(((p.x-side*.17)/.17)**2+((p.y+.50)/.12)**2))
            philtrum=math.exp(-2.5*(p.x/.026)**2)*smoothstep(-.65,-.56,p.y)*(1-smoothstep(-.50,-.46,p.y))
            p.z -= .017*philtrum
            mouth_t=min(1,abs(p.x)/.25)
            mouth_y=-.585-.035*max(0,math.sin(math.pi*mouth_t))**.85-.010*mouth_t
            lip=math.exp(-2.5*((p.y-mouth_y)/.022)**2)*(1-smoothstep(.27,.37,abs(p.x)))
            p.z -= .017*lip
            p.z += .025*math.exp(-2.5*((p.x/.24)**2+((p.y+.705)/.085)**2))
        ear_t=(p.y-.40)/.60
        if 0<ear_t<1 and abs(p.x)>.36 and normal.z>.1:
            center=.63+.13*ear_t
            half=.25*(1-ear_t)+.035
            u=(abs(p.x)-center)/half
            if abs(u)<1:
                p.z -= .038*(1-u*u)**2*math.sin(math.pi*ear_t)*smoothstep(.1,.65,normal.z)
        bottom=1-smoothstep(-.84,-.60,p.y)
        if bottom:
            p.x *= 1-.22*bottom
            p.y += .075*bottom*min(1,(abs(p.x)/.8)**2)
        vertex.co=blender(p)
    # A physical rounded edge around the capped neck removes the brick-like
    # hard silhouette while leaving a useful bust for continuing in Blender.
    rebuild=skin.modifiers.new("Rounded jaw to neck transition","REMESH")
    rebuild.mode='VOXEL'
    rebuild.voxel_size=.028
    rebuild.use_smooth_shade=True
    bpy.ops.object.modifier_apply(modifier=rebuild.name)
    fair=skin.modifiers.new("Smooth jaw and pinna transitions","SMOOTH")
    fair.factor=.4
    fair.iterations=3
    bpy.ops.object.modifier_apply(modifier=fair.name)

# Cache the uncut sculpt surface for continuous eyelid-to-skull attachment.
skin.data.update()
skin_bvh = BVHTree.FromPolygons([v.co.copy() for v in skin.data.vertices], [list(p.vertices) for p in skin.data.polygons])


def surface_z(x, y):
    hit = skin_bvh.ray_cast(blender((x, y, 2)), blender((0, 0, -1)), 5)[0]
    return authored(hit).z if hit is not None else -.09


# Actual holes: discard the old eye surfaces rather than covering them with balls.
bm = bmesh.new()
bm.from_mesh(skin.data)
cut = []
OUTER_X=.235 if REFINEMENT_ROUND >= 1 else .285
OUTER_Y=.135 if REFINEMENT_ROUND >= 6 else (.155 if REFINEMENT_ROUND >= 1 else .205)
for v in bm.verts:
    p = authored(v.co)
    if p.z > -.22 and any(((p.x - side * EYE_X) / OUTER_X) ** 2 + ((p.y - EYE_Y) / OUTER_Y) ** 2 < 1 for side in (-1, 1)):
        cut.append(v)
bmesh.ops.delete(bm, geom=cut, context="VERTS")
# Align the actual cut boundary to a smooth ellipse, including exact inner and
# outer eye corners. The lids attach to THESE vertices, not floating circles.
for edge in list(bm.edges):
    if not edge.is_boundary:
        continue
    p,q=(authored(v.co)for v in edge.verts)
    if (p.y-EYE_Y)*(q.y-EYE_Y)<0 and p.z>-.4 and q.z>-.4:
        result=bmesh.ops.subdivide_edges(bm,edges=[edge],cuts=1,use_grid_fill=False)
        for v in result['geom_inner']:
            if isinstance(v,bmesh.types.BMVert):
                pos=authored(v.co)
                pos.y=EYE_Y
                v.co=blender(pos)
boundary={-1:[],1:[]}
boundary_info={}

def monotone_angles(values,low,high):
    # Project voxel-loop angles to the nearest monotone sequence. Raster stair
    # steps can run a little backwards in polar angle; following that directly
    # makes one entire radial column of the lid turn inside-out.
    epsilon=.004
    values=list(values)
    values[0],values[-1]=low,high
    blocks=[]
    for i,value in enumerate(values):
        weight=1e8 if i in (0,len(values)-1) else 1
        blocks.append([value*weight-i*epsilon*weight,weight,[i]])
        while len(blocks)>1 and blocks[-2][0]/blocks[-2][1]>blocks[-1][0]/blocks[-1][1]:
            right=blocks.pop()
            left=blocks.pop()
            blocks.append([left[0]+right[0],left[1]+right[1],left[2]+right[2]])
    output=[0]*len(values)
    for total,weight,indices in blocks:
        for i in indices:
            output[i]=total/weight+i*epsilon
    output[0],output[-1]=low,high
    return output
for vertex in bm.verts:
    if not vertex.is_boundary:
        continue
    p=authored(vertex.co)
    side=-1 if p.x<0 else 1
    theta=math.atan2((p.y-EYE_Y)/OUTER_Y,(p.x-side*EYE_X)/OUTER_X)%(2*math.pi)
    if abs(p.y-EYE_Y)<.00001:
        theta=0 if p.x-side*EYE_X>0 else math.pi
    x=side*EYE_X+OUTER_X*math.cos(theta)
    y=EYE_Y+OUTER_Y*math.sin(theta)
    z=surface_z(x,y)
    vertex.co=blender((x,y,z))
    boundary[side].append((theta,(x,y,z)))
    boundary_info[vertex]=(side,theta,(x,y,z))
for side in boundary:
    candidates=[v for v,info in boundary_info.items()if info[0]==side]
    start=min(candidates,key=lambda v:abs(boundary_info[v][1]))
    links=[e.other_vert(start)for e in start.link_edges if e.is_boundary]
    first=max(links,key=lambda v:authored(v.co).y)
    ordered=[start]
    previous,current=start,first
    while current is not start and len(ordered)<=len(candidates):
        ordered.append(current)
        choices=[e.other_vert(current)for e in current.link_edges if e.is_boundary and e.other_vert(current)is not previous]
        if not choices:
            break
        previous,current=current,choices[0]
    middle=min(range(len(ordered)),key=lambda i:abs(boundary_info[ordered[i]][1]-math.pi))
    measured=[boundary_info[vertex][1]for vertex in ordered]
    if REFINEMENT_ROUND >= 1:
        upper=monotone_angles(measured[:middle+1],0,math.pi)
        lower=monotone_angles(measured[middle:]+[2*math.pi],math.pi,2*math.pi)
        measured=upper+lower[1:-1]
    clean=[]
    for i,vertex in enumerate(ordered):
        # Preserve the measured polar parameter. Equal angular redistribution
        # by vertex index twists the cut loop relative to the adjacent skin and
        # was the cause of the two folded eye-corner triangles.
        theta=measured[i] if REFINEMENT_ROUND >= 1 else (math.pi*i/middle if i<=middle else math.pi+math.pi*(i-middle)/(len(ordered)-middle))
        x=side*EYE_X+OUTER_X*math.cos(theta)
        y=EYE_Y+OUTER_Y*math.sin(theta)
        z=surface_z(x,y)
        vertex.co=blender((x,y,z))
        clean.append((theta,(x,y,z)))
    boundary[side]=clean
    print('Orbital boundary',side,'vertices',len(candidates),'ordered',len(ordered),'upper',middle)
if REFINEMENT_ROUND >= 1:
    # Relax a collar OUTSIDE the fixed cut loop, so the rebuilt eye socket joins
    # the source skull through several regular rows rather than needle faces.
    fixed=set(boundary_info)
    for iteration in range(10):
        updates={}
        for vertex in bm.verts:
            if vertex in fixed or not vertex.link_edges:
                continue
            p=authored(vertex.co)
            side=-1 if p.x<0 else 1
            radius=math.sqrt(((p.x-side*EYE_X)/OUTER_X)**2+((p.y-EYE_Y)/OUTER_Y)**2)
            if p.z<-.38 or radius<.94 or radius>1.75:
                continue
            weight=.34*max(0,1-abs(radius-1.12)/.63)
            average=sum((edge.other_vert(vertex).co for edge in vertex.link_edges),Vector())/len(vertex.link_edges)
            updates[vertex]=vertex.co.lerp(average,weight)
        for vertex,co in updates.items():
            vertex.co=co
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bm.to_mesh(skin.data)
bm.free()


def material(name, color, roughness=.7, metal=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = roughness
    p.inputs["Metallic"].default_value = metal
    return m


clay = material("Neutral sculpt clay", (.43, .46, .47), .82)
eye_mat = material("Physical eyeball", (.42, .44, .4), .26)
iris_mat = material("Iris geometry", (.15, .19, .15), .3)
pupil_mat = material("Pupil geometry", (.015, .019, .019), .22)
nose_mat = material("Nasal planum", (.23,.125,.10) if REFINEMENT_ROUND>=3 else (.23,.25,.25), .58 if REFINEMENT_ROUND>=3 else .68)
iris_image=None
cornea_mat=None
tear_mat=None
if REFINEMENT_ROUND >= 3:
    nose_mat.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.32
    iris_image=runpy.run_path(str(ROOT/'scripts/creator-iris.py'))['make_iris_texture'](OUT,detailed=REFINEMENT_ROUND>=8)
    texture=iris_mat.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image=iris_image
    iris_mat.node_tree.links.new(texture.outputs['Color'],iris_mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    iris_mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.48
    cornea_mat=material('Optical cornea - environment reflections only',(.995,.998,1),.045)
    optical=cornea_mat.node_tree.nodes.get('Principled BSDF')
    optical.inputs['Transmission Weight'].default_value=1
    optical.inputs['IOR'].default_value=1.376
    cornea_mat.use_backface_culling=True
    tear_mat=material('Canthus mucosal tissue',(.25,.10,.075),.32)
    if REFINEMENT_ROUND >= 8:
        # A pupil is a light-absorbing opening, not a glossy black lens. Only
        # the clear cornea should carry the studio reflections.
        pupil_shader=pupil_mat.node_tree.nodes.get('Principled BSDF')
        pupil_shader.inputs['Base Color'].default_value=(.001,.0012,.001,1)
        pupil_shader.inputs['Roughness'].default_value=1
        pupil_shader.inputs['Specular IOR Level'].default_value=0
        iris_shader=iris_mat.node_tree.nodes.get('Principled BSDF')
        iris_shader.inputs['Roughness'].default_value=.62
        iris_shader.inputs['Specular IOR Level'].default_value=.15
        eye_shader=eye_mat.node_tree.nodes.get('Principled BSDF')
        eye_shader.inputs['Base Color'].default_value=(.085,.07,.045,1)
        eye_shader.inputs['Roughness'].default_value=.65
        eye_shader.inputs['Specular IOR Level'].default_value=.15
        tear_mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.10,.045,.027,1)
        wet_mat=material('Pigmented wet eyelid margin',(.035,.023,.015),.26)
        wet_mat.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.35

skin.data.materials.append(clay)
objects = []


def smooth01(a, b, t):
    t = min(1, max(0, (t-a)/(b-a)))
    return t*t*(3-2*t)


def gaussian(dx, dy, dz, rx, ry, rz):
    return math.exp(-2.2*((dx/rx)**2+(dy/ry)**2+(dz/rz)**2))


def params(key=None, value=0):
    return {key: value} if key else {}


def eye_center(side, p):
    x, y, z = side*EYE_X, EYE_Y, EYE_Z
    x += side*(.035*p.get("headRound",0)-.01*p.get("headWedge",0)+.01*p.get("headWidth",0))
    z += .05*p.get("headRound", 0) + .015*p.get("headWedge", 0) + .12*p.get("headDepth", 0)
    x += side*.035*p.get("eyeSpacing", 0)
    return Vector((x, y, z))


def skin_deform(co, p):
    x, y, z = co
    initial = Vector(co)
    roundness = p.get("headRound", 0)
    wedge = p.get("headWedge", 0)
    # Broad, anatomical shape differences, not texture-space nudges.
    lower = 1-smooth01(-.62, .25, y)
    x *= 1 + .15*roundness - (.12+.15*lower)*wedge + .23*p.get("headWidth", 0)
    y += .09*roundness*(1-smooth01(.45, .9, y)) - .09*wedge*lower
    z += (.05+.08*lower)*roundness + .13*wedge*lower + .22*p.get("headDepth", 0)*(z+.7)
    cheek = gaussian(abs(initial.x)-.57, initial.y+.27, initial.z+.08, .42, .3, .45)
    x += (1 if x >= 0 else -1)*.18*p.get("cheeks", 0)*cheek
    z += .05*p.get("cheeks", 0)*cheek
    jaw = 1-smooth01(-.65, -.24, initial.y)
    x *= 1 + .25*p.get("jaw", 0)*jaw
    y -= .13*p.get("jaw", 0)*jaw
    muzzle = gaussian(initial.x, initial.y+.43, initial.z-.14, .43, .3, .4)
    z += .27*p.get("muzzle", 0)*muzzle
    x *= 1 + .28*p.get("muzzleWidth", 0)*muzzle
    bridge = gaussian(initial.x, initial.y+.12, initial.z-.13, .15, .31, .25)
    z += .12*p.get("noseBridge", 0)*bridge
    y += .04*p.get("noseBridge", 0)*bridge
    # Preserve a rigid orbital chamber. The skull-width edit changes the outer
    # face but cannot compress the socket outer loop inside the eye opening.
    for side in (-1, 1):
        center = Vector((side*EYE_X, EYE_Y, EYE_Z))
        delta = initial-center
        if REFINEMENT_ROUND >= 1:
            if initial.x*side<0:
                continue
            distance=math.sqrt((delta.x/OUTER_X)**2+(delta.y/OUTER_Y)**2)
            weight=(1-smooth01(1.08,1.9,distance))*smooth01(-.55,-.25,initial.z)*smooth01(0,.09,abs(initial.x))
            size=1+.15*p.get("eyeSize",0)
            angle=side*math.radians(11)*p.get("eyeTilt",0)
            dx=(delta.x*math.cos(angle)-delta.y*math.sin(angle))*size
            dy=(delta.x*math.sin(angle)+delta.y*math.cos(angle))*size
            target=eye_center(side,p)+Vector((dx,dy,delta.z*size))
            x=x*(1-weight)+target.x*weight
            y=y*(1-weight)+target.y*weight
            z=z*(1-weight)+target.z*weight
        else:
            center = Vector((side*EYE_X, EYE_Y, -.01))
            delta = initial-center
            weight = gaussian(delta.x, delta.y, delta.z, .32, .26, .3)
            center_lower=1-smooth01(-.62,.25,EYE_Y)
            global_center_x=side*EYE_X*(1+.15*roundness-(.12+.15*center_lower)*wedge+.23*p.get("headWidth",0))
            x += (eye_center(side,p).x-global_center_x)*weight
            y -= (.09*roundness-.09*wedge*center_lower)*weight
            eye_size = .15*p.get("eyeSize", 0)*weight
            x += delta.x*eye_size
            y += delta.y*eye_size
            angle = side*math.radians(11)*p.get("eyeTilt", 0)*weight
            x += delta.x*(math.cos(angle)-1)-delta.y*math.sin(angle)
            y += delta.x*math.sin(angle)+delta.y*(math.cos(angle)-1)
    if REFINEMENT_ROUND >= 2:
        # Protect the outer orbital transition when two narrowing edits stack.
        # The single sliders retain their full authored amplitudes.
        side=1 if initial.x>=0 else -1
        orbital_distance=math.sqrt(((initial.x-side*EYE_X)/OUTER_X)**2+((initial.y-EYE_Y)/OUTER_Y)**2)
        orbital_weight=(1-smooth01(1.08,1.9,orbital_distance))*smooth01(-.55,-.25,initial.z)*smooth01(0,.09,abs(initial.x))
        x += side*(4*.23*.18)*cheek*(1-orbital_weight)*smooth01(0,.09,abs(initial.x))*max(0,-p.get('headWidth',0))*max(0,-p.get('cheeks',0))
    ear = smooth01(.35, .64, initial.y)*smooth01(.37, .6, abs(initial.x))
    side = 1 if initial.x >= 0 else -1
    if REFINEMENT_ROUND >= 2:
        # Cartilage rotates about an ear root; it does not shear in world X.
        # Head width moves that root while the pinna keeps its own local scale.
        pivot=Vector((side*.64,.4,-.35))
        root=Vector((pivot.x*(1+.15*roundness-.12*wedge+.23*p.get('headWidth',0)),.4+.09*roundness,-.35+.05*roundness+.077*p.get('headDepth',0)))
        local=(initial-pivot)*(1+.28*p.get('earSize',0))
        angle=-side*math.radians(18)*p.get('earTilt',0)
        target=root+Vector((local.x*math.cos(angle)-local.y*math.sin(angle),local.x*math.sin(angle)+local.y*math.cos(angle),local.z))
        x=x*(1-ear)+target.x*ear
        y=y*(1-ear)+target.y*ear
        z=z*(1-ear)+target.z*ear
    else:
        x += (initial.x-side*.64)*.29*p.get("earSize", 0)*ear
        y += (initial.y-.4)*.32*p.get("earSize", 0)*ear
        x += side*.29*p.get("earTilt", 0)*ear*(initial.y-.35)
    return Vector((x, y, z))


def make_mesh(name, vertices, faces, mat, part):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([blender(v) for v in vertices], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj["creatorPart"] = part
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def record(obj, kind, data=None):
    obj["creatorPart"] = "eyes" if kind in ("eyeball", "iris", "pupil", "lid", "cornea", "caruncle", "wet_lid") else ("muzzle" if kind == "nose" else "head")
    for poly in obj.data.polygons:
        poly.use_smooth = True
    objects.append((obj, kind, data))


record(skin, "skin")
skin.data.update()
boundary_normals={tuple(round(float(c),5)for c in authored(v.co)):authored(v.normal).normalized() for v in skin.data.vertices}

# A genuine nose surface with its own selection/material, following the skull.
NROWS,NCOLS=(23,33) if REFINEMENT_ROUND >= 2 else (13,17)
nose_vertices=[]
nose_faces=[]
for row in range(NROWS):
    t=row/(NROWS-1)
    y=-.345-.17*t if REFINEMENT_ROUND >= 2 else -.35-.16*t
    half=.146*(1-t)**.62+.009 if REFINEMENT_ROUND >= 2 else .135*(1-t)**.72+.006
    if REFINEMENT_ROUND >= 5:
        # A nasal planum has rounded upper alae, rather than the straight top
        # and widest-at-the-top outline of an inverted triangular patch.
        half=.142*(1-t)**.58+.008+.014*max(0,math.sin(math.pi*t))**.7*math.exp(-((t-.18)/.24)**2)
    for col in range(NCOLS):
        s=col/(NCOLS-1)
        x=half*(s*2-1)
        row_y=y
        if REFINEMENT_ROUND >= 3:
            row_y -= .008*(1-(s*2-1)**2)*(1-t)**3
        if REFINEMENT_ROUND >= 5:
            u=s*2-1
            upper_profile=.014*math.exp(-((abs(u)-.52)/.29)**2)-.025*abs(u)**5-.005*math.exp(-(u/.25)**2)
            row_y += upper_profile*(1-t)**2.5
        if REFINEMENT_ROUND >= 2:
            z=surface_z(x,row_y)+.014+.033*max(0,math.sin(math.pi*t))**.65*max(0,1-(s*2-1)**2)**.6
            z-=.006*math.exp(-2*((x/.022)**2+((row_y+.40)/.075)**2))
            if REFINEMENT_ROUND >= 3:
                z += .012*max(0,1-(s*2-1)**2)**.8*(1-.6*t)
            if REFINEMENT_ROUND >= 5:
                # Preserve real lateral volume around the Boolean passages;
                # the recessed nasal cavities remain separate physical meshes.
                z += .008*math.exp(-((abs(x)-.090)/.036)**2-((t-.40)/.30)**2)
        else:
            z=surface_z(x,y)+.009+.017*math.sin(math.pi*t)*math.sin(math.pi*s)
        nose_vertices.append((x,row_y,z))
for row in range(NROWS-1):
    for col in range(NCOLS-1):
        a=row*NCOLS+col
        nose_faces.append((a,a+NCOLS,a+NCOLS+1,a+1))
if REFINEMENT_ROUND >= 2:
    front_count=len(nose_vertices)
    nose_vertices += [(x,y,z-.065)for x,y,z in nose_vertices]
    front_faces=list(nose_faces)
    nose_faces += [tuple(index+front_count for index in reversed(face))for face in front_faces]
    border=list(range(NCOLS))+[row*NCOLS+NCOLS-1 for row in range(1,NROWS)]+[(NROWS-1)*NCOLS+col for col in range(NCOLS-2,-1,-1)]+[row*NCOLS for row in range(NROWS-2,0,-1)]
    for i,a in enumerate(border):
        b=border[(i+1)%len(border)]
        nose_faces.append((a,b,b+front_count,a+front_count))
nose=make_mesh('Nose',nose_vertices,nose_faces,nose_mat,'muzzle')
if REFINEMENT_ROUND >= 2:
    bm=bmesh.new()
    bm.from_mesh(nose.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(nose.data)
    bm.free()
    bpy.context.view_layer.objects.active=nose
    for side in (-1,1):
        cx,cy=side*.088,-.416
        cz=surface_z(cx,cy)+.026
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,radius=1,location=blender((cx,cy,cz)))
        cutter=bpy.context.object
        cutter.scale=(.030,.072,.0125 if REFINEMENT_ROUND>=3 else .017)
        cutter.rotation_euler.y=side*math.radians(23)
        bpy.context.view_layer.objects.active=nose
        boolean=nose.modifiers.new('Actual nasal passage','BOOLEAN')
        boolean.operation='DIFFERENCE'
        boolean.solver='EXACT'
        boolean.object=cutter
        bpy.ops.object.modifier_apply(modifier=boolean.name)
        bpy.data.objects.remove(cutter,do_unlink=True)
    bevel=nose.modifiers.new('Soft nasal rim','BEVEL')
    bevel.width=.0042 if REFINEMENT_ROUND >= 5 else .0035
    bevel.segments=3
    bevel.limit_method='ANGLE'
    bevel.angle_limit=.65
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    bm=bmesh.new()
    bm.from_mesh(nose.data)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.00001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    for edge in bm.edges:
        if len(edge.link_faces)==2:
            edge.smooth=edge.calc_face_angle()<.7
    bm.to_mesh(nose.data)
    bm.free()
record(nose,'nose')

if REFINEMENT_ROUND >= 2:
    cavity_mat=material('Deep nasal cavity',(.035,.020,.018) if REFINEMENT_ROUND>=3 else (.022,.014,.013),.85)
    mouth_mat=material('Recessed lip tissue',(.075,.047,.038),.82)
    for side,suffix in ((-1,'L'),(1,'R')):
        cx,cy=side*.088,-.416
        cz=surface_z(cx,cy)+.031
        vertices=[]
        faces=[]
        for ring in range(8):
            t=ring/7
            radial=1-.86*t
            for j in range(48):
                angle=2*math.pi*j/48
                dx=.0285*radial*math.cos(angle)
                dy=(.011 if REFINEMENT_ROUND>=3 else .0155)*radial*math.sin(angle)
                tilt=side*math.radians(23)
                x=cx+dx*math.cos(tilt)-dy*math.sin(tilt)
                y=cy+dx*math.sin(tilt)+dy*math.cos(tilt)
                vertices.append((x,y,cz-.008-.032*t))
        for ring in range(7):
            for j in range(48):
                a=ring*48+j
                b=ring*48+(j+1)%48
                faces.append((a,b,b+48,a+48))
        vertices.append((cx,cy,cz-.042))
        for j in range(48):
            faces.append((7*48+j,7*48+(j+1)%48,len(vertices)-1))
        pocket=make_mesh(f'Nostril_{suffix}',vertices,faces,cavity_mat,'muzzle')
        record(pocket,'nose')
    # The thin dark lip sits inside the already sculpted philtrum/mouth valleys;
    # the underlying skin indentation remains visible with one clay material.
    for side,suffix in ((-1,'L'),(1,'R')):
        curve=bpy.data.curves.new(f'Lip_Curve_{suffix}','CURVE')
        curve.dimensions='3D'
        curve.bevel_depth=.0027
        curve.bevel_resolution=3
        spline=curve.splines.new('POLY')
        spline.points.add(40)
        for i,point in enumerate(spline.points):
            x=side*.25*i/40
            t=abs(x)/.25
            y=-.585-.035*max(0,math.sin(math.pi*t))**.85-.010*t
            z=surface_z(x,y)-.001
            point.co=(*blender((x,y,z)),1)
        obj=bpy.data.objects.new(f'MouthLine_{suffix}',curve)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(mouth_mat)
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.convert(target='MESH')
        record(bpy.context.object,'nose')


def eye_surface(dx, dy, radius=EYE_R):
    return EYE_Z+math.sqrt(max(.0001, radius*radius-dx*dx-dy*dy))


for side, suffix in ((-1,"L"),(1,"R")):
    # Spherical geometry remains spherical under all supported non-eye-size edits.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48 if REFINEMENT_ROUND>=3 else 32, ring_count=32 if REFINEMENT_ROUND>=3 else 20, radius=EYE_R)
    ball = bpy.context.object
    ball.name = f"Eyeball_{suffix}"
    for v in ball.data.vertices:
        q = authored(v.co)
        v.co = blender(q+Vector((side*EYE_X,EYE_Y,EYE_Z)))
    ball.data.materials.append(eye_mat)
    if REFINEMENT_ROUND >= 3:
        # The cornea replaces the anterior scleral cap. Keeping an opaque full
        # sphere in front of a recessed iris would otherwise hide the anatomy.
        bm=bmesh.new()
        bm.from_mesh(ball.data)
        cap_z=EYE_Z+math.sqrt(EYE_R*EYE_R-.188*.188)
        bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),plane_co=blender((side*EYE_X,EYE_Y,cap_z)),plane_no=blender((0,0,1)),dist=.000001,clear_outer=True,clear_inner=False)
        bm.to_mesh(ball.data)
        bm.free()
    record(ball, "eyeball", {"side":side})
    # Iris and slit pupil are true curved patches on the sphere, with no texture.
    for name, rx, ry, mat, kind in (() if REFINEMENT_ROUND>=3 else (("Iris",.21,.21,iris_mat,"iris"),("Pupil",.026,.12,pupil_mat,"pupil"))):
        verts = [(side*EYE_X,EYE_Y,EYE_Z+EYE_R+.002+(kind=="pupil")*.002)]
        faces = []
        rings=7
        segments=48
        for ring in range(1,rings+1):
            for j in range(segments):
                theta=2*math.pi*j/segments
                dx=rx*ring/rings*math.cos(theta)
                dy=ry*ring/rings*math.sin(theta)
                verts.append((side*EYE_X+dx,EYE_Y+dy,eye_surface(dx,dy)+.002+(kind=="pupil")*.002))
        for j in range(segments):
            faces.append((0,1+j,1+(j+1)%segments))
        for ring in range(rings-1):
            start=1+ring*segments
            nxt=start+segments
            for j in range(segments):
                k=(j+1)%segments
                faces.append((start+j,nxt+j,nxt+k,start+k))
        obj=make_mesh(f"{name}_{suffix}",verts,faces,mat,"eyes")
        record(obj,kind,{"side":side})

    if REFINEMENT_ROUND >= 3:
        iris_radius=.183
        segments,rings=(192,21) if REFINEMENT_ROUND>=8 else (128,13)
        vertices=[]
        faces=[]
        for ring in range(rings):
            r=ring/(rings-1)
            for j in range(segments):
                theta=2*math.pi*j/segments
                if REFINEMENT_ROUND>=8:
                    pupil_x=.030*math.cos(theta)*abs(math.cos(theta))**.5
                    pupil_y=.074*math.sin(theta)
                    dx=(1-r)*pupil_x+r*iris_radius*math.cos(theta)
                    dy=(1-r)*pupil_y+r*iris_radius*math.sin(theta)
                    z=EYE_Z+.174+.008*r-.035*r*r+.00012*math.sin(theta*61+r*11)*math.sin(math.pi*r)**2
                else:
                    dx=((1-r)*.024+r*iris_radius)*math.cos(theta)
                    dy=((1-r)*.112+r*iris_radius)*math.sin(theta)
                    z=EYE_Z+.134-.010*(1-r)**2
                vertices.append((side*EYE_X+dx,EYE_Y+dy,z))
        for ring in range(rings-1):
            for j in range(segments):
                a=ring*segments+j
                k=ring*segments+(j+1)%segments
                faces.append((a,a+segments,k+segments,k))
        iris=make_mesh(f'Iris_{suffix}',vertices,faces,iris_mat,'eyes')
        uv=iris.data.uv_layers.new(name='Radial iris coordinates')
        for loop in iris.data.loops:
            co=authored(iris.data.vertices[loop.vertex_index].co)
            uv.data[loop.index].uv=((co.x-side*EYE_X)/(2*iris_radius)+.5,(co.y-EYE_Y)/(2*iris_radius)+.5)
        record(iris,'iris',{'side':side})

        # The pupil is a recessed black chamber behind the slit, not a raised
        # black sticker on the corneal highlight surface.
        vertices=[(side*EYE_X,EYE_Y,EYE_Z+(.148 if REFINEMENT_ROUND>=8 else .103))]
        faces=[]
        for ring in range(1,9):
            r=ring/8
            for j in range(96):
                theta=2*math.pi*j/96
                if REFINEMENT_ROUND>=8:
                    vertices.append((side*EYE_X+.0308*r*math.cos(theta)*abs(math.cos(theta))**.5,EYE_Y+.0755*r*math.sin(theta),EYE_Z+.148+.024*r*r))
                else:
                    vertices.append((side*EYE_X+.0255*r*math.cos(theta),EYE_Y+.1135*r*math.sin(theta),EYE_Z+.103+.018*r*r))
        for j in range(96):
            faces.append((0,1+j,1+(j+1)%96))
        for ring in range(7):
            a=1+ring*96
            b=a+96
            for j in range(96):
                k=(j+1)%96
                faces.append((a+j,b+j,b+k,a+k))
        pupil=make_mesh(f'Pupil_{suffix}',vertices,faces,pupil_mat,'eyes')
        record(pupil,'pupil',{'side':side})

        # A separate clear corneal cap carries real environment reflections.
        # No painted catchlight, emissive spot or white highlight sphere.
        vertices=[(side*EYE_X,EYE_Y,EYE_Z+EYE_R+.004)]
        faces=[]
        cornea_radius=EYE_R+.004
        for ring in range(1,17):
            r=.190*ring/16
            for j in range(96):
                theta=2*math.pi*j/96
                dx,dy=r*math.cos(theta),r*math.sin(theta)
                vertices.append((side*EYE_X+dx,EYE_Y+dy,EYE_Z+math.sqrt(cornea_radius**2-r*r)))
        for j in range(96):
            faces.append((0,1+j,1+(j+1)%96))
        for ring in range(15):
            a=1+ring*96
            b=a+96
            for j in range(96):
                k=(j+1)%96
                faces.append((a+j,b+j,b+k,a+k))
        cornea=make_mesh(f'Cornea_{suffix}',vertices,faces,cornea_mat,'eyes')
        record(cornea,'cornea',{'side':side})

        cx=side*(EYE_X-APERTURE_X+.004)
        cy=EYE_Y-APERTURE_X*math.sin(math.radians(4))
        cz=surface_z(cx,EYE_Y)-.003
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=16,radius=1)
        tear=bpy.context.object
        tear.name=f'Caruncle_{suffix}'
        for vertex in tear.data.vertices:
            q=authored(vertex.co)
            vertex.co=blender((cx+q.x*.012,cy+q.y*.008,cz+q.z*.007))
        tear.data.materials.append(tear_mat)
        tear_data={'side':side}
        if REFINEMENT_ROUND>=8:
            theta=0 if side<0 else math.pi
            _,outer=min(boundary[side],key=lambda sample:abs((sample[0]-theta+math.pi)%(2*math.pi)-math.pi))
            tear_data['origin']=(cx,cy,cz)
            tear_data['lid_corner']={'theta':theta,'radial':0,'upper':True,'side':side,'outer':outer,'outerNormal':boundary_normals.get(tuple(round(float(c),5)for c in outer),Vector((0,0,1)))}
        record(tear,'caruncle',tear_data)

    # A real upper/lower lid annulus. The globe is visible only through the hole.
    for upper in (True,False):
        data=[]
        vertices=[]
        faces=[]
        middle=min(range(len(boundary[side])),key=lambda i:abs(boundary[side][i][0]-math.pi))
        samples=boundary[side][:middle+1] if upper else boundary[side][middle:]+[boundary[side][0]]
        if not upper:
            samples=[(theta if theta>.00001 else 2*math.pi,co)for theta,co in samples]
        steps=len(samples)-1
        layers=13 if REFINEMENT_ROUND >= 1 else 7
        for layer in range(layers):
            radial=layer/(layers-1)
            for theta,co in samples:
                local_theta=theta if upper else 2*math.pi-theta
                vertices.append(co)
                data.append({"theta":local_theta,"radial":radial,"upper":upper,"side":side,"outer":co,"outerNormal":boundary_normals.get(tuple(round(float(c),5)for c in co),Vector((0,0,1)))})
        for layer in range(layers-1):
            for j in range(steps):
                a=layer*(steps+1)+j
                b=a+steps+1
                face=(a,b,b+1,a+1)
                faces.append(face)
        obj=make_mesh(f"Lid_{'Upper' if upper else 'Lower'}_{suffix}",vertices,faces,clay,"eyes")
        record(obj,"lid",data)


def lid_vertex(info,p,blink):
    side=info["side"]
    c=eye_center(side,p)
    radius=EYE_R*(1+.15*p.get("eyeSize",0))
    t=info["theta"]
    r=info["radial"]
    direction=1 if info["upper"] else -1
    dx=APERTURE_X*(1+.15*p.get("eyeSize",0))*math.cos(t)
    dy=direction*APERTURE_Y*(1+.15*p.get("eyeSize",0))*max(0,math.sin(t))**(2 if REFINEMENT_ROUND >= 1 else 1.35)*(1-blink)
    if not info["upper"]:
        dy *= .84 if REFINEMENT_ROUND >= 6 else (.72 if REFINEMENT_ROUND >= 1 else .82)
    if REFINEMENT_ROUND >= 1:
        # Both lids meet along a relaxed curved closure line, not a horizontal
        # strip across the middle of the sphere.
        dy -= .013*math.sin(t)**2*blink
    # Slight overlap at full closure prevents a visible crack between the lids.
    dy += (-direction*.0015*blink*math.sin(t))
    angle=side*math.radians((4 if REFINEMENT_ROUND >= 1 else 0)+11*p.get("eyeTilt",0))
    dx,dy=dx*math.cos(angle)-dy*math.sin(angle),dx*math.sin(angle)+dy*math.cos(angle)
    inner=Vector((c.x+dx,c.y+dy,c.z+math.sqrt(max(.0001,radius*radius-dx*dx-dy*dy))+.006))
    if REFINEMENT_ROUND >= 1:
        # Canthi are skin junctions in front of the globe, not the deep side of
        # the sphere. Keep the two ends on the native facial plane and let the
        # thin central margins wrap the globe; this removes the medial funnel.
        neutral_x=side*EYE_X+APERTURE_X*math.cos(t)
        corner=skin_deform((neutral_x,EYE_Y,surface_z(neutral_x,EYE_Y)),p)
        lift=max(0,corner.z+.002-inner.z)*abs(math.cos(t))**10
        if REFINEMENT_ROUND>=8:
            lift*=.4
        inner.z += lift
    outer=skin_deform(info["outer"],p)
    # Keep a spherical collar near the opening; blend out to the actual skull.
    x=inner.x*(1-r)+outer.x*r
    y=inner.y*(1-r)+outer.y*r
    dx2,dy2=x-c.x,y-c.y
    globe_front=c.z+math.sqrt(max(0,radius*radius-dx2*dx2-dy2*dy2))+.008
    if REFINEMENT_ROUND >= 1:
        # Cubic Hermite matches the sphere tangent at the wet edge and the
        # native skull tangent at the outer loop. A smooth safety projection
        # replaces the former hard max/r<.9 discontinuity.
        ddx,ddy=outer.x-inner.x,outer.y-inner.y
        denominator=math.sqrt(max(.001,radius*radius-dx*dx-dy*dy))
        inner_slope=-(dx*ddx+dy*ddy)/denominator
        normal=info['outerNormal']
        outer_slope=-(normal.x*ddx+normal.y*ddy)/(normal.z if abs(normal.z)>.15 else (.15 if normal.z>=0 else -.15))
        outer_slope=max(-.6,min(.6,outer_slope))
        inner_slope=max(-.4,min(.4,inner_slope))
        z=(2*r**3-3*r*r+1)*inner.z+(r**3-2*r*r+r)*inner_slope+(-2*r**3+3*r*r)*outer.z+(r**3-r*r)*outer_slope
        if dx2*dx2+dy2*dy2<radius*radius and r<1:
            epsilon=.0015*(1-r)**2
            difference=globe_front-z
            z += .5*(difference+math.sqrt(difference*difference+epsilon*epsilon))
    else:
        z=inner.z*(1-r)+outer.z*r
        if dx2*dx2+dy2*dy2<radius*radius and r<.9:
            z=max(z,globe_front)
    return Vector((x,y,z))


def wet_lid_vertex(info,p,blink):
    inner_info={**info,'radial':0}
    inner=lid_vertex(inner_info,p,blink)
    if info['wet_layer']==-1:
        center=eye_center(info['side'],p)
        radius=EYE_R*(1+.15*p.get('eyeSize',0))
        dx,dy=inner.x-center.x,inner.y-center.y
        back=center.z+math.sqrt(max(.0001,radius*radius-dx*dx-dy*dy))+.001
        return Vector((inner.x,inner.y,min(inner.z-.003,back)))
    if info['wet_layer']==1:
        outer=lid_vertex({**info,'radial':.12},p,blink)
        delta=outer-inner
        if delta.length>.00001:
            inner+=delta.normalized()*.0022*(1+.15*p.get('eyeSize',0))
    inner.z+=.0007
    return inner


if REFINEMENT_ROUND>=8:
    for lid,kind,lid_data in list(objects):
        if kind!='lid':
            continue
        columns=len(lid_data)//13
        samples=lid_data[:columns]
        data=[{**info,'wet_layer':layer}for layer in (-1,0,1)for info in samples]
        vertices=[wet_lid_vertex(info,{},0)for info in data]
        faces=[]
        for row in range(2):
            for j in range(columns-1):
                a=row*columns+j;b=a+columns
                faces.append((a,b,b+1,a+1))
        obj=make_mesh(lid.name.replace('Lid_','Lid_WetMargin_'),vertices,faces,wet_mat,'eyes')
        record(obj,'wet_lid',data)


def position(kind,base,data,index,p,blink=0):
    if kind=='wet_lid':
        return wet_lid_vertex(data[index],p,blink)
    if kind=="lid":
        return lid_vertex(data[index],p,blink)
    if kind=='caruncle' and REFINEMENT_ROUND>=8:
        local=(base-Vector(data['origin']))*.65*(1+.15*p.get('eyeSize',0))
        angle=data['side']*math.radians(11*p.get('eyeTilt',0))
        local=Vector((local.x*math.cos(angle)-local.y*math.sin(angle),local.x*math.sin(angle)+local.y*math.cos(angle),local.z))
        return lid_vertex(data['lid_corner'],p,blink)+local+Vector((data['side']*.001,0,.001))
    if kind in ("eyeball","iris","pupil","cornea","caruncle"):
        side=data["side"]
        center=Vector((side*EYE_X,EYE_Y,EYE_Z))
        local=(base-center)*(1+.15*p.get("eyeSize",0))
        if kind=='caruncle':
            angle=side*math.radians(11)*p.get('eyeTilt',0)
            local=Vector((local.x*math.cos(angle)-local.y*math.sin(angle),local.x*math.sin(angle)+local.y*math.cos(angle),local.z))
        return local+eye_center(side,p)
    return skin_deform(base,p)


CONTROLS=["headWidth","headDepth","cheeks","jaw","muzzle","muzzleWidth","noseBridge","eyeSize","eyeSpacing","eyeTilt","earSize","earTilt"]
TARGETS=[("Head_round",{"headRound":1}),("Head_wedge",{"headWedge":1})]
TARGETS += [(f"Shape_{key}_{'low' if sign<0 else 'high'}",{key:sign}) for key in CONTROLS for sign in (-1,1)]
COMBOS=[]
if REFINEMENT_ROUND >= 2:
    COMBOS=[(f"Combo_Shape_earSize_{'low' if a<0 else 'high'}__Shape_earTilt_{'low' if b<0 else 'high'}",{'earSize':a,'earTilt':b})for a in (-1,1)for b in (-1,1)]
    COMBOS.append(('Combo_Shape_headWidth_low__Shape_cheeks_low',{'headWidth':-1,'cheeks':-1}))

if REFINEMENT_ROUND >= 3:
    # The Boolean nasal passages leave a few very small rim polygons. Resolve
    # their triangulation explicitly and retain a crisp shading normal only on
    # those tiny creases, instead of averaging a cavity wall across the rim.
    bm=bmesh.new()
    bm.from_mesh(nose.data)
    bmesh.ops.triangulate(bm,faces=[face for face in bm.faces if len(face.verts)>3],quad_method='BEAUTY',ngon_method='BEAUTY')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(nose.data)
    bm.free()
    nose.data.update()
    for face in nose.data.polygons:
        average=sum((nose.data.vertices[index].normal for index in face.vertices),Vector()).normalized()
        if face.normal.dot(average)<.2:
            face.use_smooth=False

for obj,kind,data in objects:
    base=[authored(v.co) for v in obj.data.vertices]
    neutral=[position(kind,co,data,i,{}) for i,co in enumerate(base)]
    closed=[position(kind,co,data,i,{},1) for i,co in enumerate(base)]
    for v,co in zip(obj.data.vertices,neutral):
        v.co=blender(co)
    obj.shape_key_add(name="Basis")
    for name,p in TARGETS:
        key=obj.shape_key_add(name=name)
        for i,co in enumerate(base):
            key.data[i].co=blender(position(kind,co,data,i,p))
    for name,p in COMBOS:
        key=obj.shape_key_add(name=name)
        for i,co in enumerate(base):
            delta=position(kind,co,data,i,p)-neutral[i]
            for control,value in p.items():
                delta -= position(kind,co,data,i,{control:value})-neutral[i]
            key.data[i].co=blender(neutral[i]+delta)
    key=obj.shape_key_add(name="Blink")
    for i,co in enumerate(closed):
        key.data[i].co=blender(co)
    for name,p in TARGETS:
        key=obj.shape_key_add(name=f"Blink_{name}")
        for i,co in enumerate(base):
            delta=(position(kind,co,data,i,p,1)-position(kind,co,data,i,p))-(closed[i]-neutral[i])
            key.data[i].co=blender(neutral[i]+delta)
    for name,p in COMBOS:
        key=obj.shape_key_add(name=f'Blink_{name}')
        for i,co in enumerate(base):
            neutral_diff=closed[i]-neutral[i]
            delta=(position(kind,co,data,i,p,1)-position(kind,co,data,i,p))-neutral_diff
            for control,value in p.items():
                single={control:value}
                delta -= (position(kind,co,data,i,single,1)-position(kind,co,data,i,single))-neutral_diff
            key.data[i].co=blender(neutral[i]+delta)
    obj["templateId"]="structural-cat-v2"

# Match only the shared boundary, keeping interior lid normals faithful to the
# actual geometry. Blending the skull normal across most of a lid hid folds.
skin.data.update()
skin_normals={tuple(round(float(c),5)for c in v.co):v.normal.copy() for v in skin.data.vertices}
for obj,kind,data in objects:
    if kind!='lid':
        continue
    obj.data.update()
    normals=[]
    for vertex,info in zip(obj.data.vertices,data):
        normal=vertex.normal.copy()
        outer=blender(skin_deform(info['outer'],{}))
        target=skin_normals.get(tuple(round(float(c),5)for c in outer))
        if target is not None:
            t=smooth01(.93 if REFINEMENT_ROUND >= 1 else .35,1,info['radial'])
            normal=normal.lerp(target,t).normalized()
        normals.append(normal)
    if REFINEMENT_ROUND == 0:
        obj.data.normals_split_custom_set_from_vertices(normals)

# Drop imported image/material leftovers, retaining authored optical textures.
used_images={node.image for obj,_,_ in objects for material_data in obj.data.materials if material_data and material_data.use_nodes for node in material_data.node_tree.nodes if node.type=='TEX_IMAGE' and node.image}
for image in list(bpy.data.images):
    if image.name not in ("Render Result","Viewer Node") and image not in used_images:
        bpy.data.images.remove(image)
for image in used_images:
    if not image.packed_file:
        image.pack()
for material_data in list(bpy.data.materials):
    if material_data.users==0:
        bpy.data.materials.remove(material_data)

def native_coordinate_hash(obj):
    """Hash source mesh and every native key before/after texture authoring.

    Compare within a single build: independent Blender Boolean/primitive builds
    may differ at the last float32 bit even when the same script is used.
    """
    digest=hashlib.sha256()
    for name,points in [('mesh',obj.data.vertices)]+[(key.name,key.data)for key in obj.data.shape_keys.key_blocks]:
        coordinates=array('f',[0.0])*(len(points)*3)
        points.foreach_get('co',coordinates)
        digest.update(name.encode('utf8'))
        digest.update(coordinates.tobytes())
    return digest.hexdigest()

coat_report=None
coat_geometry_preservation=None
if REFINEMENT_ROUND >= 4:
    authored_objects=[obj for obj,_,_ in objects]
    native_before={obj.name:native_coordinate_hash(obj)for obj in authored_objects}
    # This stage consumes only the licensed donor's clean fur. Its old painted
    # eye/nose/lip pictures and fake-eye normal map are explicitly excluded by
    # the projection helper; all current eyes and facial anatomy stay physical.
    coat_report=runpy.run_path(str(ROOT/'scripts/creator-coat.py'))['apply_creator_coat'](
        objects,texture_size=2048,hair_count=12000 if REFINEMENT_ROUND >= 7 else (2400 if REFINEMENT_ROUND >= 6 else 1600),whisker_count=7,output_dir=OUT,refinement_round=REFINEMENT_ROUND)
    native_after={obj.name:native_coordinate_hash(obj)for obj in authored_objects}
    changed=[name for name in native_before if native_before[name]!=native_after.get(name)]
    if changed:
        raise RuntimeError('Coat authoring changed native mesh/key coordinates: '+', '.join(changed))
    coat_geometry_preservation={'checkedMeshes':len(authored_objects),'allOriginalCoordinatesUnchanged':True,'sha256':native_before,'method':'Exact float32 coordinate SHA before/after coat authoring within this build; includes mesh and every native shape key'}
    for obj,kind,_ in objects:
        if kind=='hair':
            obj.name='Fur_ShortCoat'
    for image in bpy.data.images:
        if image.name not in ('Render Result','Viewer Node') and image.users>0 and not image.packed_file:
            image.pack()

bpy.ops.object.select_all(action="DESELECT")
for obj,_,_ in objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active=skin
bpy.ops.export_scene.gltf(filepath=str(OUT/"structural-cat.glb"),export_format="GLB",use_selection=True,export_yup=True,export_animations=False,export_extras=True,export_morph=True,export_morph_normal=True)

# Retain the actual native source with editable shape keys and a review camera.
def aim(obj,target):
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()

scene=bpy.context.scene
bpy.ops.object.camera_add(location=(0,-5.4,.18))
camera=bpy.context.object
aim(camera,(0,0,0))
camera.data.type='ORTHO'
camera.data.ortho_scale=2.85
scene.camera=camera
for loc,power,size in [((-3,-4,4),600,4),((3,-2,1),250,3),((0,3,2),400,3)]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    light=bpy.context.object
    light.data.energy=power
    light.data.shape='DISK'
    light.data.size=size
    aim(light,(0,0,0))
if scene.world is None:
    scene.world=bpy.data.worlds.new('Sculpt review world')
scene.world.color=(.25,.25,.25)
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.render.resolution_x=800
scene.render.resolution_y=800
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX'
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"structural-cat.blend"))
backup=SOURCE/'structural-cat.blend1'
if backup.exists():
    backup.unlink()
scene.render.filepath=str(ARTIFACTS/"natural-front.png")
bpy.ops.render.render(write_still=True)

report={"templateId":"structural-cat-v2","source":"Grab3D CC0 tabby; extracted, symmetrized and rebuilt skull; original materials removed","license":"CC0-1.0","blender":bpy.app.version_string,"units":"Y-up, +Z forward, eye plane origin","targets":[name for name,_ in TARGETS],"blink":"Blink plus Blink_${target} at blink*appearanceWeight","eyeCenters":[[-EYE_X,EYE_Y,EYE_Z],[EYE_X,EYE_Y,EYE_Z]],"eyeRadius":EYE_R,"nose":[0,-.43,.24],"earCenters":[[-.66,.7,-.35],[.66,.7,-.35]],"bounds":{"min":[-1.35,-1.1,-1.6],"max":[1.35,1.3,.7]},"meshes":[{"name":o.name,"part":o.get('creatorPart'),"vertices":len(o.data.vertices),"faces":len(o.data.polygons),"shapeKeys":len(o.data.shape_keys.key_blocks)-1}for o,_,_ in objects],"limitations":["Grey structural sculpt, not finished fur/photoreal asset","Extracted/remeshed source skull; not hand-retopologized quad animation mesh"]}
report['refinementRound']=REFINEMENT_ROUND
report['correctives']=[name for name,_ in COMBOS]
report['opticalEyes']=REFINEMENT_ROUND>=3
if REFINEMENT_ROUND>=8:
    report['eyeRefinement']='Light-absorbing pupil; pointed moderate slit; forward curved iris with radial relief; pigmented wet margin and inner wall follow native eyelid/Blink geometry'
report['irisTexture']='iris-radial.png' if REFINEMENT_ROUND>=3 else None
report['coat']=coat_report
report['coatGeometryPreservation']=coat_geometry_preservation
report['addedCoatMeshes']=[o.name for o,kind,_ in objects if kind in ('hair','lid_hair','whisker')]
report['addedCoatMeshCount']=len(report['addedCoatMeshes'])
if REFINEMENT_ROUND>=6:
    report['orbitalRefinement']={
        'outerVerticalRadius':OUTER_Y,
        'apertureVerticalRadius':APERTURE_Y,
        'lowerLidApertureFactor':.84,
        'neutralLowerLidMidlineWidth':OUTER_Y-APERTURE_Y*.84,
        'previousLowerLidMidlineWidth':.155-.098*.72,
        'method':'Narrowed physical lid annulus; continuous directional fur albedo and native lid-bound short fur follow appearance and Blink targets; independent globe unchanged',
    }
report['materialImages']=[{'name':image.name,'width':image.size[0],'height':image.size[1],'packed':bool(image.packed_file)}for image in bpy.data.images if image.name not in ('Render Result','Viewer Node') and image.users>0]
if REFINEMENT_ROUND>=4:
    report['limitations']=['Refined structural cat head with transferred licensed fur, surface-bound short coat and whiskers; not a finished photoreal/game-production asset','Extracted/remeshed source skull; not hand-retopologized animation topology','Sparse short coat approximates fur detail; physical-device performance and all parameter combinations require further validation']
if REFINEMENT_ROUND>=5:
    report['source']='Grab3D CC0 tabby; extracted, symmetrized and rebuilt skull; original material assignments and fake-eye surfaces removed; authored physical eyes, lids, nasal anatomy and native morphs; clean licensed fur colour transferred to new UV textures'
    report['nasalRefinement']='Rounded paired upper alae, shallow central notch, lateral nasal volume and beveled physical nostril rims; not a painted triangle'
(OUT/"manifest.json").write_text(json.dumps(report,indent=2),encoding='utf8')
(OUT/"LICENSE.txt").write_text((ROOT/"public/models/review/LICENSE.txt").read_text()+"\nStructural sculpt derivative: source skull extracted and symmetrized; original baked eye surfaces and textures removed; new physical eye and eyelid meshes; native shape keys authored by project.\n",encoding='utf8')
print(json.dumps(report))
