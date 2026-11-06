"""Bake the downloaded Ginger cat into a portable, static glTF preview.

Run with the verified local Blender, --background --factory-startup
--disable-autoexec. The source .blend is never saved or overwritten.
"""

import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/source/ginger-cat/ginger-cat.blend"
DESTINATION = ROOT / "assets/processed/ginger-cat"
MAX_IMAGE_SIZE = 2048
MAX_GUIDES = 12000
POINTS_PER_GUIDE = 4


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def resample_curve(points, count):
    distances = [0.0]
    for a, b in zip(points, points[1:]):
        distances.append(distances[-1] + (b - a).length)
    if distances[-1] < 1e-7:
        return None
    result = []
    cursor = 0
    for i in range(count):
        distance = distances[-1] * i / (count - 1)
        while cursor < len(points) - 2 and distances[cursor + 1] < distance:
            cursor += 1
        span = distances[cursor + 1] - distances[cursor]
        result.append(points[cursor].lerp(points[cursor + 1], (distance - distances[cursor]) / max(span, 1e-12)))
    return result


def material(name, color_image, roughness, normal_image=None):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.use_backface_culling = False
    nodes = result.node_tree.nodes
    links = result.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.inputs["Metallic"].default_value = 0.0
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["IOR"].default_value = 1.45
    color = nodes.new("ShaderNodeTexImage")
    color.image = color_image
    color.interpolation = "Linear"
    links.new(color.outputs["Color"], principled.inputs["Base Color"])
    if normal_image:
        normal_texture = nodes.new("ShaderNodeTexImage")
        normal_texture.image = normal_image
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.inputs["Strength"].default_value = 0.65
        links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return result


def copy_image(name, colorspace):
    original = bpy.data.images[name]
    copied = original.copy()
    copied.name = "GingerPreview_" + name
    copied.colorspace_settings.name = colorspace
    width, height = copied.size
    ratio = min(1.0, MAX_IMAGE_SIZE / max(width, height))
    if ratio < 1:
        copied.scale(round(width * ratio), round(height * ratio))
    return copied


def mesh_object(name, mesh):
    result = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(result)
    return result


