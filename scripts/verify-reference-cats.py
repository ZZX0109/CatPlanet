"""Reopen v2 native cat studies and verify source integrity, never aesthetics.

Run with Blender --background --disable-autoexec --python this-file.py.
The separate review pose intentionally uses REST; animation retargeting and
visual breed correctness remain outside these mechanical checks.
"""
import hashlib
import json
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/cat-reference-study'
PIGMENT_SOCKETS = {
    'ShaderNodeBsdfHairPrincipled': 'Color',
    'ShaderNodeBsdfHair': 'Color',
    'ShaderNodeBsdfDiffuse': 'Color',
    'ShaderNodeBsdfPrincipled': 'Base Color',
}
REFERENCES = {
    'solid': ('solid/references.json', 'photos', 59),
    'ragdoll': ('ragdoll/references-50.json', 'references', 50),
    'siamese': ('siamese/references.json', 'references', 50),
}
GROOM_FIELDS = [
    'hair_length', 'hair_step', 'count', 'child_type', 'child_percent',
    'rendered_child_count', 'roughness_1', 'roughness_1_size', 'roughness_2',
    'roughness_2_size', 'roughness_2_threshold', 'roughness_endpoint',
    'roughness_end_shape', 'clump_factor', 'clump_shape', 'use_clump_curve',
    'brownian_factor', 'radius_scale', 'root_radius', 'tip_radius', 'shape',
    'use_close_tip', 'kink', 'kink_amplitude', 'kink_amplitude_clump',
    'kink_frequency', 'kink_flat', 'child_length', 'child_length_threshold',
    'child_parting_factor', 'child_radius',
]
CONTROLLED_GROOM_FIELDS = {
    'roughness_1', 'roughness_2', 'roughness_endpoint', 'kink_amplitude',
    'radius_scale', 'root_radius', 'tip_radius', 'kink', 'clump_factor',
}


