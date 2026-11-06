import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Historical entry point retained. The first architecture repair deliberately
// does not activate new room assets: licensing and visual approval are pending.
const root = new URL('../', import.meta.url);
const registry = JSON.parse(await readFile(new URL('lib/room-model-assets.json', root), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
const confirmAt = args.indexOf('--confirm');
const confirmation = confirmAt < 0 ? null : args[confirmAt + 1];
const flags = new Set(['--check', '--plan', '--local-review-only', '--confirm']);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--confirm') { if (!args[++i] || args[i].startsWith('--')) throw new Error('--confirm requires the exact plan digest'); }
  else if (!flags.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
}
if (args.includes('--check')) {
  if (args.length !== 1) throw new Error('--check cannot be combined with publishing options');
  for (const [id, asset] of Object.entries(registry.assets)) {
    const bytes = await readFile(new URL(`public${asset.url}`, root));
    if (digest(bytes) !== asset.sha256 || bytes.length !== asset.bytes) throw new Error(`Archive integrity failed: ${id}`);
  }
  if (!registry.current.norwegian || !registry.current.sphynx) throw new Error('Both room bases must be registered');
  console.log(`Verified ${Object.keys(registry.assets).length} immutable room assets`);
} else {
  const sources = [];
  for (const base of ['norwegian', 'sphynx']) {
    const bytes = await readFile(new URL(`public/models/creator/${base}-cat.glb`, root));
    if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Invalid GLB: ${base}`);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    for (const item of [...(json.buffers ?? []), ...(json.images ?? [])])
      if (item.uri && !item.uri.startsWith('data:')) throw new Error(`External GLB dependency: ${base}`);
    sources.push({ base, bytes, assetRevision: digest(bytes), distribution: 'local-only-unverified' });
  }
  const plan = { operation: 'restricted-local-review', assets: sources.map(({ bytes, ...item }) => ({ ...item, bytes: bytes.length })) };
  const planDigest = digest(JSON.stringify(plan));
  if (args.includes('--plan')) {
    if (args.length !== 1) throw new Error('--plan is read-only and cannot be combined with other options');
    console.log(JSON.stringify({ ...plan, confirmationRequired: planDigest, activation: false }, null, 2));
  } else {
    if (!args.includes('--local-review-only'))
      throw new Error('Publication blocked: source redistribution permission and visual acceptance are unverified. Use --plan for a read-only restricted-review plan. No room registry was changed.');
    if (confirmation !== planDigest)
      throw new Error(`Explicit confirmation for these exact source bytes required: --local-review-only --confirm ${planDigest}`);
    const review = new URL(`.data/cat-model-review/${planDigest}/`, root);
    await mkdir(review, { recursive: true, mode: 0o700 });
    for (const source of sources) {
      const target = new URL(`${source.base}.glb`, review);
      try { await writeFile(target, source.bytes, { flag: 'wx', mode: 0o600 }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (digest(await readFile(target)) !== source.assetRevision) throw new Error('Refusing to overwrite a review asset');
      }
    }
    const reviewMetadata = JSON.stringify({ ...plan, planDigest, activation: false }, null, 2);
    const reviewPath = new URL('review.json', review);
    try { await writeFile(reviewPath, reviewMetadata, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await readFile(reviewPath, 'utf8') !== reviewMetadata) throw new Error('Refusing to overwrite review metadata');
    }
    console.log(`Restricted review staged at ${fileURLToPath(review)}; room registry and current assets unchanged.`);
  }
}
