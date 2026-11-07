import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { creatorControls, defaultCreatorDesign, parseCreatorDesign, serializeCreatorDesign } from '../lib/cat-creator-design';
import { CAT_RENDERER, creatorDesignContract, defaultCatAssetRuntimeContract, validateCatRendererContract } from '../lib/cat-model-contract';
import { currentRoomAsset, roomModelAsset, validateRoomModelAsset } from '../lib/room-model-assets';
import { applyCreatorDesign, creatorTargetWeights, ownCreatorModel, type CreatorModel } from '../lib/cat-creator-model';
import { inspectCatAssetCapabilities, requiredCreatorFaceTargets, resolveCatBodySurface, validateCatRuntimeCapabilities } from '../lib/cat-asset-capabilities';

const shape = { ...defaultCreatorDesign.shape, headRound: 29, headWedge: 13, headWidth: 76, headFurDensity: 0, bodyFurLength: 97 };

test('v3/v4/v5 migrate face and groom values without rewriting asset identity', () => {
  for (const [schemaVersion, templateId] of [[3, 'norwegian-cat-v1'], [4, 'cat-foundation-v1'], [5, 'cat-foundation-v1']] as const) {
    const input = { schemaVersion, templateId, shape, ...(schemaVersion === 3 ? {} : { coatType: 'short', coatMode: 'source' }) };
    const design = parseCreatorDesign(input);
    assert.deepEqual(design.shape, shape);
    assert.equal(design.designSchemaVersion, 5);
    assert.equal(design.coatMode, schemaVersion === 5 ? 'source' : 'groom');
    assert.deepEqual(parseCreatorDesign(JSON.parse(serializeCreatorDesign(design))), design);
    const asset = roomModelAsset(currentRoomAsset(design), design);
    assert.equal(asset.schemaVersion, 4, 'historical authoring metadata remains untouched');
    assert.equal(asset.assetRevision, asset.sha256);
    assert.equal(asset.topologyVersion, 'norwegian-cat-v1');
    assert.deepEqual(asset.supportedDesignSchemaVersions, [5]);
    assert.equal(creatorTargetWeights(design).Head_round, .29);
    assert.equal(creatorTargetWeights(design).Shape_headWidth_high, .52);
  }
});

test('v3 missing groom uses old defaults, but missing face is refused', () => {
  const faceOnly = Object.fromEntries(creatorControls.filter(c => c.group !== 'fur').map(c => [c.key, shape[c.key]]));
  const migrated = parseCreatorDesign({ schemaVersion: 3, templateId: 'norwegian-cat-v1', shape: faceOnly });
  assert.equal(migrated.shape.headFurDensity, 75);
  assert.equal(migrated.shape.headWidth, 76);
  delete faceOnly.headWidth;
  assert.throws(() => parseCreatorDesign({ schemaVersion: 3, templateId: 'norwegian-cat-v1', shape: faceOnly }));
});

test('explicit design alias, conflicting versions, invalid numbers and cross-base pinning', () => {
  const { schemaVersion: _, ...explicit } = defaultCreatorDesign;
  assert.equal(parseCreatorDesign(explicit).schemaVersion, 5);
  assert.throws(() => parseCreatorDesign({ ...defaultCreatorDesign, schemaVersion: 4 }));
  assert.throws(() => parseCreatorDesign({ ...defaultCreatorDesign, shape: { ...shape, jaw: NaN } }));
  assert.throws(() => parseCreatorDesign({ ...defaultCreatorDesign, shape: { ...shape, headRound: 99, headWedge: 99 } }));
  const hairless = { ...defaultCreatorDesign, coatType: 'hairless' as const };
  assert.equal(creatorDesignContract(hairless).topologyVersion, 'sphynx-cat-v1');
  assert.throws(() => roomModelAsset(currentRoomAsset(defaultCreatorDesign), hairless));
  assert.throws(() => roomModelAsset('https://unknown/model.glb', defaultCreatorDesign));
});

function surface(name: string, vertexCount = 3) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 2), 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(vertexCount * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 4), 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = name;
  const bone = new THREE.Bone(); mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]));
  return mesh;
}

