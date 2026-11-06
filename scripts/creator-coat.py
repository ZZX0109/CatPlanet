"""Transfer licensed source fur onto an authored structural cat without fake eyes.

Called by build-structural-cat.py AFTER source-image cleanup, BEFORE export.
No network calls and no source file edits. The temporary projection donor keeps
the original UVs, while a second safe UV map replaces the baked eye pictures.
"""
import bisect
import importlib.util
import json
import math
import random
import time
from array import array
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform


def _smooth(low, high, value):
    t = min(1.0, max(0.0, (value-low)/(high-low)))
    return t*t*(3-2*t)


def _authored(p):
    return Vector((p[0], p[2], -p[1]))


def _blender(p):
    return Vector((p[0], -p[2], p[1]))


def _eye_exclusion_mask(p):
    if p.z < -.60:
        return 0.0
    distance = min(((p.x-side*.328)/.34)**2 + ((p.y-.006)/.255)**2 for side in (-1, 1))
    preserve_m=(1-_smooth(.055,.15,abs(p.x)))*_smooth(.14,.34,p.y)
    return (1-_smooth(1.0, 2.6, distance))*_smooth(-.60, -.30, p.z)*(1-preserve_m)


def _eye_mask(p):
    # The donor pool must reject the entire old eye/brow, but actual albedo
    # repair is restricted to the old eye opening. A donor-sized paint mask
    # erases the eyebrow stripes and joins into an unnatural continuous mask.
    if p.z < -.60:
        return 0.0
    distance = min(((p.x-side*.328)/.265)**2 + ((p.y-.006)/.17)**2 for side in (-1, 1))
    preserve_m=(1-_smooth(.055,.15,abs(p.x)))*_smooth(.10,.25,p.y)
    return (1-_smooth(.55,1.5,distance))*_smooth(-.60,-.30,p.z)*(1-preserve_m)


def _nose_mask(p):
    # The donor nose was offset to the left of the reconstructed symmetric nose.
    # Remove its pink/black picture so only the new anatomical nose is visible.
    distance = ((abs(p.x)-.059)/.23)**2 + ((p.y+.418)/.17)**2
    return (1-_smooth(.55,1.30,distance))*_smooth(.0,.16,p.z)


def _mouth_mask(p):
    # Only a narrow band around the donor's W-shaped lip and philtrum. The final
    # replacement strength also depends on pixel darkness, preserving white fur.
    x = abs(p.x)-.035
    lip = 0.0
    if abs(x)<.23:
        curve=-.580-.030*math.sin(math.pi*min(1,abs(x)/.18))
        lip=(1-_smooth(.018,.040,abs(p.y-curve)))*(1-_smooth(.19,.23,abs(x)))
    philtrum=(1-_smooth(.014,.040,abs(x)))*_smooth(-.66,-.62,p.y)*(1-_smooth(-.50,-.46,p.y))
    return max(lip,philtrum)*_smooth(.0,.12,p.z)


def _feature_mask(p):
    return max(_eye_exclusion_mask(p),_nose_mask(p),_mouth_mask(p))


