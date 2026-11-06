/** Snapshot current production modules for a read-only CPU audit, no browser. */
import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { createHash } from "node:crypto";
const output = process.argv[2];
if (!output) throw new Error("Pass an output .js path.");
const result = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `
import {Texture,SRGBColorSpace,Box3,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ownCreatorModel,applyCreatorDesign} from './lib/cat-creator-model';
import {defaultCreatorDesign as studioDefaultCreatorDesign} from './lib/cat-creator-design';
import {getCatCoatProfile} from './lib/cat-coat-profiles';
import {createNorwegianFur} from './lib/norwegian-fur';
// This probe exercises the legacy groom explicitly; it does not describe the
// fresh studio's source-coat default.
const defaultCreatorDesign={...studioDefaultCreatorDesign,coatType:'short',coatMode:'groom',shape:{...studioDefaultCreatorDesign.shape,...getCatCoatProfile('short').defaults}};
window.__furFlowPerformance=async()=>({Texture,SRGBColorSpace,Box3,Vector3,GLTFLoader,
  ownCreatorModel,applyCreatorDesign,defaultCreatorDesign,getCatCoatProfile,createNorwegianFur});
`,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
});
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, result.outputFiles[0].text);
console.log(
  JSON.stringify({
    output,
    sha256: createHash("sha256")
      .update(result.outputFiles[0].text)
      .digest("hex"),
  }),
);
