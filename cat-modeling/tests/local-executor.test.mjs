import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { executeProduction } from '../production.mjs';
import { parseContract } from '../contracts/index.mjs';
import { validateLocalResult } from '../local-executor.mjs';
import { sha256, jsonBytes } from '../protocol.mjs';

const example = new URL('../contracts/examples/request.v1.json', import.meta.url);
function task() {
  return executeProduction('preview', { request: example.pathname, dryRun: true }).result.handoff;
}
function blocked(t = task()) {
  return { resultVersion: 1, jobId: t.jobId, taskSha256: sha256(jsonBytes(parseContract('local-task', t))), requestSha256: t.requestSha256,
    state: 'blocked', returnMode: 'metadata-only', authorization: { localExecutionApproved: false, evidenceReturnApproved: false, evidenceRef: null },
    tool: { name: 'blender', version: null }, source: { sha256Before: null, sha256After: null, authorizationEvidence: null },
    scriptSha256: t.script.sha256, scenarioSha256: t.renderContract.sha256,
    execution: { commandExecuted: false, exitCode: null, timedOut: false, elapsedSeconds: 0, failureStage: 'planning' },
    artifacts: [], checks: [{ name: 'source', state: 'missing', details: 'Local private source not supplied' }], limitations: ['No Blender execution or production acceptance'] };
}
async function evidence(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-local-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plan = task();
  const png = await sharp({ create: { width: 768, height: 768, channels: 3, background: '#cccccc' } }).png().toBuffer();
  const report = { status: 'rendered-not-approved', fixtureOnly: true, sourceSha256: 'a'.repeat(64), tools: { blender: '4.5.15' },
    scenario: plan.renderContract.scenario, design: plan.appearance,
    images: Object.fromEntries(['front', 'three', 'side'].map(view => [view, { sha256: sha256(png) }])) };
  const files = { 'front.png': png, 'three.png': png, 'side.png': png, 'validation.json': jsonBytes(report), 'execution.log': Buffer.from('Synthetic protocol fixture; Blender was not executed\n') };
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(root, name), bytes);
  const result = { ...blocked(plan), state: 'completed', returnMode: 'authorized-evidence',
    authorization: { localExecutionApproved: true, evidenceReturnApproved: true, evidenceRef: 'synthetic-protocol-test' },
    tool: { name: 'blender', version: '4.5.15' }, source: { sha256Before: 'a'.repeat(64), sha256After: 'a'.repeat(64), authorizationEvidence: 'synthetic-test-only' },
    execution: { commandExecuted: true, exitCode: 0, timedOut: false, elapsedSeconds: 1, failureStage: null },
    artifacts: Object.entries(files).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes) })),
    checks: ['input-integrity', 'source-unchanged', 'tool-version', 'render-completed', 'output-integrity'].map(name => ({ name, state: 'passed', details: 'Synthetic protocol assertion; no real Blender result' })), limitations: ['Synthetic evidence exercises only the return protocol'] };
  return { root, plan, result, files };
}