def _projection_donor(root, frame=None):
    before_objects = set(bpy.data.objects)
    before_images = set(bpy.data.images)
    before_materials = set(bpy.data.materials)
    bpy.ops.import_scene.gltf(filepath=str(root/'assets/source/grab-tabby-cat/cat.glb'))
    imported = [o for o in bpy.data.objects if o not in before_objects]
    source = next(o for o in imported if o.type == 'MESH')
    source.name = '_CC0_COAT_PROJECTION_ONLY'
    world = source.matrix_world.copy()
    positions = [_authored(world@v.co) for v in source.data.vertices]
    minimum = Vector(tuple(min(p[i] for p in positions) for i in range(3)))
    maximum = Vector(tuple(max(p[i] for p in positions) for i in range(3)))
    normalization = 1.5/(maximum.y-minimum.y)
    center = Vector(((minimum.x+maximum.x)/2, minimum.y, (minimum.z+maximum.z)/2))
    origin = Vector((frame or {}).get('origin', (-.278, 1.071, .557)))
    lateral = Vector((frame or {}).get('lateral', (.956, 0, -.293))).normalized()
    forward = Vector((frame or {}).get('forward', (.293, 0, .956))).normalized()
    scale = (frame or {}).get('scale', 4.4)
    for vertex, original in zip(source.data.vertices, positions):
        relative = (original-center)*normalization-origin
        vertex.co = _blender(Vector((relative.dot(lateral), relative.y, relative.dot(forward)))*scale)
    source.matrix_world.identity()
    source.parent = None
    bm = bmesh.new()
    bm.from_mesh(source.data)
    remove = []
    for vertex in bm.verts:
        p = _authored(vertex.co)
        if p.y < -1.03 or p.y > 1.35 or p.z < -1.8 or abs(p.x) > 1.45:
            remove.append(vertex)
    bmesh.ops.delete(bm, geom=remove, context='VERTS')
    # The authored skull was built from the negative-X half. Match that geometry
    # exactly; projecting the unrelated asymmetric right temple can sample ear
    # backs and produce a hard rectangular patch in the new right forehead.
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=Vector(),plane_no=Vector((1,0,0)),clear_outer=True,clear_inner=False)
    bm.to_mesh(source.data)
    bm.free()
    bpy.ops.object.select_all(action='DESELECT')
    source.select_set(True)
    bpy.context.view_layer.objects.active=source
    mirror=source.modifiers.new('Match authored left-half coat projection','MIRROR')
    mirror.use_clip=True
    mirror.use_mirror_merge=True
    mirror.merge_threshold=.0001
    bpy.ops.object.modifier_apply(modifier=mirror.name)
    source.data.calc_loop_triangles()
    mesh = source.data
    original_uv = mesh.uv_layers.active
    if original_uv is None:
        raise RuntimeError('The licensed color donor has no UV coordinates')
    uv_values = [entry.uv.copy() for entry in original_uv.data]
    original_uv.name = 'OriginalSourceUV'
    triangles = list(mesh.loop_triangles)
    safe = []
    for triangle in triangles:
        if triangle.area < 1e-12:
            continue
        # Keep the complete old eye picture out of the donor pool, not just its
        # green pixels: white highlights and normal-map iris grooves are banned.
        if any(_feature_mask(_authored(mesh.vertices[i].co)) > .001 for i in triangle.vertices):
            continue
        safe.append(triangle)
    if not safe:
        raise RuntimeError('No safe fur region remains for eye replacement')
    bvh = BVHTree.FromPolygons([v.co.copy() for v in mesh.vertices], [tuple(t.vertices) for t in safe], all_triangles=True)
    mesh.uv_layers.new(name='SafeFurUV')
    mesh.color_attributes.new(name='ReplaceBakedEyes', type='FLOAT_COLOR', domain='CORNER')
    replacement = {}
    mask_values = {}
    for vertex in mesh.vertices:
        authored_point = _authored(vertex.co)
        weight = _feature_mask(authored_point)
        mask_values[vertex.index] = weight
        if weight <= .0001:
            continue
        # Query a translated fur patch, not the closest exclusion boundary.
        # Clamping a whole eye picture onto its edge collapses the UV derivative
        # and creates stretched zebra-like bands on the replacement eyelids.
        sample = _authored(vertex.co)
        if _mouth_mask(authored_point)>max(_nose_mask(authored_point),_eye_mask(authored_point)):
            sample.x += .16 if sample.x >= 0 else -.16
            sample.y -= .10
        elif _nose_mask(authored_point) > _eye_mask(authored_point):
            sample.x += .17 if sample.x >= 0 else -.17
            sample.y = -.60+(sample.y+.418)*.5
        else:
            sample.y += .31 if sample.y >= .006 else -.31
        closest, _, face_index, _ = bvh.find_nearest(_blender(sample))
        triangle = safe[face_index]
        a,b,c = [mesh.vertices[i].co for i in triangle.vertices]
        ua,ub,uc = [Vector((*uv_values[i], 0)) for i in triangle.loops]
        replacement[vertex.index] = barycentric_transform(closest, a,b,c,ua,ub,uc).xy
    transferred_uv, transferred_mask = array('f'), array('f')
    for loop in mesh.loops:
        transferred_uv.extend(replacement.get(loop.vertex_index, uv_values[loop.index]))
        transferred_mask.extend((0,0,0,mask_values[loop.vertex_index]))
    # Adding a custom-data layer can invalidate earlier RNA layer handles.
    safe_uv = mesh.uv_layers['SafeFurUV']
    eye_mask = mesh.color_attributes['ReplaceBakedEyes']
    safe_uv.uv.foreach_set('vector', transferred_uv)
    eye_mask.data.foreach_set('color', transferred_mask)
    mesh.uv_layers.active = mesh.uv_layers['OriginalSourceUV']
    base_image = bpy.data.images.load(str(root/'assets/source/grab-tabby-cat/inspection/base-color.jpg'), check_existing=True)
    base_image.colorspace_settings.name = 'sRGB'
    # Safe projections may land on different UV islands. Interpolating their UV
    # coordinates would cross unrelated atlas regions. Sample color first, then
    # interpolate those colors on the dense donor surface instead.
    # A slice on Image.pixels reacquires the large image buffer every call in
    # Blender 4.5. Copy it once; otherwise a few thousand safe samples take minutes.
    pixels = array('f',[0.0])*len(base_image.pixels)
    base_image.pixels.foreach_get(pixels)
    image_width, image_height = base_image.size
    def sampled_srgb(uv):
        px = min(image_width-1,max(0,int(uv.x*(image_width-1))))
        py = min(image_height-1,max(0,int(uv.y*(image_height-1))))
        return pixels[(py*image_width+px)*4:(py*image_width+px)*4+4]
    def safe_color(uv):
        rgba = sampled_srgb(uv)
        def linear(channel):
            return channel/12.92 if channel<=.04045 else ((channel+.055)/1.055)**2.4
        return (linear(rgba[0]),linear(rgba[1]),linear(rgba[2]),1)
    clean_colors = {index:safe_color(uv) for index,uv in replacement.items()}
    clean_attribute = mesh.color_attributes.new(name='CleanEyeFur',type='FLOAT_COLOR',domain='CORNER')
    flat_colors = array('f')
    for loop in mesh.loops:
        flat_colors.extend(clean_colors.get(loop.vertex_index,(0,0,0,1)))
    clean_attribute.data.foreach_set('color',flat_colors)
    orbital_mask=mesh.color_attributes.new(name='CleanOrbitalAlbedo',type='FLOAT_COLOR',domain='CORNER')
    orbital_mask.data.foreach_set('color',array('f',(value for loop in mesh.loops for value in (0,0,0,_eye_mask(_authored(mesh.vertices[loop.vertex_index].co))))))
    # Lips are dark thin marks in the old atlas. Do not flatten the whole white
    # muzzle patch: outside these marks its original high-frequency fur survives.
    transferred_mask=array('f')
    mouth_vertices=set()
    for loop in mesh.loops:
        point=_authored(mesh.vertices[loop.vertex_index].co)
        base_weight=_nose_mask(point)
        mouth_weight=_mouth_mask(point)
        if mouth_weight>0:
            darkness=1-_smooth(.42,.64,max(sampled_srgb(uv_values[loop.index])[:3]))
            mouth_weight*=darkness
            if mouth_weight>.05:
                mouth_vertices.add(loop.vertex_index)
        transferred_mask.extend((0,0,0,max(base_weight,mouth_weight)))
    mesh.color_attributes['ReplaceBakedEyes'].data.foreach_set('color',transferred_mask)
    emission = bpy.data.materials.new('Projection donor: eyes replaced by adjacent fur')
    emission.use_nodes = True
    nodes, links = emission.node_tree.nodes, emission.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeEmission')
    mixed = nodes.new('ShaderNodeMixRGB')
    mixed.blend_type = 'MIX'
    attribute = nodes.new('ShaderNodeAttribute')
    attribute.attribute_name = 'ReplaceBakedEyes'
    original_image, safe_image = nodes.new('ShaderNodeTexImage'), nodes.new('ShaderNodeTexImage')
    original_image.image = safe_image.image = base_image
    original_coordinates, safe_coordinates = nodes.new('ShaderNodeUVMap'), nodes.new('ShaderNodeUVMap')
    original_coordinates.uv_map, safe_coordinates.uv_map = 'OriginalSourceUV', 'SafeFurUV'
    links.new(original_coordinates.outputs['UV'], original_image.inputs['Vector'])
    links.new(safe_coordinates.outputs['UV'], safe_image.inputs['Vector'])
    links.new(attribute.outputs['Alpha'], mixed.inputs[0])
    links.new(original_image.outputs['Color'], mixed.inputs[1])
    clean_sample = nodes.new('ShaderNodeAttribute')
    clean_sample.attribute_name = 'CleanEyeFur'
    links.new(clean_sample.outputs['Color'], mixed.inputs[2])
    # Old eyebrow clumps are structural shading baked into the donor photo.
    # Replacing them with interpolated samples merely creates paper-like shards.
    # Author continuous low-contrast short fur in the protected orbital region,
    # retaining the source M marking through the centerline mask above.
    geometry=nodes.new('ShaderNodeNewGeometry')
    separate=nodes.new('ShaderNodeSeparateXYZ')
    links.new(geometry.outputs['Position'],separate.inputs[0])
    gradient=nodes.new('ShaderNodeMapRange')
    gradient.inputs['From Min'].default_value=-.25
    gradient.inputs['From Max'].default_value=.06
    gradient.inputs['To Min'].default_value=0
    gradient.inputs['To Max'].default_value=1
    gradient.clamp=True
    links.new(separate.outputs['Z'],gradient.inputs['Value'])
    tone=nodes.new('ShaderNodeMixRGB')
    tone.inputs[1].default_value=(.38,.32,.24,1)
    tone.inputs[2].default_value=(.18,.13,.08,1)
    links.new(gradient.outputs[0],tone.inputs[0])
    fine_scale=nodes.new('ShaderNodeVectorMath')
    fine_scale.operation='MULTIPLY'
    fine_scale.inputs[1].default_value=(360,100,65)
    links.new(geometry.outputs['Position'],fine_scale.inputs[0])
    fine_noise=nodes.new('ShaderNodeTexNoise')
    fine_noise.inputs['Scale'].default_value=1
    fine_noise.inputs['Detail'].default_value=2
    links.new(fine_scale.outputs[0],fine_noise.inputs['Vector'])
    amplitude=nodes.new('ShaderNodeMath')
    amplitude.operation='MULTIPLY_ADD'
    amplitude.inputs[1].default_value=.50
    amplitude.inputs[2].default_value=.75
    links.new(fine_noise.outputs['Fac'],amplitude.inputs[0])
    fine_color=nodes.new('ShaderNodeMixRGB')
    fine_color.blend_type='MULTIPLY'
    fine_color.inputs[0].default_value=1
    links.new(tone.outputs[0],fine_color.inputs[1])
    links.new(amplitude.outputs[0],fine_color.inputs[2])
    protected=nodes.new('ShaderNodeAttribute')
    protected.attribute_name='CleanOrbitalAlbedo'
    eye_mix=nodes.new('ShaderNodeMixRGB')
    links.new(protected.outputs['Alpha'],eye_mix.inputs[0])
    links.new(original_image.outputs['Color'],eye_mix.inputs[1])
    links.new(fine_color.outputs[0],eye_mix.inputs[2])
    links.new(eye_mix.outputs[0],mixed.inputs[1])
    links.new(mixed.outputs['Color'], shader.inputs['Color'])
    links.new(shader.outputs[0], output.inputs['Surface'])
    source.data.materials.clear()
    source.data.materials.append(emission)
    for polygon in mesh.polygons:
        polygon.material_index = 0
    return source, imported, before_images, before_materials, {'donor_triangles':len(triangles), 'safe_donor_triangles':len(safe), 'baked_feature_vertices_replaced':len(replacement),'dark_mouth_line_vertices_replaced':len(mouth_vertices)}


