#!/usr/bin/env python3
"""Independent read-only GLB regression/source-geometry audit; no GPU/Blender."""
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import struct

import numpy as np

OUT = Path('artifacts/native-ear-coat-restoration')
OLD = OUT / 'before-build/public/models/creator/norwegian-cat.glb'
NEW = Path('public/models/creator/norwegian-cat.glb')
SOURCE = Path('assets/source/user-animal-pack-2026-11-04/norwegian-forest/source/Norwegianforest.glb')


class GLB:
    def __init__(self, path):
        self.path = path
        data = path.read_bytes()
        self.sha = hashlib.sha256(data).hexdigest()
        size = struct.unpack_from('<I', data, 12)[0]
        self.doc = json.loads(data[20:20 + size])
        self.bin = data[28 + size:]
        self.cache = {}

    def view(self, index, count, size, dtype, offset=0):
        view = self.doc['bufferViews'][index]
        dtype = np.dtype(dtype)
        return np.ndarray((count, size), dtype=dtype, buffer=self.bin,
                          offset=view.get('byteOffset', 0) + offset,
                          strides=(view.get('byteStride', size * dtype.itemsize), dtype.itemsize)).copy()

    def accessor(self, index):
        if index in self.cache:
            return self.cache[index]
        a = self.doc['accessors'][index]
        dtype = {5120: 'i1', 5121: 'u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[a['componentType']]
        size = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        result = self.view(a['bufferView'], a['count'], size, dtype, a.get('byteOffset', 0)) if 'bufferView' in a else np.zeros((a['count'], size), dtype)
        if 'sparse' in a:
            s = a['sparse']
            indices = s['indices']
            idtype = {5121: 'u1', 5123: '<u2', 5125: '<u4'}[indices['componentType']]
            ids = self.view(indices['bufferView'], s['count'], 1, idtype, indices.get('byteOffset', 0)).ravel()
            values = s['values']
            result[ids] = self.view(values['bufferView'], s['count'], size, dtype, values.get('byteOffset', 0))
        if a.get('normalized'):
            info = np.iinfo(np.dtype(dtype))
            result = result.astype(np.float32) / info.max
            if info.min < 0:
                result = np.maximum(result, -1)
        self.cache[index] = result
        return result

    def body(self):
        return next(p for m in self.doc['meshes'] for p in m['primitives']
                    if self.doc['materials'][p.get('material', 0)].get('normalTexture'))

    def joint_names(self):
        return [self.doc['nodes'][i].get('name', '') for i in self.doc['skins'][0]['joints']]

    def skin(self, primitive, canonical_names):
        joints = self.accessor(primitive['attributes']['JOINTS_0']).astype(np.int64)
        weights = self.accessor(primitive['attributes']['WEIGHTS_0']).astype(np.float32)
        names = [name.replace(' ', '_') for name in self.joint_names()]
        order = {name: i for i, name in enumerate(canonical_names)}
        if len(set(names)) != len(names) or set(names) != set(canonical_names):
            raise ValueError('Skin joint names do not form a verified bijection')
        remap = np.array([order[n] for n in names])
        dense = np.zeros((len(joints), len(canonical_names)), np.float32)
        for slot in range(joints.shape[1]):
            np.add.at(dense, (np.arange(len(joints)), remap[joints[:, slot]]), weights[:, slot])
        return dense


def vector_keys(position, uv):
    # Exact float32 position+UV; no export-index assumption.
    return [tuple(row) for row in np.concatenate((position, uv), axis=1)]


def face_counter(indices):
    result = Counter()
    for row in indices.reshape(-1, 3):
        a = tuple(int(x) for x in row)
        result[min(a, a[1:] + a[:1], a[2:] + a[:2])] += 1
    return result


def texture_images(glb):
    out = []
    for image in glb.doc.get('images', []):
        view = glb.doc['bufferViews'][image['bufferView']]
        raw = glb.bin[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        out.append({'mimeType': image.get('mimeType'), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    return out


def main():
    manifest = json.loads(Path('public/models/creator/norwegian-manifest.json').read_text())
    if manifest.get('creatorNativeCoat', {}).get('preservedEarComponents') != 342:
        raise RuntimeError('Restored official asset is not ready; no verification was fabricated')
    old, new, source = GLB(OLD), GLB(NEW), GLB(SOURCE)
    sources = {str(x.path): x.sha for x in (old, new, source)}
    names = sorted(n.replace(' ', '_') for n in old.joint_names())
    ob, nb, sb = old.body(), new.body(), source.body()
    op, np_ = old.accessor(ob['attributes']['POSITION']), new.accessor(nb['attributes']['POSITION'])
    ou, nu = old.accessor(ob['attributes']['TEXCOORD_0']), new.accessor(nb['attributes']['TEXCOORD_0'])
    os, ns, ss = old.skin(ob, names), new.skin(nb, names), source.skin(sb, names)
    lookup = defaultdict(list)
    for i, key in enumerate(vector_keys(np_, nu)):
        lookup[key].append(i)
    mapping, used, ambiguous = [], set(), 0
    for i, key in enumerate(vector_keys(op, ou)):
        candidates = [v for v in lookup.get(key, []) if v not in used and np.array_equal(os[i], ns[v])]
        if not candidates:
            raise ValueError('Old position+UV+named-skin binding has no exact restored match at vertex' + str(i))
        if len(candidates) > 1:
            ambiguous += 1
            # Normal is a secondary disambiguator, never an index shortcut.
            normal = old.accessor(ob['attributes']['NORMAL'])[i]
            exact = [v for v in candidates if np.array_equal(normal, new.accessor(nb['attributes']['NORMAL'])[v])]
            if exact:
                candidates = exact
        chosen = candidates[0]
        mapping.append(chosen)
        used.add(chosen)
    mapping = np.array(mapping)
    added = np.array([i for i in range(len(np_)) if i not in used])
    checks = {}
    checks['bodyVertexIncrease2754'] = len(np_) - len(op) == 2754
    checks['bodyFaceIncrease2086'] = len(new.accessor(nb['indices'])) - len(old.accessor(ob['indices'])) == 2086 * 3
    checks['oldBodyPositionUVAndNamedSkinExact'] = bool(np.array_equal(op, np_[mapping]) and np.array_equal(ou, nu[mapping]) and np.array_equal(os, ns[mapping]))
    checks['oldBodyNormalsExact'] = bool(np.array_equal(old.accessor(ob['attributes']['NORMAL']), new.accessor(nb['attributes']['NORMAL'])[mapping]))
    old_faces = face_counter(mapping[old.accessor(ob['indices']).reshape(-1)])
    new_faces = face_counter(new.accessor(nb['indices']))
    extra_faces = new_faces - old_faces
    checks['allOldOrientedBodyFacesPreserved'] = not bool(old_faces - new_faces)
    checks['exactly2086AddedFacesUseOnlyAddedVertices'] = sum(extra_faces.values()) == 2086 and all(set(face).issubset(set(added)) for face in extra_faces)

    target_names_old = old.doc['meshes'][0].get('extras', {}).get('targetNames', [])
    target_names_new = new.doc['meshes'][0].get('extras', {}).get('targetNames', [])
    checks['same53TargetNamesAndOrder'] = target_names_old == target_names_new and len(target_names_new) == 53 and len(nb['targets']) == 53
    morphs = []
    ear_motion = {}
    for ti, name in enumerate(target_names_old):
        summary = {'name': name, 'attributes': {}}
        for attr in sorted(set(ob['targets'][ti]) | set(nb['targets'][ti])):
            a = old.accessor(ob['targets'][ti][attr]) if attr in ob['targets'][ti] else np.zeros((len(op), 3), np.float32)
            b = new.accessor(nb['targets'][ti][attr]) if attr in nb['targets'][ti] else np.zeros((len(np_), 3), np.float32)
            summary['attributes'][attr] = {'exact': bool(np.array_equal(a, b[mapping])), 'maximumDifference': float(np.max(np.abs(a - b[mapping])))}
            if attr == 'POSITION' and ('earSize' in name or 'earTilt' in name):
                lengths = np.linalg.norm(b[added], axis=1)
                ear_motion[name] = {'nonzeroAddedVertices': int((lengths > 1e-10).sum()), 'minimumDisplacement': float(lengths.min()), 'maximumDisplacement': float(lengths.max()), 'finite': bool(np.isfinite(lengths).all())}
        morphs.append(summary)
    checks['all53ExistingBodyMorphValuesExact'] = all(a['exact'] for m in morphs for a in m['attributes'].values())
    checks['restoredEarSizeAndEarTiltHaveActualDisplacement'] = len(ear_motion) == 4 and all(m['nonzeroAddedVertices'] > 0 and m['finite'] for m in ear_motion.values())

    # Map the restored geometry to the supplied original independently of new
    # metadata/vertex IDs. Fit only unique-UV, strongly torso/leg source anchors.
    sp, su = source.accessor(sb['attributes']['POSITION']), source.accessor(sb['attributes']['TEXCOORD_0'])
    source_uv, old_uv = defaultdict(list), defaultdict(list)
    for i, row in enumerate(su): source_uv[tuple(row)].append(i)
    for i, row in enumerate(ou): old_uv[tuple(row)].append(i)
    torso_columns = [i for i, n in enumerate(names) if 'Spine' in n or 'Leg' in n or n in ('PantherPelvis', 'PantherRibcage')]
    anchors = [(ids[0], old_uv[key][0]) for key, ids in source_uv.items() if len(ids) == 1 and len(old_uv.get(key, [])) == 1 and ss[ids[0], torso_columns].sum() > .95]
    x = np.array([np.r_[sp[a], 1] for a, _ in anchors])
    y = np.array([op[b] for _, b in anchors])
    affine, _, rank, _ = np.linalg.lstsq(x, y, rcond=None)
    # Explicit contraction avoids a platform BLAS floating-status warning;
    # these tiny matrices do not need an accelerated matrix multiplication.
    residual = np.linalg.norm(np.einsum('ij,jk->ik', x, affine) - y, axis=1)
    predicted = np.einsum('ij,jk->ik', np.c_[sp, np.ones(len(sp))], affine)
    source_ear_ids = range(14871, 17625)
    ear_uv = defaultdict(list)
    for i in source_ear_ids: ear_uv[tuple(su[i])].append(i)
    source_map, used_source, source_errors, skin_errors, uv_errors = {}, set(), [], [], []
    for vertex in added:
        candidates = [i for i in ear_uv.get(tuple(nu[vertex]), []) if i not in used_source]
        if not candidates:
            raise ValueError('New ear UV has no source-ear candidate')
        chosen = min(candidates, key=lambda i: np.linalg.norm(predicted[i] - np_[vertex]))
        source_map[int(vertex)] = chosen
        used_source.add(chosen)
        source_errors.append(np.linalg.norm(predicted[chosen] - np_[vertex]))
        skin_errors.append(np.max(np.abs(ss[chosen] - ns[vertex])))
        uv_errors.append(np.max(np.abs(su[chosen] - nu[vertex])))
    source_triangles = source.accessor(sb['indices']).reshape(-1, 3)
    expected_ear_faces = source_triangles[np.isin(source_triangles, list(source_ear_ids)).all(axis=1)]
    mapped_added_faces = []
    for face, multiplicity in extra_faces.items():
        mapped_added_faces.extend([[source_map[v] for v in face]] * multiplicity)
    checks['addedVerticesMapBijectivelyToAllSourceEarVertices'] = used_source == set(source_ear_ids) and len(added) == 2754
    checks['sourceEarUVExactAndBindGeometryWithin1e6'] = max(uv_errors) == 0 and max(source_errors) < 1e-6 and rank == 4 and residual.max() < 1e-6
    checks['sourceEarNamedSkinPreservedWithin2e6'] = max(skin_errors) < 2e-6
    checks['all2086SourceEarOrientedTrianglesRestored'] = face_counter(np.array(mapped_added_faces)) == face_counter(expected_ear_faces) and len(expected_ear_faces) == 2086
    ear_columns = [i for i, n in enumerate(names) if 'Bone008' in n or 'Bone009' in n]
    ear_weights = ns[added][:, ear_columns].sum(axis=1)
    skin_sums = ns[added].sum(axis=1)
    checks['restoredEarSkinNormalizedAndEarBoneInfluenced'] = bool(np.max(np.abs(skin_sums - 1)) < 2e-6 and np.all(ear_weights > 0))
    checks['same49JointNames'] = sorted(old.joint_names()) == sorted(new.joint_names()) and len(new.joint_names()) == 49

    eye_reports = []
    for old_p in [p for p in old.doc['meshes'][0]['primitives'] if p is not ob]:
        name = old.doc['materials'][old_p['material']]['name']
        new_p = next(p for p in new.doc['meshes'][0]['primitives'] if new.doc['materials'][p['material']]['name'] == name)
        comparisons = {}
        # Eyes are separate145-vertex primitives. Report index ordering rather
        # than assume it: exact equality is a stronger verified observation.
        for attr in sorted(old_p['attributes']):
            comparisons[attr] = bool(np.array_equal(old.accessor(old_p['attributes'][attr]), new.accessor(new_p['attributes'][attr])))
        comparisons['indices'] = bool(np.array_equal(old.accessor(old_p['indices']), new.accessor(new_p['indices'])))
        comparisons['all53MorphValues'] = all(np.array_equal(old.accessor(a[attr]) if attr in a else np.zeros((145, 3)), new.accessor(b[attr]) if attr in b else np.zeros((145, 3))) for a, b in zip(old_p['targets'], new_p['targets']) for attr in set(a) | set(b))
        eye_reports.append({'material': name, 'comparisons': comparisons})
    checks['bothEyesAllAttributesIndicesMorphsUnchanged'] = len(eye_reports) == 2 and all(all(e['comparisons'].values()) for e in eye_reports)
    old_images, new_images = texture_images(old), texture_images(new)
    checks['allEmbeddedTextureBytesUnchanged'] = Counter(i['sha256'] for i in old_images) == Counter(i['sha256'] for i in new_images)
    checks['filesStableDuringAudit'] = all(hashlib.sha256(Path(p).read_bytes()).hexdigest() == value for p, value in sources.items())
    checks = {key: bool(value) for key, value in checks.items()}
    report = {'schemaVersion': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'sourceFiles': sources,
              'method': 'Read-only GLB accessor decoding including sparse morphs. Old/new body mapped by exact position+UV+named-skin weights, normals disambiguate duplicates; no export-index assumption. Source-ear correspondence uses independent original UV and an affine fit to unchanged unique-UV torso/leg anchors, then checks source oriented triangles and skin weights.',
              'checks': checks, 'pass': all(checks.values()),
              'counts': {'oldBodyVertices': len(op), 'newBodyVertices': len(np_), 'addedVertices': len(added), 'oldBodyFaces': int(len(old.accessor(ob['indices'])) / 3), 'newBodyFaces': int(len(new.accessor(nb['indices'])) / 3), 'addedFaces': sum(extra_faces.values()), 'targets': len(target_names_new), 'bones': len(new.joint_names()), 'duplicateBindingCandidates': ambiguous},
              'sourceEarMatch': {'anchorCount': len(anchors), 'affine4x3': affine.tolist(), 'anchorMaximumResidual': float(residual.max()), 'newEarMaximumPositionResidual': float(max(source_errors)), 'maximumUVResidual': float(max(uv_errors)), 'maximumNamedSkinResidual': float(max(skin_errors)), 'earWeightRange': [float(ear_weights.min()), float(ear_weights.max())], 'positiveEarWeightVertices': int((ear_weights > 0).sum()), 'skinSumRange': [float(skin_sums.min()), float(skin_sums.max())]},
              'earMorphMotion': ear_motion, 'existingBodyMorphComparisons': morphs, 'eyes': eye_reports,
              'textures': {'old': old_images, 'new': new_images},
              'limitations': ['This checks the rebuilt asset in bind-space and morph deltas, not rendered slider quality or animation playback.', 'Original source-ear to rebuilt position preservation is verified within1e-6scene units after the independently fitted export transform, not falsely called bit-identical to unscaled original coordinates.', 'If duplicate position+UV+skin+normal bindings are indistinguishable, mesh identity is verified by oriented triangles and all morph values rather than claiming a unique original export index.']}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'asset-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'output': str(OUT / 'asset-verification.json'), 'pass': report['pass'], 'checks': checks, 'counts': report['counts'], 'earMotion': ear_motion, 'sourceEarMatch': report['sourceEarMatch']}, ensure_ascii=False))
    if not report['pass']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