def main():
    source_hash = sha256(SOURCE)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False, use_scripts=False)
    emitter = bpy.data.objects["cat.001"]
    # The original children can number in the hundreds of thousands. Only the
    # artist's edited parent guides are evaluated and copied for this preview.
    for system in emitter.particle_systems:
        system.settings.child_type = "NONE"
        system.settings.child_percent = 0
        system.settings.rendered_child_count = 0
    for modifier in emitter.modifiers:
        if modifier.type == "SUBSURF":
            modifier.levels = 2
            modifier.render_levels = 2
    bpy.context.scene.frame_set(1)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = emitter.evaluated_get(depsgraph)
    original_world = evaluated.matrix_world.copy()
    body_mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)

    rotate = Matrix.Rotation(-math.pi / 2, 4, "Z")
    rotated_points = [rotate @ (original_world @ vertex.co) for vertex in body_mesh.vertices]
    low = Vector(tuple(min(point[i] for point in rotated_points) for i in range(3)))
    high = Vector(tuple(max(point[i] for point in rotated_points) for i in range(3)))
    scale = 1.5 / (high.z - low.z)
    translate = Matrix.Translation(Vector((-(low.x + high.x) / 2, -(low.y + high.y) / 2, -low.z)))
    normalize = Matrix.Scale(scale, 4) @ translate @ rotate
    body_mesh.transform(normalize @ original_world)
    # Legacy assets can retain obsolete mesh layers or duplicate edges. Clean
    # the baked copy before sampling its triangles, never the source mesh.
    before_cleanup = {"vertices": len(body_mesh.vertices), "polygons": len(body_mesh.polygons), "edges": len(body_mesh.edges)}
    mesh_cleanup_applied = body_mesh.validate(verbose=True, clean_customdata=True)
    body_mesh.update()
    body_mesh.calc_loop_triangles()
    body = mesh_object("Ginger_StaticBody", body_mesh)
    body.data.name = "Ginger_AuthoredBody_Subdivision2"
    color_image = copy_image("cat_color", "sRGB")
    normal_image = copy_image("hair_N", "Non-Color")
    coat_material = material("Ginger_Coat_PBR", color_image, 0.74, normal_image)
    eyes_material = material("Ginger_Eyes_PBR", color_image, 0.18)
    fur_material = material("Ginger_GroomedGuides_PBR", color_image, 0.86)
    material_assignments = [polygon.material_index for polygon in body_mesh.polygons]
    body.data.materials.clear()
    body.data.materials.append(coat_material)
    body.data.materials.append(eyes_material)
    for polygon, material_index in zip(body.data.polygons, material_assignments):
        polygon.material_index = material_index
        polygon.use_smooth = True

    triangles = list(body_mesh.loop_triangles)
    triangle_vertices = [tuple(triangle.vertices) for triangle in triangles]
    bvh = BVHTree.FromPolygons([vertex.co for vertex in body_mesh.vertices], triangle_vertices, all_triangles=True)
    uv_data = body_mesh.uv_layers.active.data
    positions, normals, uvs, faces = [], [], [], []
    system_report = []
    included_guides = 0

    for system in evaluated.particle_systems:
        copied_guides = 0
        lengths = []
        for particle in system.particles:
            if included_guides >= MAX_GUIDES:
                break
            # Evaluated hair_keys.co contains the author's groomed positions in
            # emitter space. co_local is a strand-local edit representation;
            # co_hair can expose only the viewport cache, so neither is used.
            points = [normalize @ (original_world @ key.co) for key in particle.hair_keys]
            if len(points) < 2:
                continue
            points = resample_curve(points, POINTS_PER_GUIDE)
            if not points or not all(math.isfinite(value) for point in points for value in point):
                continue
            nearest, surface_normal, triangle_index, distance = bvh.find_nearest(points[0])
            if nearest is None or distance > 0.045:
                continue
            triangle = triangles[triangle_index]
            corners = [body_mesh.vertices[index].co for index in triangle.vertices]
            texture_corners = [Vector((*uv_data[index].uv, 0.0)) for index in triangle.loops]
            root_uv = barycentric_transform(nearest, *corners, *texture_corners)
            vertex_normals = [body_mesh.vertices[index].normal for index in triangle.vertices]
            soft_normal = barycentric_transform(nearest, *corners, *vertex_normals).normalized()
            if soft_normal.length_squared < 0.1:
                soft_normal = surface_normal
            length = sum((b - a).length for a, b in zip(points, points[1:]))
            if length > 0.3 or length < 1e-5:
                continue
            # The source's radius includes emitter-space scale. Clamp only the
            # ribbon width; the curve's original length and direction survive.
            source_width = system.settings.root_radius * system.settings.radius_scale * original_world.to_scale().length / math.sqrt(3)
            half_width = max(0.00030, min(0.00085, source_width * scale))
            tangent = (points[-1] - points[0]).normalized()
            side = tangent.cross(soft_normal).normalized()
            if side.length_squared < 0.1:
                side = tangent.cross(Vector((0.0, 0.0, 1.0))).normalized()
            if side.length_squared < 0.1:
                side = Vector((1.0, 0.0, 0.0))
            second_side = tangent.cross(side).normalized()
            for ribbon_side in (side, second_side):
                start = len(positions)
                for step, point in enumerate(points):
                    taper = (1.0 - step / (len(points) - 1)) ** 0.7
                    width = max(0.000015, half_width * taper)
                    for sign in (-1.0, 1.0):
                        positions.append(tuple(point + ribbon_side * width * sign))
                        normals.append(tuple(soft_normal))
                        uvs.append((root_uv.x, root_uv.y))
                for step in range(len(points) - 1):
                    a = start + step * 2
                    faces.append((a, a + 1, a + 3, a + 2))
            copied_guides += 1
            included_guides += 1
            lengths.append(length)
        system_report.append({"sourceSystem": system.name, "availableParents": len(system.particles), "copiedGuides": copied_guides,
                              "curvePoints": POINTS_PER_GUIDE, "childrenExported": 0,
                              "lengthRangePreviewUnits": [min(lengths), max(lengths)] if lengths else None})

    objects = [body]
    if positions:
        fur_mesh = bpy.data.meshes.new("Ginger_AuthoredGuideRibbons")
        fur_mesh.from_pydata(positions, [], faces)
        fur_mesh.materials.append(fur_material)
        fur_uv = fur_mesh.uv_layers.new(name="RootCoatUV")
        for loop in fur_mesh.loops:
            fur_uv.data[loop.index].uv = uvs[loop.vertex_index]
        for polygon in fur_mesh.polygons:
            polygon.use_smooth = True
        fur_mesh.normals_split_custom_set_from_vertices(normals)
        fur_mesh.update()
        objects.append(mesh_object("Ginger_AuthoredGroom_Static", fur_mesh))

    # Normalize the combined body + authored groom, including ear tips and low
    # paw hairs, so the exported preview has an exact ground plane and height.
    points = [vertex.co for obj in objects for vertex in obj.data.vertices]
    final_low = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    final_high = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    final_scale = 1.5 / (final_high.z - final_low.z)
    final_transform = Matrix.Scale(final_scale, 4) @ Matrix.Translation(Vector((-(final_low.x + final_high.x) / 2, -(final_low.y + final_high.y) / 2, -final_low.z)))
    for obj in objects:
        obj.data.transform(final_transform)
        obj.data.update()
        assert not obj.data.validate(verbose=True), "Export mesh failed validation after preparation"
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    DESTINATION.mkdir(parents=True, exist_ok=True)
    output = DESTINATION / "preview.glb"
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", use_selection=True,
                             export_apply=True, export_yup=True, export_animations=False,
                             export_skins=False, export_morph=False, export_materials="EXPORT",
                             export_image_format="JPEG", export_image_quality=90,
                             export_normals=True, export_tangents=False, export_texcoords=True,
                             export_cameras=False, export_lights=False)
    assert output.stat().st_size < 15 * 1024 * 1024, "Static preview exceeded 15 MiB budget"
    assert sha256(SOURCE) == source_hash, "Source .blend changed unexpectedly"
    bounds = [vertex.co for obj in objects for vertex in obj.data.vertices]
    low = [min(point[i] for point in bounds) for i in range(3)]
    high = [max(point[i] for point in bounds) for i in range(3)]
    report = {"blender": bpy.app.version_string, "source": str(SOURCE), "sourceSha256": source_hash,
              "output": str(output), "outputBytes": output.stat().st_size, "outputSha256": sha256(output),
              "purpose": "Static authored-model comparison only; no animation or face-edit acceptance.",
              "license": "BlenderKit Royalty Free; retain source license notes; no user model-download feature authorized.",
              "sourceModified": False, "embeddedScriptsExecuted": False, "sourceFrame": 1,
              "sourceForwardAxis": "+X", "previewForwardAxis": "+Z", "previewUpAxis": "+Y",
              "normalization": "Uniform scaling, no anatomy edits; combined body and groom height 1.5, ground 0.",
              "dimensionsGltfXYZ": [high[0] - low[0], high[2] - low[2], high[1] - low[1]],
              "boundsGltfMin": [low[0], low[2], -high[1]], "boundsGltfMax": [high[0], high[2], -low[1]],
              "body": {"vertices": len(body_mesh.vertices), "polygons": len(body_mesh.polygons), "subdivision": 2,
                       "eyePolygons": sum(p.material_index == 1 for p in body_mesh.polygons),
                       "meshCleanupApplied": mesh_cleanup_applied, "beforeCleanup": before_cleanup},
              "groom": {"method": "Deterministic tapered crossed ribbons following original edited parent hair_keys, with emitter UV colors and soft emitter normals.",
                        "guides": included_guides, "vertices": len(positions), "quads": len(faces), "systems": system_report,
                        "randomStrands": 0, "children": 0, "maxParents": MAX_GUIDES},
              "images": [{"name": image.name, "size": list(image.size), "colorspace": image.colorspace_settings.name} for image in (color_image, normal_image)],
              "materials": [coat_material.name, eyes_material.name, fur_material.name],
              "limitations": ["Static baked pose; source IK rig is not exported.", "Parent-guide density is intentionally much lower than the source's rendered children.",
                              "Body and eye source geometry/UVs are retained; not a new face Morph or eye rig.", "No source scripts are enabled and no .blend is saved."]}
    (DESTINATION / "export-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
