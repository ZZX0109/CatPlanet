import pg from 'pg';
import { readFile } from 'node:fs/promises';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try { await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')); const registry = JSON.parse(await readFile(new URL('../lib/room-model-assets.json', import.meta.url), 'utf8'));
  await pool.query("UPDATE pets SET appearance_asset=CASE WHEN appearance->>'coatType'='hairless' THEN $1 ELSE $2 END WHERE appearance IS NOT NULL AND appearance<>'null'::jsonb AND appearance_asset IS NULL", [registry.current.sphynx, registry.current.norwegian]);
  console.log('Database ready'); }
finally { await pool.end(); }
