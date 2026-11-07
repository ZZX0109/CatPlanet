import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generatedSchemas } from '../contracts/generate-schemas.mjs';

test('all cross-language schemas match the authoritative runtime contract', () => {
  const legacyDirectory = new URL('../schemas/', import.meta.url);
  const legacyIds = new Set(fs.readdirSync(legacyDirectory).filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(new URL(name, legacyDirectory), 'utf8')).$id));
  for (const [name, document] of Object.entries(generatedSchemas())) {
    const file = new URL(`../contracts/${name}.schema.json`, import.meta.url);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), document, `${name} schema drift`);
    assert.equal(legacyIds.has(document.$id), false, `${name} must not collide with legacy fixture schema IDs`);
  }
});