test('bodySurface is independent of traversal and vertex count; ambiguity fails closed', () => {
  const scene = new THREE.Group();
  const decoy = surface('large-eyeball', 100), body = surface('NorwegianCat_Surface');
  scene.add(decoy, body);
  assert.equal(resolveCatBodySurface(scene, 'norwegian'), body);
  body.name = 'authored-new-surface'; body.userData.bodySurface = true;
  assert.equal(resolveCatBodySurface(scene, 'norwegian'), body);
  delete body.userData.bodySurface;
  assert.equal(resolveCatBodySurface(scene, 'norwegian', { bodySurface: body.name }), body);
  assert.throws(() => resolveCatBodySurface(scene, 'norwegian'));
  body.userData.bodySurface = true; decoy.userData.bodySurface = true;
  assert.throws(() => resolveCatBodySurface(scene, 'norwegian'), /2/);
  delete decoy.userData.bodySurface; body.geometry.deleteAttribute('uv');
  assert.throws(() => resolveCatBodySurface(scene, 'norwegian'), /UV/);
});

function setTargets(mesh: THREE.Mesh, names: string[]) {
  mesh.geometry.morphAttributes.position = names.map(() => new THREE.Float32BufferAttribute(new Float32Array(mesh.geometry.getAttribute('position').count * 3), 3));
  mesh.morphTargetDictionary = Object.fromEntries(names.map((name, index) => [name, index]));
  mesh.morphTargetInfluences = names.map(() => 0);
}

test('26 face targets and 53 including blink report different capabilities honestly', () => {
  const scene = new THREE.Group(), body = surface('NorwegianCat_Surface');
  setTargets(body, requiredCreatorFaceTargets);
  const boundBones = ['head', 'neck_01', 'PantherPelvis'].map(name => { const b = new THREE.Bone(); b.name = name; scene.add(b); return b; });
  body.bind(new THREE.Skeleton(boundBones));
  scene.add(body);
  const v26 = inspectCatAssetCapabilities(scene, [], 'norwegian');
  assert.equal(v26.morphTargetCount, 26); assert.equal(v26.supportsBlink, false); assert.equal(v26.compatible, true);
  const full = [...requiredCreatorFaceTargets, 'Blink', ...requiredCreatorFaceTargets.map(name => `Blink_${name}`)];
  setTargets(body, full);
  const v53 = inspectCatAssetCapabilities(scene, [new THREE.AnimationClip('UnknownSourceClip', 1, [])], 'norwegian');
  assert.equal(v53.morphTargetCount, 53); assert.equal(v53.blinkCorrectiveCount, 26);
  assert.equal(v53.motionSemantics.walk, 'unverified');
  delete body.morphTargetDictionary!.Shape_eyeSize_high;
  assert.deepEqual(inspectCatAssetCapabilities(scene, [], 'norwegian').missingFaceTargets, ['Shape_eyeSize_high']);
  body.morphTargetDictionary!.Shape_eyeSize_high = 52;
  body.bind(new THREE.Skeleton([boundBones[0]]));
  const detached = inspectCatAssetCapabilities(scene, [], 'norwegian');
  assert.equal(detached.compatible, false, 'unrelated named bones do not establish a working skin binding');
  assert.deepEqual(detached.missingBoundSemanticBones, ['neck', 'pelvis']);
});

test('multi-primitive authored surface excludes optical globes by semantic role, regardless of ordering', () => {
  const scene = new THREE.Group(), authored = new THREE.Group(); authored.name = 'NorwegianCat_Surface';
  const eyeL = surface('globe-a', 60), eyeR = surface('globe-b', 70), skin = surface('skin', 3);
  (eyeL.material as THREE.Material).userData.creatorRole = 'eye-globe';
  (eyeR.material as THREE.Material).name = 'norwegian_EyeOptics_R';
  authored.add(eyeL, eyeR, skin); scene.add(authored);
  assert.equal(resolveCatBodySurface(scene, 'norwegian'), skin);
  authored.add(surface('unknown-extra-surface'));
  assert.throws(() => resolveCatBodySurface(scene, 'norwegian'), /2/);
  (skin.material as THREE.Material).userData.creatorRole = 'body-surface';
  assert.equal(resolveCatBodySurface(scene, 'norwegian'), skin);
});

