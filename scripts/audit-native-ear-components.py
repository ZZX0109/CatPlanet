#!/usr/bin/env python3
"""Independent CPU cross-check of the existing Blender component dump."""
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

source = Path('artifacts/native-coat-study/native-component-dump.json')
cleanup_path = Path('artifacts/native-coat-audit/native-card-cleanup-selection.json')
dump = json.loads(source.read_text())
cleanup = json.loads(cleanup_path.read_text())
deleted = [c for c in dump['components'] if c['deletedAllFaces']]
ear = [c for c in deleted if min(c['sourceVertexIds']) >= 14871 and max(c['sourceVertexIds']) <= 17624]
whiskers = [c for c in deleted if min(c['sourceVertexIds']) >= 13649 and max(c['sourceVertexIds']) <= 14870]
low_ids = set(dump['reviewGroupsNotDeletionRules']['head-other-review']['ids'])
low = [c for c in deleted if c['id'] in low_ids]
other_ear = [c for c in ear if c['id'] not in low_ids]
ear_tree = cKDTree(np.concatenate([c['creatorStandingWorldPositions'] for c in other_ear]))
whisker_tree = cKDTree(np.concatenate([c['creatorStandingWorldPositions'] for c in whiskers]))
rows = []
for c in low:
    points = np.array(c['creatorStandingWorldPositions'])
    ed, _ = ear_tree.query(points)
    wd, _ = whisker_tree.query(points)
    rows.append({'id': c['id'], 'faces': c['faceCount'], 'meanEarWeight': c['earBoneWeight'],
                 'nearestKnownEarPointDistance': {'median': float(np.median(ed)), 'max': float(ed.max())},
                 'nearestMuzzleBrowPointDistance': {'median': float(np.median(wd)), 'min': float(wd.min())},
                 'closerToEarThanWhiskerAtEveryVertex': bool(np.all(ed < wd))})
by_id = {c['id']: c for c in low}
pairs = []
for c in low:
    if c['id'] + 1377 not in by_id:
        continue
    partner = by_id[c['id'] + 1377]
    a, b = np.array(c['centerWorld']), np.array(partner['centerWorld'])
    pairs.append({'ids': [c['id'], partner['id']], 'sameFaceCount': c['faceCount'] == partner['faceCount'],
                  'sagittalPlaneX': float((a[0] + b[0]) / 2),
                  'yzCentroidMismatch': float(np.linalg.norm(a[1:] - b[1:]))})
selected_by_weight = [c for c in deleted if c['earBoneWeight'] > .01]
cross_ids = {c['minimumSourceVertexId'] for c in cleanup['components']}
dump_ids = {c['id'] for c in deleted}
checks = {
    'independentGLBSelectionMatchesAll386DumpIDs': cross_ids == dump_ids and len(cross_ids) == 386,
    'independentGLBAndDumpDeletedFaceCount3648': cleanup['selectedFaces'] == sum(c['faceCount'] for c in deleted) == 3648,
    'allDeletedComponentsPartitionIntoEarAndWhiskerBlocks': len(ear) == 342 and len(whiskers) == 44 and len(ear) + len(whiskers) == len(deleted),
    'earBlockContains2086Faces': sum(c['faceCount'] for c in ear) == 2086,
    'whiskerBlockContains1562Faces': sum(c['faceCount'] for c in whiskers) == 1562,
    'lowRim22AreBilateralPairs': len(pairs) == 11 and all(p['sameFaceCount'] and p['yzCentroidMismatch'] < .001 for p in pairs),
    'allLowRim22VerticesCloserToEarTuftsThanMuzzleBrow': len(rows) == 22 and all(r['closerToEarThanWhiskerAtEveryVertex'] for r in rows),
    'weightPreservationRuleKeepsExactlyEarBlock': {c['id'] for c in selected_by_weight} == {c['id'] for c in ear},
    'whiskerBlockEarWeightsExactlyZero': all(c['earBoneWeight'] == 0 for c in whiskers),
}
report = {'schemaVersion': 1, 'method': 'Read-only CPU comparison of independent GLB cleanup-selection reproduction with existing Blender source-component dump. No new Blender, browser or GPU.',
          'sourceGLBSHA256': dump['sourceSha256'], 'componentDump': str(source),
          'componentDumpSHA256': hashlib.sha256(source.read_bytes()).hexdigest(),
          'checks': checks, 'pass': all(checks.values()),
          'ear': {'components': len(ear), 'faces': sum(c['faceCount'] for c in ear), 'sourceVertexRangeInclusive': [14871, 17624],
                  'minimumMeanEarBoneWeight': min(c['earBoneWeight'] for c in ear)},
          'muzzleAndBrow': {'components': len(whiskers), 'faces': sum(c['faceCount'] for c in whiskers), 'sourceVertexRangeInclusive': [13649, 14870]},
          'lowRim22': rows, 'bilateralPairs': pairs,
          'safePreservationRule': 'For this SHA-pinned Norwegian source, before size/head/eye deletion tests, preserve every whole component with mean Bone008/Bone009 ear weight>.01. This preserves exactly342/2086 including low-rim22/122. SourceID14871..17624 is an auditable cross-check, not a transferable rule for other assets. Unknown head strips should be preserved until reviewed; do not call all detached narrow components whiskers.',
          'classificationLimits': 'IDs and geometry/skin weights establish original ear-region tuft ownership here. They do not identify every card as a separate biological hair. No chest/torso/tail component is selected by this source cleanup.'}
out = Path('artifacts/native-coat-audit/ear-component-crosscheck.json')
out.write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps({'output': str(out), 'pass': report['pass'], 'checks': checks,
                  'earComponents': len(ear), 'earFaces': report['ear']['faces'],
                  'lowRimYZPairMismatchMax': max(p['yzCentroidMismatch'] for p in pairs)}, ensure_ascii=False))
if not report['pass']:
    raise SystemExit(1)