def _activate(obj):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    obj.hide_set(False)
    obj.hide_render = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _render_frontal_donor(source, texture_dir, size=2048):
    """Continuous RGBA albedo reference, independent of target cage normals."""
    scene=bpy.context.scene
    saved={
        'camera':scene.camera,'x':scene.render.resolution_x,'y':scene.render.resolution_y,
        'percentage':scene.render.resolution_percentage,'transparent':scene.render.film_transparent,
        'filepath':scene.render.filepath,'format':scene.render.image_settings.file_format,
        'mode':scene.render.image_settings.color_mode,'transform':scene.view_settings.view_transform,
        'look':scene.view_settings.look,'exposure':scene.view_settings.exposure,'gamma':scene.view_settings.gamma,
    }
    visibility={obj:obj.hide_render for obj in scene.objects}
    data=bpy.data.cameras.new('Temporary coat orthographic albedo')
    camera=bpy.data.objects.new('Temporary coat orthographic albedo',data)
    scene.collection.objects.link(camera)
    camera.location=(0,-5,.15)
    camera.rotation_euler=(Vector((0,0,.15))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO'
    camera.data.ortho_scale=2.6
    path=texture_dir/'projection-donor-front.png'
    try:
        for obj in scene.objects:
            if obj.type in ('MESH','CURVE'):
                obj.hide_render=obj!=source
        source.hide_render=False
        scene.camera=camera
        scene.render.resolution_x=scene.render.resolution_y=size
        scene.render.resolution_percentage=100
        scene.render.film_transparent=True
        scene.render.image_settings.file_format='PNG'
        scene.render.image_settings.color_mode='RGBA'
        scene.view_settings.view_transform='Standard'
        scene.view_settings.look='None'
        scene.view_settings.exposure=0
        scene.view_settings.gamma=1
        scene.render.filepath=str(path)
        bpy.ops.render.render(write_still=True)
        image=bpy.data.images.load(str(path),check_existing=False)
        image.colorspace_settings.name='sRGB'
        image.alpha_mode='STRAIGHT'
    finally:
        for obj,hidden in visibility.items():
            obj.hide_render=hidden
        scene.camera=saved['camera']
        scene.render.resolution_x=saved['x'];scene.render.resolution_y=saved['y']
        scene.render.resolution_percentage=saved['percentage']
        scene.render.film_transparent=saved['transparent']
        scene.render.filepath=saved['filepath']
        scene.render.image_settings.file_format=saved['format'];scene.render.image_settings.color_mode=saved['mode']
        scene.view_settings.view_transform=saved['transform'];scene.view_settings.look=saved['look']
        scene.view_settings.exposure=saved['exposure'];scene.view_settings.gamma=saved['gamma']
        bpy.data.objects.remove(camera,do_unlink=True)
        bpy.data.cameras.remove(data)
    return image


def _correct_front_projection(obj, material, target, source_color, frontal_image, size, lid_frontal=False):
    """Bake projection onto true UVs; no camera-facing render plane is retained."""
    nodes,links=material.node_tree.nodes,material.node_tree.links
    shader=nodes.get('Principled BSDF')
    output=next(node for node in nodes if node.type=='OUTPUT_MATERIAL')
    created=[]
    def node(kind):
        item=nodes.new(kind);created.append(item);return item
    geometry=node('ShaderNodeNewGeometry')
    position=node('ShaderNodeSeparateXYZ')
    links.new(geometry.outputs['Position'],position.inputs[0])
    xmap=node('ShaderNodeMath');xmap.operation='MULTIPLY_ADD'
    xmap.inputs[1].default_value=1/2.6;xmap.inputs[2].default_value=.5
    ymap=node('ShaderNodeMath');ymap.operation='MULTIPLY_ADD'
    ymap.inputs[1].default_value=1/2.6;ymap.inputs[2].default_value=1.15/2.6
    links.new(position.outputs['X'],xmap.inputs[0]);links.new(position.outputs['Z'],ymap.inputs[0])
    vector=node('ShaderNodeCombineXYZ')
    links.new(xmap.outputs[0],vector.inputs['X']);links.new(ymap.outputs[0],vector.inputs['Y'])
    photo=node('ShaderNodeTexImage');photo.image=frontal_image;photo.extension='CLIP'
    links.new(vector.outputs[0],photo.inputs['Vector'])
    normal=node('ShaderNodeSeparateXYZ')
    links.new(geometry.outputs['Normal'],normal.inputs[0])
    facing=node('ShaderNodeMapRange')
    # Thin anatomical lid bands have steep front-visible normals. On the new
    # fur pass they must receive the repaired fur too, rather than mixing back
    # a large proportion of the old uniform donor fill along their lower rim.
    facing.inputs['From Min'].default_value=.35 if lid_frontal else .10
    facing.inputs['From Max'].default_value=-.08 if lid_frontal else -.45
    facing.inputs['To Min'].default_value=0;facing.inputs['To Max'].default_value=1
    facing.clamp=True
    links.new(normal.outputs['Y'],facing.inputs['Value'])
    depth=node('ShaderNodeMapRange')
    depth.inputs['From Min'].default_value=-1.1;depth.inputs['From Max'].default_value=-.52
    depth.inputs['To Min'].default_value=0;depth.inputs['To Max'].default_value=1;depth.clamp=True
    # Authored +Z forward is Blender -Y. Keep the back of the head on 3D color.
    depth_direction=node('ShaderNodeMath');depth_direction.operation='MULTIPLY';depth_direction.inputs[1].default_value=-1
    links.new(position.outputs['Y'],depth_direction.inputs[0]);links.new(depth_direction.outputs[0],depth.inputs['Value'])
    alpha=node('ShaderNodeMath');alpha.operation='MULTIPLY'
    links.new(photo.outputs['Alpha'],alpha.inputs[0]);links.new(facing.outputs[0],alpha.inputs[1])
    mix_weight=node('ShaderNodeMath');mix_weight.operation='MULTIPLY'
    links.new(alpha.outputs[0],mix_weight.inputs[0]);links.new(depth.outputs[0],mix_weight.inputs[1])
    mixed=node('ShaderNodeMixRGB')
    links.new(mix_weight.outputs[0],mixed.inputs[0]);links.new(target.outputs['Color'],mixed.inputs[1]);links.new(photo.outputs['Color'],mixed.inputs[2])
    emitter=node('ShaderNodeEmission')
    links.new(mixed.outputs[0],emitter.inputs['Color']);links.new(emitter.outputs[0],output.inputs['Surface'])
    final=bpy.data.images.new(f'{obj.name}_CoatColorCorrected',width=size,height=size,alpha=False)
    final.colorspace_settings.name='sRGB'
    final.file_format='PNG'
    final.filepath_raw=source_color.filepath_raw
    final_target=nodes.new('ShaderNodeTexImage');final_target.image=final
    nodes.active=final_target
    _activate(obj)
    bpy.context.scene.render.bake.use_selected_to_active=False
    bpy.ops.object.bake(type='EMIT')
    links.new(shader.outputs[0],output.inputs['Surface'])
    for item in created:
        nodes.remove(item)
    nodes.remove(target)
    if source_color.users==0:
        bpy.data.images.remove(source_color)
    return final_target,final


def _bake_surface(obj, source, size, texture_dir, frontal_image=None, lid_frontal=False, closed_lid=False):
    _activate(obj)
    blocks=obj.data.shape_keys.key_blocks if obj.data.shape_keys else []
    saved_index=obj.active_shape_key_index
    saved_only=obj.show_only_shape_key
    saved_values={key.name:key.value for key in blocks}
    try:
        obj.active_shape_key_index=0
        obj.show_only_shape_key=False
        for key in blocks:
            key.value=0
        if closed_lid and obj.data.shape_keys:
            blink=blocks.get('Blink')
            if blink:
                blink.value=1
                obj.active_shape_key_index=blocks.find('Blink')
                obj.show_only_shape_key=True
        return _bake_surface_in_pose(obj,source,size,texture_dir,frontal_image,lid_frontal)
    finally:
        if obj.mode!='OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        for key in blocks:
            key.value=saved_values[key.name]
        obj.active_shape_key_index=saved_index
        obj.show_only_shape_key=saved_only


def _bake_surface_in_pose(obj, source, size, texture_dir, frontal_image=None, lid_frontal=False):
    # For round-six lids EDIT-mode UVs are authored on the active closed-eye
    # shape. The Basis remains untouched. This avoids 4–5x stretching of short
    # hair textures when a thin open-lid strip unfolds across the closed eye.
    _activate(obj)
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name='CoatUV')
    obj.data.uv_layers.active.name = 'CoatUV'
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    # A 66-degree projection joined curved front and back patches into one
    # self-overlapping chart at the temple. Packing cannot repair overlap
    # within a chart. Smaller projection groups keep the sculpted skull's
    # front/back surfaces separate before packing the resulting UV islands.
    bpy.ops.uv.smart_project(angle_limit=math.radians(30), island_margin=.012)
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=.012, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    material = bpy.data.materials.new(f'Coat_{obj.name}')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .88
    if 'Sheen Weight' in shader.inputs:
        shader.inputs['Sheen Weight'].default_value = .2
    color = bpy.data.images.new(f'{obj.name}_CoatColor', width=size, height=size, alpha=False)
    color.colorspace_settings.name = 'sRGB'
    color.file_format = 'PNG'
    color.filepath_raw = str(texture_dir/f'{obj.name.lower()}-coat.png')
    target = nodes.new('ShaderNodeTexImage')
    target.image = color
    nodes.active = target
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.material_index = 0
    source.select_set(True)
    bpy.context.view_layer.objects.active = obj
    scene = bpy.context.scene
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = .32
    scene.render.bake.max_ray_distance = 1.05
    scene.render.bake.margin = 16
    scene.render.bake.use_clear = True
    bpy.ops.object.bake(type='EMIT')
    if frontal_image is not None:
        target,color=_correct_front_projection(obj,material,target,color,frontal_image,size,lid_frontal)
    color.save()
    color.pack()
    links.new(target.outputs['Color'], shader.inputs['Base Color'])
    # Fine, low-amplitude material detail is freshly baked. In particular, the
    # original atlas normal is never transferred because it contains fake eyes.
    coordinates = nodes.new('ShaderNodeTexCoord')
    scale = nodes.new('ShaderNodeVectorMath')
    scale.operation = 'MULTIPLY'
    scale.inputs[1].default_value = (160, 290, 85)
    noise = nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '3D'
    noise.inputs['Scale'].default_value = 1
    noise.inputs['Detail'].default_value = 2
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .18
    bump.inputs['Distance'].default_value = .008
    links.new(coordinates.outputs['Object'], scale.inputs[0])
    links.new(scale.outputs[0], noise.inputs['Vector'])
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    normal = bpy.data.images.new(f'{obj.name}_ShortFurNormal', width=size, height=size, alpha=False)
    normal.colorspace_settings.name = 'Non-Color'
    normal.file_format = 'PNG'
    normal.filepath_raw = str(texture_dir/f'{obj.name.lower()}-shortfur-normal.png')
    normal_target = nodes.new('ShaderNodeTexImage')
    normal_target.image = normal
    nodes.active = normal_target
    _activate(obj)
    scene.render.bake.use_selected_to_active = False
    bpy.ops.object.bake(type='NORMAL')
    normal.save()
    normal.pack()
    mapped = nodes.new('ShaderNodeNormalMap')
    links.new(normal_target.outputs['Color'], mapped.inputs['Color'])
    links.new(mapped.outputs['Normal'], shader.inputs['Normal'])
    for temporary in (coordinates, scale, noise, bump):
        nodes.remove(temporary)
    return material, color


