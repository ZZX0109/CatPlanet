import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePngEvidence } from './png-evidence.mjs';
import { parseContract } from './contracts/index.mjs';
import { sha256, jsonBytes } from './protocol.mjs';
import { readBoundedFile } from './file-access.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const required = ['front.png', 'three.png', 'side.png', 'validation.json', 'execution.log'];

/** Read-only return channel. Integrity checks never grant licensing, visual approval or publication. */
export function validateLocalResult({ task: rawTask, result: rawResult, inputRoot }) {
  const task = parseContract('local-task', rawTask);
  const result = parseContract('local-result', rawResult);
  const checks = [], errors = [];
  const pendingChecks = ['private-source-bytes', 'license-and-consent-review', 'four-stage-visual-acceptance', 'production-rig-groom-animation', 'execution-memory-and-device-budget'];
  const run = (name, operation) => {
    try { operation(); checks.push({ name, state: 'passed' }); }
    catch (error) { checks.push({ name, state: error.code === 'ENOENT' ? 'missing' : 'failed' }); errors.push({ code: error.code === 'ENOENT' ? 'PRIVATE_ASSETS_MISSING' : 'FILES_INVALID', message: `${name}: ${error.message}` }); }
  };
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  run('task-result-identity', () => {
    assert(result.jobId === task.jobId && result.requestSha256 === task.requestSha256, 'Job or request differs');
    assert(result.taskSha256 === sha256(jsonBytes(task)), 'Canonical task digest differs');
  });
  run('render-script-and-scenario', () => {
    const scriptHash = sha256(readBoundedFile(path.join(repository, task.script.path), 1024 * 1024));
    const scenarioBytes = readBoundedFile(path.join(repository, task.renderContract.path), 1024 * 1024);
    assert(task.script.sha256 === scriptHash && task.renderContract.sha256 === sha256(scenarioBytes), 'Task no longer matches the checked-out renderer/scenario');
    assert(JSON.stringify(task.renderContract.scenario) === JSON.stringify(JSON.parse(scenarioBytes)), 'Task scenario content differs');
    if (result.state === 'completed') assert(result.scriptSha256 === scriptHash && result.scenarioSha256 === sha256(scenarioBytes), 'Executed script/scenario differs');
  });
  if (task.expectedTool.requiredBlenderVersion === null) pendingChecks.push('exact-tool-version-compatibility');
  else if (result.state === 'completed') run('exact-tool-version', () => assert(result.tool.version === task.expectedTool.requiredBlenderVersion, 'Blender version differs from resolved task'));
  if (result.state === 'completed') {
    run('source-and-execution', () => {
      if (task.requiredLocalInputs[0].sha256 !== null) assert(task.requiredLocalInputs[0].sha256 === result.source.sha256Before, 'Source does not match task');
      assert(result.execution.elapsedSeconds <= task.executionBudget.timeoutSeconds, 'Execution time budget exceeded');
      assert(required.every(name => result.artifacts.some(a => a.path === name)), 'Incomplete evidence inventory');
      assert(!result.checks.some(c => ['failed', 'missing', 'blocked'].includes(c.state)), 'Executor reported a failed or missing check');
    });
  } else errors.push({ code: result.state === 'blocked' ? 'PRIVATE_ASSETS_MISSING' : 'FILES_INVALID', message: `Local execution is ${result.state}; partial outputs cannot certify completion` });

  if (result.returnMode === 'metadata-only') {
    checks.push({ name: 'returned-file-bytes', state: 'unrun' });
    pendingChecks.push('returned-file-bytes');
  } else if (errors.length) {
    checks.push({ name: 'returned-file-bytes', state: 'unrun' });
    pendingChecks.push('returned-file-bytes');
  } else {
    const evidence = new Map();
    for (const artifact of result.artifacts) run(`evidence:${artifact.path}`, () => {
      assert(inputRoot, 'An authorized returned-evidence directory is required');
      const file = path.join(path.resolve(inputRoot), artifact.path);
      // Filename is an allowlisted basename from the strict schema; no .blend,
      // model.glb, original photos or arbitrary command/file paths enter here.
      const bytes = readBoundedFile(file, 33554432);
      assert(bytes.length === artifact.bytes && sha256(bytes) === artifact.sha256, 'Returned file length/digest differs');
      if (artifact.path.endsWith('.png')) {
        assert(bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.subarray(12,16).toString() === 'IHDR', 'Not a PNG evidence header');
        assert(bytes.readUInt32BE(16) === task.renderContract.scenario.width && bytes.readUInt32BE(20) === task.renderContract.scenario.height, 'Evidence image dimensions differ');
        validatePngEvidence(bytes, { width: task.renderContract.scenario.width, height: task.renderContract.scenario.height });
      }
      evidence.set(artifact.path, bytes);
    });
    if (result.state === 'completed' && evidence.has('validation.json')) run('blender-report-links', () => {
      const report = JSON.parse(evidence.get('validation.json').toString('utf8'));
      assert(report.status === 'rendered-not-approved', 'Renderer did not report completed unapproved renders');
      assert(report.sourceSha256 === result.source.sha256Before, 'Report source differs');
      assert(report.tools?.blender === result.tool.version, 'Report tool version differs');
      assert(JSON.stringify(report.scenario) === JSON.stringify(task.renderContract.scenario), 'Report scenario differs');
      const appearance = parseContract('appearance', report.design);
      assert(JSON.stringify(appearance) === JSON.stringify(task.appearance), 'Report appearance differs');
      for (const view of ['front', 'three', 'side']) {
        const artifact = result.artifacts.find(a => a.path === `${view}.png`);
        assert(artifact && report.images?.[view]?.sha256 === artifact.sha256, 'Report image identity differs');
      }
      if (report.fixtureOnly === true) pendingChecks.push('synthetic-evidence-not-production');
    });
  }
  return {
    valid: errors.length === 0, jobId: result.jobId,
    status: errors.length ? result.state === 'blocked' ? 'blocked' : 'failed' : result.returnMode === 'metadata-only' ? 'metadata-accepted-unverified' : 'evidence-integrity-verified-unapproved',
    scope: 'task-metadata-and-authorized-returned-file-integrity',
    checks, errors, pendingChecks: [...new Set(pendingChecks)], approved: false,
    productionIntegrationReady: false, inferenceExecuted: false, publishEnabled: false,
  };
}
