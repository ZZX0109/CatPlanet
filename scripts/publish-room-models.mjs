import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const registryPath = new URL('lib/room-model-assets.json', root);
let registry;
try { registry = JSON.parse(await readFile(registryPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; registry = { format: 1, current: {}, assets: {} }; }
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.argv.includes('--check')) {
  for (const [id, asset] of Object.entries(registry.assets)) {
    const bytes = await readFile(new URL(`public${asset.url}`, root));
    if (digest(bytes) !== asset.sha256 || bytes.length !== asset.bytes) throw new Error(`Archive integrity failed: ${id}`);
  }
  if (!registry.current.norwegian || !registry.current.sphynx) throw new Error('Both room bases must be registered');
  console.log(`Verified ${Object.keys(registry.assets).length} immutable room assets`);
} else {
  await mkdir(new URL('public/models/room/', root), { recursive: true });
  for (const base of ['norwegian', 'sphynx']) {
    const bytes = await readFile(new URL(`public/models/creator/${base}-cat.glb`, root));
    if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Invalid GLB: ${base}`);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
      if (item.uri && !item.uri.startsWith('data:')) throw new Error(`External GLB dependency: ${base}`);
    }
    const sha256 = digest(bytes);
    const id = `${base}-${sha256}`;
    const url = `/models/room/${id}.glb`;
    const destination = new URL(`public${url}`, root);
    try { await writeFile(destination, bytes, { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (digest(await readFile(destination)) !== sha256) throw new Error(`Refusing to overwrite archive: ${id}`);
    }
    registry.assets[id] ??= { base, url, sha256, bytes: bytes.length, templateId: 'cat-foundation-v1', schemaVersion: 4, facing: 0, roomSize: 1.5, distribution: 'local-only-unverified' };
    registry.current[base] = id;
  }
  const temporary = new URL('lib/room-model-assets.json.tmp', root);
  await writeFile(temporary, JSON.stringify(registry, null, 2) + '\n');
  await rename(temporary, registryPath);
  console.log(`Registered ${Object.keys(registry.assets).length} immutable room assets; existing archives retained`);
}
