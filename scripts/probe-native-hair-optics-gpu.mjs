/** Numerical GPU port check against independently compiled official C functions. */
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const fixtureFile = process.argv[2] ?? "artifacts/native-groom-capture/optics-source-study/cpu-oracle.json";
const fixtureBytes = await readFile(fixtureFile), fixtures = JSON.parse(fixtureBytes).fixtures;
if (!fixtures?.length) throw Error("Independent source-function fixtures are required");
const output = "artifacts/native-groom-capture/optics-source-study/gpu-oracle";
await mkdir(output, { recursive: true });
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
import * as THREE from 'three';
import {NATIVE_LEGACY_HAIR_GLSL} from './lib/cat-native-hair-optics';
window.probeNativeHairNumerics=(fixtures)=>{
 const renderer=new THREE.WebGLRenderer({alpha:false,antialias:false});renderer.setSize(1,1);
 if(!renderer.extensions.has('EXT_color_buffer_float'))throw Error('Float colour target unavailable');
 const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:false,stencilBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});target.texture.internalFormat='RGBA32F';target.texture.colorSpace=THREE.NoColorSpace;
 const uniforms={mode:{value:0},N:{value:new THREE.Vector3()},T:{value:new THREE.Vector3()},V:{value:new THREE.Vector3()},L:{value:new THREE.Vector3()},UV:{value:new THREE.Vector2()},offset:{value:0}};
 const material=new THREE.RawShaderMaterial({uniforms,glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false,
  vertexShader:'precision highp float;in vec3 position;void main(){gl_Position=vec4(position,1.0);}',
  fragmentShader:'precision highp float;precision highp int;uniform int mode;uniform vec3 N,T,V,L;uniform vec2 UV;uniform float offset;out vec4 outputValue;'+NATIVE_LEGACY_HAIR_GLSL+'void main(){vec2 value=catNativeLegacyHairEval(mode,N,T,V,L,UV,offset);outputValue=vec4(value,0.0,1.0);}'
 });
 const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene(),camera=new THREE.Camera();scene.add(new THREE.Mesh(geometry,material));
 const results=[];renderer.setRenderTarget(target);
 for(const fixture of fixtures){const input=fixture.input;uniforms.mode.value=input.component==='reflection'?0:1;for(const [key,field] of [['N','normal'],['T','tangent'],['V','view'],['L','light']])uniforms[key].value.fromArray(input[field]);uniforms.UV.value.set(input.roughnessU,input.roughnessV);uniforms.offset.value=input.offsetRadians;renderer.render(scene,camera);const pixel=new Float32Array(4);renderer.readRenderTargetPixels(target,0,0,1,1,pixel);results.push({id:fixture.id,evalCos:pixel[0],pdf:pixel[1],finite:Array.from(pixel).every(Number.isFinite)});}
 const gl=renderer.getContext(),glError=gl.getError(),programs=renderer.info.programs.map(p=>({runnable:p.diagnostics?.runnable??true,log:p.diagnostics?.programLog??''}));geometry.dispose();material.dispose();target.dispose();renderer.dispose();return {results,glError,programs};
};
` }, bundle: true, platform: "browser", format: "iife", target: "es2022", write: false });
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
try {
  await page.route("**/__native-hair-numeric-probe", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><link rel="icon" href="data:,">' }));
  await page.goto("http://localhost:3000/__native-hair-numeric-probe");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const actual = await page.evaluate(fixtures => window.probeNativeHairNumerics(fixtures), fixtures);
  const comparisons = fixtures.map((fixture, i) => {
    const gpu = actual.results[i], expected = fixture.expected;
    const absoluteError = Math.max(Math.abs(gpu.evalCos - expected.evalCos), Math.abs(gpu.pdf - expected.pdf));
    // Float32 GPU trig vs independently compiled scalar standard-libm source.
    // Keep this tolerance explicit, inspect every near-grazing/clamp case.
    const tolerance = 1e-5 + 2e-4 * Math.max(Math.abs(expected.evalCos), Math.abs(expected.pdf));
    return { id: fixture.id, input: fixture.input, expected, gpu, absoluteError, tolerance, pass: gpu.finite && absoluteError <= tolerance };
  });
  const pass = !errors.length && !actual.glError && actual.programs.every(p => p.runnable) && comparisons.every(c => c.pass);
  await writeFile(`${output}/report.json`, JSON.stringify({ status: "numerical legacy Hair BSDF evaluator port only; not photorealistic/path-tracing acceptance", pass, fixtureFile, fixtureSHA256: createHash("sha256").update(fixtureBytes).digest("hex"), shaderSHA256: createHash("sha256").update(await readFile("lib/cat-native-hair-optics.ts")).digest("hex"), errors, glError: actual.glError, programs: actual.programs, comparisons, maximumAbsoluteError: Math.max(...comparisons.map(c => c.absoluteError)), failed: comparisons.filter(c => !c.pass).map(c => c.id) }, null, 2) + "\n");
  console.log(JSON.stringify({ pass, fixtures: comparisons.length, failed: comparisons.filter(c => !c.pass).map(c => ({ id: c.id, error: c.absoluteError, tolerance: c.tolerance })), errors, output }));
  if (!pass) process.exitCode = 1;
} finally { await browser.close(); }