def _short_coat(skin, material, count, seed=73, loft=.16, width_scale=1):
    if count <= 0:
        return None
    mesh = skin.data
    mesh.calc_loop_triangles()
    triangles = list(mesh.loop_triangles)
    eligible, cumulative = [], []
    total = 0
    for triangle in triangles:
        center = sum((mesh.vertices[i].co for i in triangle.vertices), Vector())/3
        p = _authored(center)
        if triangle.area < 1e-9 or _eye_mask(p) > .05 or (abs(p.x)<.28 and -.65<p.y<-.24 and p.z>-.25):
            continue
        weight = triangle.area*(.18 if p.y>.45 else 1)
        total += weight
        eligible.append(triangle)
        cumulative.append(total)
    if not eligible:
        return None
    rng = random.Random(seed)
    bindings = []
    base_vertices, faces, uv_values = [], [], []
    uv_layer = mesh.uv_layers.active

    def strand(coordinates, binding):
        ia,ib,ic,weights,length,width = binding[:6]
        a,b,c = [coordinates[i] for i in (ia,ib,ic)]
        normal = (b-a).cross(c-a).normalized()
        if len(binding)>6:
            # Bind tips and ribbon edges too. Re-projecting a global grooming
            # vector after deformation can flip its direction near a tangent
            # singularity; fixed barycentric frames follow the skin continuously.
            return [a*bary[0]+b*bary[1]+c*bary[2]+normal*offset for bary,offset in zip(binding[6],binding[7])]
        root = a*weights[0]+b*weights[1]+c*weights[2]
        p = _authored(root)
        flow = _blender((.45*(1 if p.x>=0 else -1), -.7+.95*_smooth(.1,.7,p.y), -.25))
        flow -= normal*flow.dot(normal)
        if flow.length_squared < 1e-10:
            flow = (b-a).normalized()
        flow.normalize()
        lateral = normal.cross(flow).normalized()
        middle = root+flow*length*.5+normal*length*loft*.625
        tip = root+flow*length+normal*length*loft
        root += normal*.0004
        return [root-lateral*width,root+lateral*width,middle-lateral*width*.55,middle+lateral*width*.55,tip]

    base = [vertex.co.copy() for vertex in mesh.vertices]
    for _ in range(count):
        triangle = eligible[bisect.bisect_left(cumulative, rng.random()*total)]
        s = math.sqrt(rng.random())
        t = rng.random()
        weights = (1-s, s*(1-t), s*t)
        length = rng.uniform(.008,.018)
        width = rng.uniform(.0006,.0010)*width_scale
        binding = (*triangle.vertices,weights,length,width)
        initial_points = strand(base,binding)
        a,b,c=[base[i]for i in triangle.vertices]
        normal=(b-a).cross(c-a).normalized()
        offsets=[(p-a).dot(normal)for p in initial_points]
        surface_barycentric=[barycentric_transform(point-normal*offset,a,b,c,Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))for point,offset in zip(initial_points,offsets)]
        binding=(*binding,surface_barycentric,offsets)
        bindings.append(binding)
        start = len(base_vertices)
        base_vertices.extend(strand(base,binding))
        faces.extend(((start,start+1,start+3,start+2),(start+2,start+3,start+4)))
        texture_uv = sum((uv_layer.data[i].uv*weight for i,weight in zip(triangle.loops,weights)), Vector((0,0)))
        uv_values.extend([texture_uv]*5)
    coat_mesh = bpy.data.meshes.new('SurfaceBoundShortCoat')
    coat_mesh.from_pydata(base_vertices,[],faces)
    coat_mesh.update()
    uv = coat_mesh.uv_layers.new(name='CoatUV')
    for loop in coat_mesh.loops:
        uv.data[loop.index].uv = uv_values[loop.vertex_index]
    hair_material = material.copy()
    hair_material.name = 'SurfaceBoundShortCoat'
    shader = hair_material.node_tree.nodes.get('Principled BSDF')
    for link in list(shader.inputs['Normal'].links):
        hair_material.node_tree.links.remove(link)
    shader.inputs['Roughness'].default_value = .96
    hair_material.use_backface_culling = False
    coat_mesh.materials.append(hair_material)
    coat = bpy.data.objects.new('ShortCoat',coat_mesh)
    bpy.context.collection.objects.link(coat)
    coat['creatorPart'] = 'head'
    coat['templateId'] = 'structural-cat-v2'
    coat['binding'] = 'Surface triangle + barycentric weights; nonzero native appearance targets only'
    coat.shape_key_add(name='Basis')
    for key in mesh.shape_keys.key_blocks:
        if key.name=='Basis' or key.name.startswith('Blink'):
            continue
        deformed = [vertex.co.copy() for vertex in key.data]
        vertices = [point for binding in bindings for point in strand(deformed,binding)]
        if max((p-base_vertices[i]).length for i,p in enumerate(vertices)) < 1e-7:
            continue
        target = coat.shape_key_add(name=key.name)
        for vertex,coordinate in zip(target.data,vertices):
            vertex.co = coordinate
    # Retain the actual correspondence in the native .blend for inspection.
    # These authoring attributes are not exported as render vertex attributes.
    for axis,name in enumerate(('SkinTriangleA','SkinTriangleB','SkinTriangleC')):
        attribute=coat_mesh.attributes.new(name=name,type='INT',domain='POINT')
        attribute.data.foreach_set('value',array('i',(binding[axis] for binding in bindings for _ in range(5))))
    attribute=coat_mesh.attributes.new(name='SkinBarycentric',type='FLOAT_VECTOR',domain='POINT')
    attribute.data.foreach_set('vector',array('f',(value for binding in bindings for bary in binding[6] for value in bary)))
    attribute=coat_mesh.attributes.new(name='SkinNormalOffset',type='FLOAT',domain='POINT')
    attribute.data.foreach_set('value',array('f',(value for binding in bindings for value in binding[7])))

    def pose(obj,weights):
        basis=[vertex.co.copy() for vertex in obj.data.shape_keys.key_blocks['Basis'].data]
        result=[p.copy() for p in basis]
        for name,weight in weights.items():
            key=obj.data.shape_keys.key_blocks.get(name)
            if key is None or weight==0:
                continue
            for i,vertex in enumerate(key.data):
                result[i]+=(vertex.co-basis[i])*weight
        return result

    audit={}
    cases={
        'natural':{},
        'round':{'Head_round':1},
        'wedge':{'Head_wedge':1},
        'maximum_head_width':{'Shape_headWidth_high':1},
        'minimum_head_width':{'Shape_headWidth_low':1},
        'round_wide_full_cheeks':{'Head_round':1,'Shape_headWidth_high':1,'Shape_cheeks_high':1},
        'wedge_narrow_cheeks':{'Head_wedge':1,'Shape_headWidth_low':1,'Shape_cheeks_low':1,'Combo_Shape_headWidth_low__Shape_cheeks_low':1},
        'large_outward_ears':{'Shape_earSize_high':1,'Shape_earTilt_high':1,'Combo_Shape_earSize_high__Shape_earTilt_high':1},
    }
    for name,weights in cases.items():
        posed_skin,posed_hair=pose(skin,weights),pose(coat,weights)
        max_root_distance=max_tip_error=max_displacement=0
        for i,binding in enumerate(bindings):
            a,b,c,barycentric,_,_=binding[:6]
            surface=sum((posed_skin[index]*weight for index,weight in zip((a,b,c),barycentric)),Vector())
            root=(posed_hair[i*5]+posed_hair[i*5+1])/2
            expected=strand(posed_skin,binding)
            max_root_distance=max(max_root_distance,(root-surface).length)
            max_tip_error=max(max_tip_error,(posed_hair[i*5+4]-expected[4]).length)
        max_displacement=max((p-base_vertices[i]).length for i,p in enumerate(posed_hair))
        audit[name]={'max_root_distance_to_bound_surface':max_root_distance,'max_tip_frame_interpolation_error':max_tip_error,'max_hair_vertex_displacement':max_displacement}
    coat['bindingAudit']=json.dumps(audit)
    return coat


