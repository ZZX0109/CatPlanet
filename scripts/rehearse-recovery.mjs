import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { defaultCreatorDesign, parseCreatorDesign } from '../lib/cat-creator-design.ts';

const root = path.resolve(import.meta.dirname, '..');
let connection;
try { connection = new URL(process.env.DATABASE_URL ?? ''); }
catch { throw new Error('A valid local DATABASE_URL is required for the recovery rehearsal'); }
if (!['localhost', '127.0.0.1'].includes(connection.hostname) || connection.port !== '54329' || connection.pathname !== '/miaoxing')
  throw new Error('Recovery rehearsal requires the dedicated local compose database');
const registry = JSON.parse(await readFile(path.join(root, 'lib/room-model-assets.json'), 'utf8'));
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const names = [`miaoxing_drill_${suffix}_source`, `miaoxing_drill_${suffix}_restore`];
const databaseName = name => {
  if (!/^miaoxing_drill_[a-f0-9]{12}_(source|restore)$/.test(name)) throw new Error('Invalid temporary database name');
  return `"${name}"`;
};
const admin = new pg.Pool({ connectionString: connection.href, max: 1, connectionTimeoutMillis: 5000 });
const pools = [];
const created = [];
let temporary;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { checkedAt: new Date().toISOString(), scope: 'local-isolated-fixtures', database: false, photo: false, cleanedUp: false, tables: {} };

