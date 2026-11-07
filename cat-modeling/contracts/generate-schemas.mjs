import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { schemas } from './index.mjs';

export function generatedSchemas() {
  return Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, {
    ...z.toJSONSchema(schema, { target: 'draft-2020-12' }),
    $id: `urn:miaoxing:cat-modeling:contracts:${name}:1`,
  }]));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check', '--write'].includes(args[0])) {
    console.error('Usage: node cat-modeling/contracts/generate-schemas.mjs --check|--write');
    process.exitCode = 2;
  } else {
    const differences = [];
    for (const [name, document] of Object.entries(generatedSchemas())) {
      const path = new URL(`${name}.schema.json`, import.meta.url);
      const expected = JSON.stringify(document, null, 2) + '\n';
      if (args[0] === '--write') fs.writeFileSync(path, expected);
      else if (fs.readFileSync(path, 'utf8') !== expected) differences.push(name);
    }
    console.log(JSON.stringify({ mode: args[0], schemas: Object.keys(schemas).length, differences }));
    if (differences.length) process.exitCode = 1;
  }
}