def _surface_whiskers(skin, count=7):
    """Thin curved keratin tubes; whole strands follow only their skin roots.

    Each side is one efficient mesh, with a separate native binding for each
    strand. No direction is re-projected after facial deformation.
    """
    if count<=0:
        return [],{}
    mesh=skin.data
    mesh.calc_loop_triangles()
    triangles=list(mesh.loop_triangles)
    basis=[vertex.co.copy() for vertex in mesh.shape_keys.key_blocks['Basis'].data]
    bvh=BVHTree.FromPolygons(basis,[tuple(triangle.vertices)for triangle in triangles],all_triangles=True)
    material=bpy.data.materials.new('Fine ivory keratin whiskers')
    material.use_nodes=True
    shader=material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value=.52
    if 'Coat Weight' in shader.inputs:
        shader.inputs['Coat Weight'].default_value=.08
    color_node=material.node_tree.nodes.new('ShaderNodeVertexColor')
    color_node.layer_name='WhiskerTint'
    material.node_tree.links.new(color_node.outputs['Color'],shader.inputs['Base Color'])
    result=[]
    all_audits={}
    segments,sides=24,6
    for side,suffix in ((-1,'L'),(1,'R')):
        vertices,faces,tints,bindings=[],[],[],[]
        rng=random.Random(119+(side>0))
        for strand_index in range(count):
            x=side*(.18+.044*(strand_index%3)+rng.uniform(-.008,.008))
            y=-.456-.029*(strand_index//3)+rng.uniform(-.008,.008)
            hit,normal,triangle_index,_=bvh.ray_cast(_blender((x,y,2)),_blender((0,0,-1)),5)
            if hit is None:
                hit,normal,triangle_index,_=bvh.find_nearest(_blender((x,y,.2)))
            triangle=triangles[triangle_index]
            a,b,c=[basis[index]for index in triangle.vertices]
            bary=barycentric_transform(hit,a,b,c,Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))
            root=hit+normal*.0013
            authored_root=_authored(root)
            length=.66+.045*(strand_index%3)+rng.uniform(0,.075)
            fan=.16-.48*strand_index/max(1,count-1)
            dx=side*length*math.cos(fan)
            dy=length*math.sin(fan)-.035
            p0=authored_root
            p1=p0+Vector((side*length*.29,dy*.12+.025,.065+rng.uniform(-.012,.012)))
            p2=p0+Vector((dx*.73,dy*.52+.025,.125+rng.uniform(-.02,.02)))
            p3=p0+Vector((dx,dy,.07+rng.uniform(-.025,.025)))
            start=len(vertices)
            radius=rng.uniform(.00145,.00180)
            for section in range(segments+1):
                t=section/segments
                center=p0*(1-t)**3+p1*(3*(1-t)**2*t)+p2*(3*(1-t)*t*t)+p3*t**3
                tangent=(p1-p0)*(3*(1-t)**2)+(p2-p1)*(6*(1-t)*t)+(p3-p2)*(3*t*t)
                tangent.normalize()
                lateral=tangent.cross(Vector((0,1,0))).normalized()
                radial=tangent.cross(lateral).normalized()
                taper=.00016+radius*(1-t)**.9
                mix=_smooth(0,.11,t)
                tint=tuple((.16,.125,.085)[i]*(1-mix)+(.78,.73,.64)[i]*mix for i in range(3))
                for around in range(sides):
                    angle=2*math.pi*around/sides
                    coordinate=center+(lateral*math.cos(angle)+radial*math.sin(angle))*taper
                    vertices.append(_blender(coordinate))
                    tints.extend((*tint,1))
            for section in range(segments):
                for around in range(sides):
                    aa=start+section*sides+around
                    bb=start+section*sides+(around+1)%sides
                    faces.append((aa,bb,bb+sides,aa+sides))
            faces.append(tuple(start+i for i in reversed(range(sides))))
            faces.append(tuple(start+segments*sides+i for i in range(sides)))
            bindings.append({'triangle':tuple(triangle.vertices),'barycentric':tuple(bary),'start':start,'count':(segments+1)*sides,'root':tuple(root),'rootSurface':tuple(hit),'length':length,'radius':radius})
        tube=bpy.data.meshes.new(f'Whisker_{suffix}')
        tube.from_pydata(vertices,[],faces)
        tube.update()
        tube.materials.append(material)
        for polygon in tube.polygons:
            polygon.use_smooth=True
        attribute=tube.color_attributes.new(name='WhiskerTint',type='FLOAT_COLOR',domain='POINT')
        attribute.data.foreach_set('color',array('f',tints))
        obj=bpy.data.objects.new(f'Whisker_{suffix}',tube)
        bpy.context.collection.objects.link(obj)
        obj['creatorPart']='muzzle'
        obj['templateId']='structural-cat-v2'
        obj['surfaceBindings']=json.dumps(bindings)
        obj['binding']='Each curved strand translates by its barycentric skin-root delta; original curve and length preserved'
        obj.shape_key_add(name='Basis')
        root_offsets={}
        for key in mesh.shape_keys.key_blocks:
            if key.name=='Basis' or key.name.startswith('Blink'):
                continue
            deltas=[]
            for binding in bindings:
                ids,weights=binding['triangle'],binding['barycentric']
                delta=sum(((key.data[index].co-basis[index])*weight for index,weight in zip(ids,weights)),Vector())
                deltas.append(delta)
            if max(delta.length for delta in deltas)<1e-7:
                continue
            target=obj.shape_key_add(name=key.name)
            for binding,delta in zip(bindings,deltas):
                for index in range(binding['start'],binding['start']+binding['count']):
                    target.data[index].co=vertices[index]+delta
            root_offsets[key.name]=deltas
        audit={}
        cases={
            'natural':{},'round':{'Head_round':1},'wedge':{'Head_wedge':1},
            'maximum_head_width':{'Shape_headWidth_high':1},'minimum_head_width':{'Shape_headWidth_low':1},
            'round_wide_muzzle':{'Head_round':1,'Shape_headWidth_high':1,'Shape_muzzleWidth_high':1,'Shape_muzzle_high':1},
            'wedge_narrow_cheeks':{'Head_wedge':1,'Shape_headWidth_low':1,'Shape_cheeks_low':1,'Combo_Shape_headWidth_low__Shape_cheeks_low':1},
        }
        for case,weights in cases.items():
            max_binding_error=max_shape_error=max_motion=0
            for strand_index,binding in enumerate(bindings):
                source_delta=Vector()
                for name,weight in weights.items():
                    key=mesh.shape_keys.key_blocks.get(name)
                    if key is not None:
                        source_delta+=sum(((key.data[index].co-basis[index])*factor*weight for index,factor in zip(binding['triangle'],binding['barycentric'])),Vector())
                target_deltas=[Vector()for _ in range(binding['count'])]
                for name,weight in weights.items():
                    key=obj.data.shape_keys.key_blocks.get(name)
                    if key is None:
                        continue
                    for local,index in enumerate(range(binding['start'],binding['start']+binding['count'])):
                        target_deltas[local]+=(key.data[index].co-vertices[index])*weight
                max_binding_error=max(max_binding_error,max((delta-source_delta).length for delta in target_deltas))
                max_shape_error=max(max_shape_error,max((delta-target_deltas[0]).length for delta in target_deltas))
                max_motion=max(max_motion,source_delta.length)
            audit[case]={'max_skin_root_translation_error':max_binding_error,'max_curve_shape_change_after_root_translation':max_shape_error,'max_root_displacement':max_motion}
        obj['bindingAudit']=json.dumps(audit)
        all_audits[obj.name]=audit
        result.append(obj)
    return result,all_audits