async function runDatabaseTool(tool, database, file, write) {
  const args = tool === 'pg_dump' ? ['-Fc', '--no-owner', '--no-acl', '-U', 'miaoxing', '-d', database]
    : ['--exit-on-error', '--no-owner', '--no-acl', '-U', 'miaoxing', '-d', database];
  const child = spawn('docker', ['compose', 'exec', '-T', 'db', tool, ...args], { cwd: root, stdio: [write ? 'ignore' : 'pipe', write ? 'pipe' : 'ignore', 'pipe'] });
  // Consume diagnostics without exposing records or connection details in output.
  child.stderr.resume();
  const complete = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${tool} failed with exit code ${code}`)));
  });
  const transfer = write ? pipeline(child.stdout, createWriteStream(file, { flags: 'wx', mode: 0o600 }))
    : pipeline(createReadStream(file), child.stdin);
  await Promise.all([complete, transfer]);
}
async function signatures(pool) {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const result = {};
  for (const { tablename } of tables) {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error('Unexpected table identifier');
    const row = (await pool.query(`SELECT count(*)::integer AS rows,md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "${tablename}" t`)).rows[0];
    result[tablename] = row;
  }
  return result;
}
try {
  await mkdir(path.join(root, '.data'), { recursive: true, mode: 0o700 });
  temporary = await mkdtemp(path.join(root, '.data', 'recovery-drill-'));
  for (const name of names) {
    await admin.query(`CREATE DATABASE ${databaseName(name)}`);
    created.push(name);
    const url = new URL(connection); url.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 5000 });
    await pool.query("SET timezone='UTC'");
    pools.push(pool);
  }
  const [source, restored] = pools;
  await source.query(await readFile(path.join(root, 'db/schema.sql'), 'utf8'));
  const owner = randomUUID(), photo = randomUUID(), memory = randomUUID();
  const appearance = parseCreatorDesign({ ...defaultCreatorDesign, shape: { ...defaultCreatorDesign.shape, headWidth: 68 } });
  const timestamp = '2026-11-04T08:00:00.000Z';
  await source.query('INSERT INTO users(id,email) VALUES($1,$2)', [owner, `recovery-${owner}@example.test`]);
  await source.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', ['fixture-token-hash', owner, '2027-01-01T00:00:00Z']);
  await source.query('INSERT INTO challenges(email,code_hash,expires_at) VALUES($1,$2,$3)', ['recovery@example.test', 'fixture-code-hash', '2027-01-01T00:00:00Z']);
  await source.query('INSERT INTO rate_limits(key,count,resets_at) VALUES($1,1,$2)', ['fixture-rate-key', '2027-01-01T00:00:00Z']);
  await source.query('INSERT INTO pets(user_id,name,model,personality,photo_id,version,appearance,appearance_asset) VALUES($1,$2,$3,$4,$5,3,$6,$7)', [owner, '恢复演练猫', 'toon', '喜欢窗边', photo, JSON.stringify(appearance), registry.current.norwegian]);
  await source.query('INSERT INTO memories(id,user_id,text,position) VALUES($1,$2,$3,0)', [memory, owner, '测试回忆：一起度过的午后']);
  await source.query('INSERT INTO photos(id,user_id,storage_key) VALUES($1,$2,$3)', [photo, owner, `${photo}.webp`]);
  await source.query("INSERT INTO deletion_queue(storage_key) VALUES('fixture-unused.webp')");
  await source.query('INSERT INTO pet_life(user_id,last_slot,started_at,updated_at) VALUES($1,498248,$2,$2)', [owner, timestamp]);
  await source.query("INSERT INTO pet_life_events(user_id,slot,action,occurred_at) VALUES($1,498247,'walk',$2),($1,498248,'sleep',$3)", [owner, '2026-11-04T07:00:00Z', timestamp]);
  const originalPhoto = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#bf9071' } }).webp().toBuffer();
  const photoKey = `${photo}.webp`;
  const sourcePhotos = path.join(temporary, 'source', 'photos');
  const backupPhotos = path.join(temporary, 'backup', 'photos');
  const restoredPhotos = path.join(temporary, 'restore', 'photos');
  for (const directory of [sourcePhotos, backupPhotos, restoredPhotos]) await mkdir(directory, { recursive: true, mode: 0o700 });
  const originalPath = path.join(sourcePhotos, photoKey);
  const backupPath = path.join(backupPhotos, photoKey);
  const restoredPath = path.join(restoredPhotos, photoKey);
  await writeFile(originalPath, originalPhoto, { mode: 0o600, flag: 'wx' });
  await copyFile(originalPath, backupPath);
  const before = await signatures(source);
  const dump = path.join(temporary, 'database.dump');
  await runDatabaseTool('pg_dump', names[0], dump, true);
  await runDatabaseTool('pg_restore', names[1], dump, false);
  const after = await signatures(restored);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Restored table records differ');
  const restoredAsset = (await restored.query('SELECT appearance_asset FROM pets WHERE user_id=$1', [owner])).rows[0].appearance_asset;
  const asset = registry.assets[restoredAsset];
  if (!asset || sha(await readFile(path.join(root, 'public', asset.url))) !== asset.sha256) throw new Error('Restored model reference cannot be resolved');
  report.database = true;
  for (const [table, value] of Object.entries(after)) report.tables[table] = { rows: value.rows, matched: true };
  // Exercise the same separate-file requirement as local private photo storage.
  await copyFile(backupPath, restoredPath);
  const photoBytes = await readFile(restoredPath);
  const image = await sharp(photoBytes).metadata();
  if (sha(photoBytes) !== sha(originalPhoto) || image.width !== 24 || image.height !== 24) throw new Error('Restored photo differs');
  const restoredKey = (await restored.query('SELECT storage_key FROM photos WHERE id=$1', [photo])).rows[0].storage_key;
  if (restoredKey !== photoKey) throw new Error('Restored photo association differs');
  report.photo = true;
  report.photoSha256 = sha(photoBytes);
} finally {
  await Promise.all(pools.map(pool => pool.end()));
  for (const name of created.reverse()) await admin.query(`DROP DATABASE ${databaseName(name)}`);
  await admin.end();
  if (temporary) await rm(temporary, { recursive: true, force: true });
  report.cleanedUp = true;
  await mkdir(path.join(root, 'artifacts/recovery'), { recursive: true });
  await writeFile(path.join(root, 'artifacts/recovery/latest.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log('Local recovery rehearsal passed: database records, model references and photo bytes match; temporary resources removed');