test('legacy publisher refuses activation and binds restricted review to exact source bytes', async () => {
  const fs = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const temporary = await fs.mkdtemp(path.join(tmpdir(), 'cat-publish-test-'));
  try {
    await fs.mkdir(path.join(temporary, 'scripts'));
    await fs.mkdir(path.join(temporary, 'lib'));
    await fs.mkdir(path.join(temporary, 'public/models/creator'), { recursive: true });
    await fs.copyFile('scripts/publish-room-models.mjs', path.join(temporary, 'scripts/publish-room-models.mjs'));
    const registry = '{"current":{"norwegian":"preserved"},"assets":{}}';
    await fs.writeFile(path.join(temporary, 'lib/room-model-assets.json'), registry);
    const json = JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 });
    const chunk = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
    const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + chunk.length, 8); header.writeUInt32LE(chunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    for (const base of ['norwegian', 'sphynx'])
      await fs.writeFile(path.join(temporary, `public/models/creator/${base}-cat.glb`), Buffer.concat([header, chunk]));
    const run = (...args: string[]) => spawnSync(process.execPath, ['scripts/publish-room-models.mjs', ...args], { cwd: temporary, encoding: 'utf8' });
    assert.notEqual(run().status, 0);
    const plan = run('--plan'); assert.equal(plan.status, 0, plan.stderr);
    assert.ok(plan.stdout, JSON.stringify(plan));
    const token = JSON.parse(plan.stdout).confirmationRequired;
    assert.notEqual(run('--local-review-only', '--confirm', 'wrong').status, 0);
    assert.notEqual(run('--confirm', token).status, 0, 'a token cannot bypass missing distribution permission');
    const staged = run('--local-review-only', '--confirm', token);
    assert.equal(staged.status, 0, staged.stderr);
    assert.equal(run('--local-review-only', '--confirm', token).status, 0, 'identical review staging is idempotent');
    assert.equal(await fs.readFile(path.join(temporary, 'lib/room-model-assets.json'), 'utf8'), registry);
    await assert.rejects(fs.access(path.join(temporary, 'public/models/room')));
    await fs.appendFile(path.join(temporary, 'public/models/creator/norwegian-cat.glb'), 'tamper');
    assert.notEqual(run('--local-review-only', '--confirm', token).status, 0);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

function runtimeScene() {
  const scene = new THREE.Group(), body = surface('NorwegianCat_Surface');
  setTargets(body, requiredCreatorFaceTargets);
  const joints = ['head', 'neck_01', 'PantherPelvis'].map(name => {
    const bone = new THREE.Bone(); bone.name = name; scene.add(bone); return bone;
  });
  body.bind(new THREE.Skeleton(joints)); scene.add(body);
  return { scene, body };
}

const hasCode = (code: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === code;

test('renderer requirements are versioned separately and do not certify uninspected private binaries', () => {
  const asset = roomModelAsset(currentRoomAsset(defaultCreatorDesign), defaultCreatorDesign);
  assert.equal(asset.capabilities.evidence, 'requirements-only');
  assert.deepEqual(asset.rendererCompatibility.rendererVersions, [1]);
  assert.equal(validateCatRendererContract(asset), asset);
  const { scene } = runtimeScene();
  const observed = validateCatRuntimeCapabilities(scene, [], 'norwegian', defaultCreatorDesign, asset);
  assert.equal(observed.evidence, 'runtime-scene');
  assert.ok(observed.observedCapabilities.includes('face-controls-v1'));
  const incompatible = structuredClone(asset); incompatible.rendererCompatibility.rendererId = 'unsupported-renderer';
  assert.throws(() => validateRoomModelAsset(incompatible, defaultCreatorDesign), hasCode('CAT_RENDERER_UNSUPPORTED'));
  incompatible.rendererCompatibility.rendererId = CAT_RENDERER.rendererId;
  incompatible.rendererCompatibility.rendererVersions = [2];
  assert.throws(() => validateRoomModelAsset(incompatible, defaultCreatorDesign), hasCode('CAT_RENDERER_VERSION_UNSUPPORTED'));
  incompatible.rendererCompatibility.rendererVersions = [1]; incompatible.rendererCompatibility.contractVersion = 99;
  assert.throws(() => validateRoomModelAsset(incompatible, defaultCreatorDesign), hasCode('CAT_RENDERER_CONTRACT_UNSUPPORTED'));
});

test('unknown capability requirements fail before ownership and before a missing scene is accessed', () => {
  const contract = defaultCatAssetRuntimeContract(); contract.capabilities.required.push('neural-fur-v99');
  assert.throws(() => validateCatRendererContract(contract), hasCode('CAT_CAPABILITY_UNSUPPORTED'));
  assert.throws(() => ownCreatorModel(undefined as unknown as THREE.Group, [], 'norwegian', { assetContract: contract }), hasCode('CAT_CAPABILITY_UNSUPPORTED'));
});

test('morph names without buffers, wrong cardinality, or controls only on eye meshes are refused', () => {
  const { scene, body } = runtimeScene();
  const index = body.morphTargetDictionary!.Shape_headWidth_high;
  const attributes = body.geometry.morphAttributes.position!;
  attributes[index] = new THREE.Float32BufferAttribute(new Float32Array(6), 3);
  assert.throws(() => validateCatRuntimeCapabilities(scene, [], 'norwegian', defaultCreatorDesign), hasCode('CAT_ASSET_CAPABILITY_MISSING'));
  setTargets(body, requiredCreatorFaceTargets);
  body.morphTargetDictionary!.Shape_eyeSize_high = body.morphTargetDictionary!.Shape_headWidth_high;
  assert.throws(() => validateCatRuntimeCapabilities(scene, [], 'norwegian', defaultCreatorDesign), hasCode('CAT_ASSET_CAPABILITY_MISSING'));
  setTargets(body, requiredCreatorFaceTargets);
  delete body.morphTargetDictionary!.Shape_eyeSize_high;
  const eye = surface('unrelatedEye'); setTargets(eye, ['Shape_eyeSize_high']); scene.add(eye);
  const observed = inspectCatAssetCapabilities(scene, [], 'norwegian');
  assert.deepEqual(observed.missingFaceTargets, []);
  assert.deepEqual(observed.missingBodyFaceTargets, ['Shape_eyeSize_high']);
  assert.throws(() => validateCatRuntimeCapabilities(scene, [], 'norwegian', defaultCreatorDesign), hasCode('CAT_ASSET_CAPABILITY_MISSING'));
  body.geometry.morphAttributes.position = [];
  assert.throws(() => validateCatRuntimeCapabilities(scene, [], 'norwegian', defaultCreatorDesign), hasCode('CAT_ASSET_CAPABILITY_MISSING'));
});

test('a declared optional feature becomes mandatory only when requested and cannot be invented from metadata', () => {
  const { scene, body } = runtimeScene();
  const contract = defaultCatAssetRuntimeContract();
  contract.capabilities.required.push('blink-correctives-v1');
  assert.throws(() => validateCatRuntimeCapabilities(scene, [], 'norwegian', defaultCreatorDesign, contract), hasCode('CAT_ASSET_CAPABILITY_MISSING'));
  setTargets(body, [...requiredCreatorFaceTargets, 'Blink', ...requiredCreatorFaceTargets.map(name => `Blink_${name}`)]);
  assert.ok(validateCatRuntimeCapabilities(scene, [], 'norwegian', defaultCreatorDesign, contract).observedCapabilities.includes('blink-correctives-v1'));
});

test('old stored v3/v4/v5 appearances satisfy actual renderer checks without migrating their pinned asset identity', () => {
  const { scene } = runtimeScene();
  const oldAssetId = currentRoomAsset(defaultCreatorDesign);
  for (const version of [3, 4, 5]) {
    const stored = JSON.stringify({ schemaVersion: version, templateId: version === 3 ? 'norwegian-cat-v1' : 'cat-foundation-v1',
      ...(version === 3 ? {} : { coatType: 'long', coatMode: 'source' }), shape });
    const design = parseCreatorDesign(JSON.parse(stored));
    const asset = roomModelAsset(oldAssetId, design);
    assert.equal(validateCatRuntimeCapabilities(scene, [], 'norwegian', design, asset).compatible, true);
    assert.equal(currentRoomAsset(design), oldAssetId);
    assert.equal(design.shape.bodyFurLength, 97);
    assert.equal(design.coatMode, version === 5 ? 'source' : 'groom');
  }
});

test('absent model and unregistered asset produce explicit errors without resetting saved appearance', () => {
  const saved = serializeCreatorDesign(defaultCreatorDesign);
  assert.throws(() => ownCreatorModel(undefined as unknown as THREE.Group), hasCode('CAT_MODEL_MISSING'));
  assert.throws(() => validateCatRuntimeCapabilities(undefined as unknown as THREE.Group, [], 'norwegian'), hasCode('CAT_MODEL_MISSING'));
  assert.throws(() => roomModelAsset('missing-model.glb', defaultCreatorDesign), hasCode('CAT_ASSET_NOT_REGISTERED'));
  assert.equal(serializeCreatorDesign(defaultCreatorDesign), saved);
  assert.throws(() => applyCreatorDesign({ baseId: 'sphynx' } as CreatorModel, defaultCreatorDesign), hasCode('CAT_TOPOLOGY_INCOMPATIBLE'));
});