def digest(value):
    encoded = json.dumps(value, separators=(',', ':'), sort_keys=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def intrinsic():
    body = bpy.data.objects['GreyTabbyCat_Body']
    mesh = body.data
    return {
        'vertices': len(mesh.vertices),
        'faces': digest([tuple(p.vertices) for p in mesh.polygons]),
        'basis': digest([tuple(v.co) for v in mesh.shape_keys.key_blocks[0].data]),
        'uv': digest([[tuple(v.uv) for v in layer.data] for layer in mesh.uv_layers]),
        'weights': digest([[(g.group, g.weight) for g in v.groups] for v in mesh.vertices]),
        'bones': digest([
            (o.name, [(b.name, b.parent.name if b.parent else None,
                       [tuple(row) for row in b.matrix_local]) for b in o.data.bones])
            for o in bpy.data.objects if o.type == 'ARMATURE'
        ]),
        'actions': digest([
            (a.name, [(f.data_path, f.array_index,
                       [(tuple(k.co), tuple(k.handle_left), tuple(k.handle_right))
                        for k in f.keyframe_points]) for f in a.fcurves])
            for a in bpy.data.actions
        ]),
        'hairRoots': {
            ps.name: digest([tuple(p.hair_keys[0].co_local) if len(p.hair_keys) else None
                             for p in ps.particles]) for ps in body.particle_systems
        },
        'hairCounts': {ps.name: len(ps.particles) for ps in body.particle_systems},
    }


def scalar(value):
    try:
        return list(value)
    except TypeError:
        return value


def hair_graphs():
    graphs = {}
    for mat in bpy.data.materials:
        if not mat.name.startswith('GreyTabbyCat_Hair_') or not mat.use_nodes:
            continue
        nodes = mat.node_tree.nodes
        closures = {}
        for node in nodes:
            if node.bl_idname not in PIGMENT_SOCKETS:
                continue
            color_name = PIGMENT_SOCKETS[node.bl_idname]
            closures[node.name] = {
                'type': node.bl_idname,
                'settings': {
                    socket.name: scalar(socket.default_value)
                    for socket in node.inputs
                    if hasattr(socket, 'default_value') and socket.name != color_name
                },
            }
        non_pigment_links = []
        random_links = []
        for link in mat.node_tree.links:
            expected = PIGMENT_SOCKETS.get(link.to_node.bl_idname)
            if expected and link.to_socket.name == expected:
                continue
            # v2 can replace the source coat texture upstream, retaining the
            # authored tonal graph, and can neutralize the tabby mask Color.
            source_image = getattr(link.from_node, 'image', None)
            if source_image and link.from_socket.name == 'Color' and any(
                    token in source_image.name for token in ['_BodyHair_BaseColor.', '_BodyHair_Mask.']):
                continue
            if link.from_node.bl_idname == 'ShaderNodeHairInfo' and link.from_socket.name == 'Random':
                random_links.append((link.from_node.name, link.from_socket.name,
                                     link.to_node.name, link.to_socket.name))
                continue
            non_pigment_links.append((link.from_node.name, link.from_socket.name,
                                      link.to_node.name, link.to_socket.name))
        graphs[mat.name] = {
            'closures': closures,
            'mixShaderNames': sorted(n.name for n in nodes if n.bl_idname == 'ShaderNodeMixShader'),
            'nativeLinks': sorted(non_pigment_links),
            'randomLinks': sorted(random_links),
        }
    return graphs


def upstream_images(socket, visited=None):
    visited = set() if visited is None else visited
    images = set()
    for link in socket.links:
        node = link.from_node
        if node.as_pointer() in visited:
            continue
        visited.add(node.as_pointer())
        if node.bl_idname == 'ShaderNodeTexImage' and node.image:
            images.add((node.image.name, link.from_socket.name))
        for parent in node.inputs:
            images.update(upstream_images(parent, visited))
    return images


def groom_settings():
    body = bpy.data.objects['GreyTabbyCat_Body']
    return {
        ps.name: {name: getattr(ps.settings, name) for name in GROOM_FIELDS
                  if hasattr(ps.settings, name)}
        for ps in body.particle_systems
    }


def compare_groom(before, after):
    changes = {}
    valid = set(before) == set(after)
    for name, original in before.items():
        current = after.get(name, {})
        system_changes = {}
        for key, old in original.items():
            new = current.get(key)
            if new == old:
                continue
            system_changes[key] = {'before': old, 'after': new}
            if 'Beard' in name or key not in CONTROLLED_GROOM_FIELDS:
                valid = False
            elif key == 'kink':
                valid = valid and new == 'NO'
            elif key == 'kink_amplitude':
                valid = valid and isinstance(new, (int, float)) and abs(new) <= abs(old) + 1e-9 and new * old >= -1e-12
            elif not isinstance(new, (int, float)) or not 0 <= new <= old + 1e-9:
                valid = False
        if system_changes:
            changes[name] = system_changes
    return bool(valid), changes


def controlled_random_ranges(native_graphs, variant):
    low, high = (.40, .60) if variant == 'ragdoll' else (.46, .54)
    verified_links = 0
    for material, graph in native_graphs.items():
        tree = bpy.data.materials[material].node_tree
        for source_name, source_socket, target_name, target_socket in graph['randomLinks']:
            if 'Beard' in material:
                if not any(l.from_node.name == source_name and l.from_socket.name == source_socket
                           and l.to_node.name == target_name and l.to_socket.name == target_socket
                           for l in tree.links):
                    return False, verified_links
                continue
            candidates = [link.from_node for link in tree.links
                          if link.to_node.name == target_name and link.to_socket.name == target_socket
                          and link.from_node.bl_idname == 'ShaderNodeMapRange']
            valid = False
            for mapping in candidates:
                origin_matches = any(link.from_node.name == source_name and link.from_socket.name == source_socket
                                     for link in mapping.inputs['Value'].links)
                values_match = all(abs(mapping.inputs[name].default_value - expected) < 1e-6
                                   for name, expected in [('From Min', 0), ('From Max', 1),
                                                          ('To Min', low), ('To Max', high)])
                valid = valid or origin_matches and values_match
            if not valid:
                return False, verified_links
            verified_links += 1
    return True, verified_links


def reference_checks(variant):
    filename, row_key, expected_count = REFERENCES[variant]
    path = OUT / filename
    record = json.loads(path.read_text())
    rows = record[row_key]
    urls = [r.get('sourceUrl') or r.get('source_url') or r.get('filePage') or
            r.get('source') or r.get('url') for r in rows]
    # This verifies the research manifest, not individual animal identities or
    # whether the observer actually viewed every image. Notes state that limit.
    checks = {
        'referenceManifestCountMatches': record['count'] == len(rows) == expected_count,
        'referenceSourcesPresent': all(isinstance(u, str) and u.startswith('http') for u in urls),
        'referenceSourceUrlsUnique': len(set(urls)) == len(urls),
    }
    return checks, {'path': str(path), 'photographs': len(rows),
                    'independentCatIdentitiesVerified': False}


results = {}
for variant in ['solid', 'ragdoll', 'siamese']:
    build = json.loads((OUT / 'build' / (variant + '-build.json')).read_text())
    bpy.ops.wm.open_mainfile(filepath=build['source'], load_ui=False, use_scripts=False)
    baseline = intrinsic()
    native_graphs = hair_graphs()
    original_groom = groom_settings()
    bpy.ops.wm.open_mainfile(filepath=build['output'], load_ui=False, use_scripts=False)
    actual = intrinsic()
    actual_graphs = hair_graphs()
    groom_valid, groom_changes = compare_groom(original_groom, groom_settings())
    checks = {key: actual[key] == baseline[key] for key in baseline}
    checks['originalFileUnchanged'] = hashlib.sha256(Path(build['source']).read_bytes()).hexdigest() == build['sourceSha256']
    checks['v2OutputSeparate'] = Path(build['output']).name == 'cat-' + variant + '-v2.blend'
    body = bpy.data.objects['GreyTabbyCat_Body']
    keys = body.data.shape_keys
    shape = keys.key_blocks.get(build['shape']['name'])
    checks['bodyShapeEnabled'] = shape is not None and shape.value == 1
    checks['finiteShape'] = shape is not None and bool(np.isfinite(np.array([tuple(v.co) for v in shape.data])).all())
    atlas = bpy.data.images.get('Miaoxing ' + variant + ' coat atlas')
    checks['newCoatAtlasPresent'] = atlas is not None and atlas.size[0] >= 3072 and bool(atlas.packed_file)
    checks['nativeNineteenHairSystems'] = len(actual['hairCounts']) == 19
    checks['nativeHairMaterialSetPreserved'] = set(native_graphs) == set(actual_graphs)
    checks['nativeClosureNodesAndSettingsPreserved'] = all(
        actual_graphs.get(name, {}).get('closures') == graph['closures']
        for name, graph in native_graphs.items()
    )
    checks['nativeMixShaderNodesPreserved'] = all(
        actual_graphs.get(name, {}).get('mixShaderNames') == graph['mixShaderNames']
        for name, graph in native_graphs.items()
    )
    checks['nativeLinksPreservedExceptDeclaredCoatMaskAndRandomRewiring'] = all(
        set(tuple(v) for v in graph['nativeLinks']).issubset(
            set(tuple(v) for v in actual_graphs.get(name, {}).get('nativeLinks', [])))
        for name, graph in native_graphs.items()
    )
    calm_random_valid, calm_random_links = controlled_random_ranges(native_graphs, variant)
    checks['nativeStrandRandomVariationRewiredThroughDeclaredRanges'] = calm_random_valid
    pigment_images = {}
    for mat in bpy.data.materials:
        if not mat.name.startswith('GreyTabbyCat_Hair_') or 'Beard' in mat.name or not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.bl_idname in PIGMENT_SOCKETS:
                socket = node.inputs[PIGMENT_SOCKETS[node.bl_idname]]
                pigment_images[mat.name + '/' + node.name] = sorted(upstream_images(socket))
    def allowed_image_channel(item):
        name, channel = item
        return (atlas is not None and name == atlas.name) or (channel == 'Alpha' and '_BodyHair_Mask.' in name)
    checks['noOldCoatOrTabbyMaskColorInPigment'] = bool(pigment_images) and all(
        all(allowed_image_channel(item) for item in names) for names in pigment_images.values())
    materials_with_atlas = {
        key.split('/')[0] for key, names in pigment_images.items()
        if any(atlas is not None and name == atlas.name for name, channel in names)
    }
    expected_coat_materials = {name for name in native_graphs if 'Beard' not in name}
    checks['everyCoatMaterialUsesNewAtlas'] = materials_with_atlas == expected_coat_materials
    checks['groomSettingsChangesControlled'] = groom_valid
    checks['staticReviewRestPose'] = all(o.data.pose_position == 'REST' for o in bpy.data.objects if o.type == 'ARMATURE')
    checks['walkCorrectiveDriversMutedForReview'] = keys.animation_data is not None and all(
        d.mute for d in keys.animation_data.drivers)
    checks['staticFaceCorrectionRetained'] = keys.key_blocks.get('repair_face') is not None and keys.key_blocks['repair_face'].value == 1
    checks['dynamicBodyCorrectivesZeroForReview'] = all(
        k.value == 0 for k in keys.key_blocks
        if k.name != 'repair_face' and (k.name.startswith('repair_') or k.name in ['neck', 'mouth']))
    opening = build['reviewPose']['upperBlinkValue']
    checks['upperLidReviewValuesSaved'] = 0 <= opening <= 1 and all(
        abs(keys.key_blocks['blink_u.' + side].value - opening) < 1e-6 for side in ['L', 'R'])
    ocular_key_data = [obj.data.shape_keys for obj in bpy.data.objects
                      if obj.type == 'MESH' and 'Sclera' in obj.name and obj.data.shape_keys]
    pupil_opening = {'solid': .40, 'ragdoll': .30, 'siamese': .22}[variant]
    checks['pupilShapeDriversFrozenForStaticReview'] = len(ocular_key_data) == 2 and all(
        data.animation_data is not None and all(driver.mute for driver in data.animation_data.drivers)
        for data in ocular_key_data)
    checks['pupilReviewValuesSaved'] = len(ocular_key_data) == 2 and all(
        abs(data.key_blocks['pupil_CTR01'].value - pupil_opening) < 1e-6
        and data.key_blocks['pupil_CTR02'].value == 0 for data in ocular_key_data)
    checks['v2VariantMetadata'] = bpy.context.scene.get('miaoxing_model_variant') == variant
    ref_checks, references = reference_checks(variant)
    checks.update(ref_checks)
    closure_counts = {name: len(graph['closures']) for name, graph in actual_graphs.items()}
    results[variant] = {
        'checks': checks, 'allPassed': all(checks.values()),
        'vertices': actual['vertices'], 'hairSystems': len(actual['hairCounts']),
        'hairMaterialClosureCounts': closure_counts,
        'pigmentInputs': pigment_images, 'groomSettingsChanges': groom_changes,
        'nativeRandomLinksRewiredThroughDeclaredRanges': calm_random_links,
        'references': references,
        'source': build['source'], 'output': build['output'],
        'aestheticQualityVerified': False, 'fullAnimationValidationPending': True,
    }
    print('REFERENCE_CAT_VERIFIED', variant, results[variant]['allPassed'],
          {name: ok for name, ok in checks.items() if not ok}, flush=True)

report = {
    'models': results,
    'allPassed': all(result['allPassed'] for result in results.values()),
    'scope': 'Native file integrity, preserved hair closures and original links except coat pigment/tabby mask Color replacement and declared Hair Info Random compression, controlled reductions of child strand perturbation/width, static review setup, and reference manifest counts. This does not certify aesthetics, individual reference cat identities, animation, or web performance.',
}
(OUT / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
if not report['allPassed']:
    raise RuntimeError('Reference-cat verification failed; see artifacts/cat-reference-study/verification.json')