def apply_creator_coat(objects, *, texture_size=2048, hair_count=1600, whisker_count=7, frame=None, output_dir=None, refinement_round=4):
    """Bake source coat and append morph-bound short fur to objects in place.

    objects is the generator's list of (bpy.Object, kind, auxiliary_data) tuples.
    Run only after source-image cleanup. No fixed vertex indices are assumed.
    """
    started = time.monotonic()
    root = Path.cwd()
    texture_dir = Path(output_dir or root/'assets/authored/creator-coat')
    texture_dir.mkdir(parents=True,exist_ok=True)
    scene = bpy.context.scene
    engine = scene.render.engine
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 1
    source, imported, original_images, original_materials, stats = _projection_donor(root,frame)
    frontal_image=_render_frontal_donor(source,texture_dir,max(2048,texture_size))
    orbital_fur=None
    if refinement_round>=6:
        spec=importlib.util.spec_from_file_location('creator_orbital_fur',root/'scripts/creator-orbital-fur.py')
        orbital_fur=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(orbital_fur)
        stats['orbital_albedo']=orbital_fur.repair_orbital_albedo(frontal_image,texture_dir/'projection-donor-front.png')
    baked = []
    skin_material = None
    for obj,kind,_ in list(objects):
        if kind not in ('skin','lid'):
            continue
        surface_size=texture_size if kind=='skin' else max(1024,texture_size//2) if orbital_fur else max(512,texture_size//4)
        material,_ = _bake_surface(obj,source,surface_size,texture_dir,frontal_image,lid_frontal=bool(orbital_fur and kind=='lid'),closed_lid=bool(orbital_fur and kind=='lid'))
        if kind=='skin':
            skin_material = material
        baked.append(obj.name)
    imported_meshes = {obj.data for obj in imported if obj.type == 'MESH'}
    for obj in imported:
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj,do_unlink=True)
    for mesh in imported_meshes:
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for material in list(bpy.data.materials):
        if material not in original_materials and material.users==0:
            bpy.data.materials.remove(material)
    for image in list(bpy.data.images):
        if image not in original_images and image.users==0:
            bpy.data.images.remove(image)
    skin = next(obj for obj,kind,_ in objects if kind=='skin')
    hair = _short_coat(skin,skin_material,hair_count,loft=.32 if refinement_round>=7 else .16,width_scale=2.5 if refinement_round>=7 else 1) if skin_material else None
    if hair is not None:
        objects.append((hair,'hair',None))
    if orbital_fur:
        lid_audits={}
        for lid,kind,_ in list(objects):
            if kind!='lid':
                continue
            lid_hair,audit=orbital_fur.build_lid_fur(lid)
            if lid_hair:
                objects.append((lid_hair,'lid_hair',None))
                lid_audits[lid_hair.name]=audit
        stats['lid_fur']=lid_audits
    whiskers,whisker_audit=_surface_whiskers(skin,whisker_count)
    objects.extend((obj,'whisker',None)for obj in whiskers)
    stats.update({'baked_objects':baked,'skin_texture_size':texture_size,'hair_strands':hair_count if hair else 0,'hair_vertices':len(hair.data.vertices)if hair else 0,'hair_binding_audit':json.loads(hair['bindingAudit'])if hair else {},'whiskers_per_side':whisker_count,'whisker_vertices':sum(len(obj.data.vertices)for obj in whiskers),'whisker_binding_audit':whisker_audit,'elapsed_seconds':round(time.monotonic()-started,2),'old_feature_pixels':'Old iris/highlight/nose pictures and dark mouth/philtrum marks replaced by adjacent fur colors before emission bake; white muzzle fur preserved by spatial+pixel-darkness mask','normal_source':'Fresh low-amplitude material detail; original fake-eye normal atlas excluded'})
    scene.render.engine = engine
    (texture_dir/'coat-report.json').write_text(json.dumps(stats,indent=2),encoding='utf8')
    print('CREATOR_COAT',json.dumps(stats))
    return stats
