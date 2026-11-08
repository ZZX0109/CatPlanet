import { z } from 'zod';

/** Inject primitives to avoid a circular dependency on the contract registry. */
export function localExecutorSchemas({ HASH, JOB_ID, ID, appearanceSchema, coordinatesSchema, executionBudgetSchema }) {
  const check = z.strictObject({ name: z.string().min(1), state: z.enum(['passed', 'failed', 'missing', 'blocked', 'unrun']), details: z.string() });
  const filename = z.enum(['front.png', 'three.png', 'side.png', 'validation.json', 'execution.log']);
  const task = z.strictObject({
    handoffVersion: z.literal(1), jobId: JOB_ID, executor: z.literal('miaoxing-local-blender'), operation: z.literal('render-fixed-preview'),
    state: z.enum(['blocked-missing-or-invalid-assets', 'awaiting-authorized-local-source']), invokeInCloud: z.literal(false), requiredExecutable: z.literal('blender'),
    expectedTool: z.strictObject({ requiredBlenderVersion: z.string().regex(/^\d+\.\d+\.\d+$/).nullable(), versionResolution: z.string().min(1), state: z.enum(['unresolved', 'resolved']), templateId: z.literal('cat-foundation-v1'), topologyVersion: ID }),
    command: z.strictObject({ executable: z.literal('blender'), argv: z.array(z.string().min(1)).min(10).max(32), shell: z.literal(false), argvIsIllustrative: z.literal(true), substitutionsRequireLocalValidation: z.literal(true) }),
    requiredLocalInputs: z.array(z.strictObject({ name: z.literal('approved-source.blend'), state: z.literal('missing-unverified'), sha256: HASH.nullable(), authorization: z.string().min(1) })).length(1),
    script: z.strictObject({ path: z.literal('scripts/render-cat-validation.py'), sha256: HASH.nullable() }), requestSha256: HASH, assetRevision: HASH.nullable(), coordinates: coordinatesSchema, executionBudget: executionBudgetSchema, appearance: appearanceSchema,
    renderContract: z.strictObject({ path: z.literal('lib/cat-visual-scenario.json'), sha256: HASH.nullable(), scenario: z.record(z.string(), z.unknown()).nullable() }),
    requiredOutputs: z.tuple([z.literal('front.png'), z.literal('three.png'), z.literal('side.png'), z.literal('validation.json')]),
    requiredEvidence: z.array(z.string().min(1)).min(1), checks: z.array(check),
  });
  const result = z.strictObject({
    resultVersion: z.literal(1), jobId: JOB_ID, taskSha256: HASH, requestSha256: HASH,
    state: z.enum(['completed', 'failed', 'blocked']), returnMode: z.enum(['metadata-only', 'authorized-evidence']),
    authorization: z.strictObject({ localExecutionApproved: z.boolean(), evidenceReturnApproved: z.boolean(), evidenceRef: z.string().min(1).nullable() }),
    tool: z.strictObject({ name: z.literal('blender'), version: z.string().regex(/^\d+\.\d+\.\d+$/).nullable() }),
    source: z.strictObject({ sha256Before: HASH.nullable(), sha256After: HASH.nullable(), authorizationEvidence: z.string().min(1).nullable() }),
    scriptSha256: HASH.nullable(), scenarioSha256: HASH.nullable(),
    execution: z.strictObject({ commandExecuted: z.boolean(), exitCode: z.number().int().min(0).max(255).nullable(), timedOut: z.boolean(), elapsedSeconds: z.number().finite().min(0), failureStage: z.enum(['planning', 'load', 'render', 'export', 'transfer']).nullable() }),
    artifacts: z.array(z.strictObject({ path: filename, sha256: HASH, bytes: z.number().int().min(1).max(33554432) })).max(5),
    checks: z.array(check), limitations: z.array(z.string().min(1)).min(1),
  });
  return { 'local-task': task, 'local-result': result };
}

export function validateLocalSemantic(kind, value) {
  const reject = message => { throw Object.assign(Error(message), { code: 'CONTRACT_INVALID' }); };
  if (kind === 'local-task') {
    const expected = ['--background', '--disable-autoexec', '--threads', '2', '<approved-source.blend>', '--python-exit-code', '1', '--python', '<repository>/scripts/render-cat-validation.py', '--', '--design', '<isolated-job>/appearance.json', '--output', `<repository>/artifacts/local-preview-${value.jobId}`];
    if (JSON.stringify(value.command.argv) !== JSON.stringify(expected)) reject('Local task command differs from the fixed render operation');
    if ((value.expectedTool.state === 'resolved') !== (value.expectedTool.requiredBlenderVersion !== null)) reject('Local task tool resolution is inconsistent');
  }
  if (kind === 'local-result') {
    if (new Set(value.artifacts.map(a => a.path)).size !== value.artifacts.length) reject('Duplicate local evidence artifact');
    if (value.returnMode === 'authorized-evidence' && (!value.authorization.evidenceReturnApproved || !value.authorization.evidenceRef)) reject('Returning evidence files requires explicit authorization reference');
    if (value.state === 'completed') {
      if (!value.authorization.localExecutionApproved || !value.authorization.evidenceRef || !value.execution.commandExecuted || value.execution.exitCode !== 0 || value.execution.timedOut || value.execution.failureStage !== null) reject('Completed local result must have approved successful execution');
      if (!value.tool.version || !value.source.sha256Before || value.source.sha256Before !== value.source.sha256After || !value.source.authorizationEvidence || !value.scriptSha256 || !value.scenarioSha256) reject('Completed local result lacks version, authorization or unchanged source evidence');
      if (value.artifacts.length !== 5) reject('Completed local result requires three views, validation and a redacted execution log');
      for (const name of ['input-integrity', 'source-unchanged', 'tool-version', 'render-completed', 'output-integrity'])
        if (!value.checks.some(check => check.name === name && check.state === 'passed')) reject(`Completed local result lacks required check: ${name}`);
    }
  }
}