test('real preview handoff satisfies strict task schema and cannot carry arbitrary commands', () => {
  const plan = task();
  assert.equal(parseContract('local-task', plan).invokeInCloud, false);
  assert.throws(() => parseContract('local-task', { ...plan, command: { ...plan.command, argv: ['--python-expr', 'danger'] } }), /command|small/);
  assert.throws(() => parseContract('local-task', { ...plan, command: { ...plan.command, shell: true } }));
});
test('blocked and partially failed results remain failed, never a successful local render', () => {
  const plan = task(), result = blocked(plan);
  const report = validateLocalResult({ task: plan, result });
  assert.equal(report.valid, false); assert.equal(report.status, 'blocked');
  const failed = { ...result, state: 'failed', execution: { ...result.execution, commandExecuted: true, exitCode: 1, failureStage: 'render' } };
  assert.equal(validateLocalResult({ task: plan, result: failed }).valid, false);
  assert.throws(() => parseContract('local-result', { ...failed, state: 'completed' }), /Completed/);
});
test('authorized synthetic files prove integrity without certifying Blender or production', async t => {
  const e = await evidence(t), report = validateLocalResult({ task: e.plan, result: e.result, inputRoot: e.root });
  assert.equal(report.valid, true, JSON.stringify(report.errors));
  assert.equal(report.approved, false); assert.equal(report.productionIntegrationReady, false);
  assert(report.pendingChecks.includes('synthetic-evidence-not-production'));
  assert(report.pendingChecks.includes('exact-tool-version-compatibility'));
  const metadata = { ...e.result, returnMode: 'metadata-only', authorization: { ...e.result.authorization, evidenceReturnApproved: false } };
  const limited = validateLocalResult({ task: e.plan, result: metadata });
  assert.equal(limited.status, 'metadata-accepted-unverified');
  assert(limited.pendingChecks.includes('returned-file-bytes'));
});
test('mixed jobs, altered sources, incompatible tools and budgets are refused', async t => {
  const e = await evidence(t);
  for (const edit of [r => r.taskSha256 = '0'.repeat(64), r => r.requestSha256 = '0'.repeat(64), r => r.execution.elapsedSeconds = 99999]) {
    const result = structuredClone(e.result); edit(result);
    assert.equal(validateLocalResult({ task: e.plan, result, inputRoot: e.root }).valid, false);
  }
  const changed = structuredClone(e.result); changed.source.sha256After = 'b'.repeat(64);
  assert.throws(() => parseContract('local-result', changed), /unchanged source/);
  const plan = structuredClone(e.plan); plan.expectedTool.state = 'resolved'; plan.expectedTool.requiredBlenderVersion = '3.6.23';
  const result = { ...e.result, taskSha256: sha256(jsonBytes(parseContract('local-task', plan))) };
  assert.equal(validateLocalResult({ task: plan, result, inputRoot: e.root }).valid, false);
});
test('returned files cannot be missing, tampered, linked, unauthorized or model payloads', async t => {
  const e = await evidence(t), file = path.join(e.root, 'front.png');
  fs.writeFileSync(file, 'tampered');
  assert.equal(validateLocalResult({ task: e.plan, result: e.result, inputRoot: e.root }).valid, false);
  fs.unlinkSync(file);
  const missing = validateLocalResult({ task: e.plan, result: e.result, inputRoot: e.root });
  assert(missing.errors.some(error => error.code === 'PRIVATE_ASSETS_MISSING'));
  fs.symlinkSync(path.join(e.root, 'side.png'), file);
  assert.equal(validateLocalResult({ task: e.plan, result: e.result, inputRoot: e.root }).valid, false);
  for (const badPath of ['../private.png', 'model.glb', 'source.blend']) {
    const result = structuredClone(e.result); result.artifacts[0].path = badPath;
    assert.throws(() => parseContract('local-result', result));
  }
  const unauthorized = structuredClone(e.result); unauthorized.authorization.evidenceReturnApproved = false;
  assert.throws(() => parseContract('local-result', unauthorized), /authorization/);
});
test('header-only PNG evidence and omitted completion checks cannot masquerade as local success', async t => {
  const e = await evidence(t), header = Buffer.alloc(33);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(header);
  header.writeUInt32BE(13, 8); header.write('IHDR', 12); header.writeUInt32BE(768,16); header.writeUInt32BE(768,20);
  header[24] = 8; header[25] = 2;
  fs.writeFileSync(path.join(e.root, 'front.png'), header);
  e.result.artifacts[0].bytes = header.length; e.result.artifacts[0].sha256 = sha256(header);
  assert.equal(validateLocalResult({ task: e.plan, result: e.result, inputRoot: e.root }).valid, false);
  const empty = { ...e.result, checks: [] };
  assert.throws(() => parseContract('local-result', empty), /required check/);
});
