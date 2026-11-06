/** CPU equation oracle: pinned official Blender functions, no Blender/GPU. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const out = 'artifacts/native-groom-capture/optics-source-study';
await fs.mkdir(out, { recursive: true });
const sha = x => createHash('sha256').update(x).digest('hex');
const url = 'https://raw.githubusercontent.com/blender/blender/v3.6.23/intern/cycles/kernel/closure/bsdf_hair.h';
const upstream = execFileSync('curl', ['-fsSL', url], { encoding: 'utf8' });
const begin = upstream.indexOf('ccl_device Spectrum bsdf_hair_reflection_eval');
const end = upstream.indexOf('ccl_device int bsdf_hair_reflection_sample');
if (begin < 0 || end <= begin) throw Error('Pinned upstream evaluator markers missing.');
const sourceFunctions = upstream.slice(begin, end);
const bundled = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `import {evalNativeLegacyHair} from './lib/cat-native-hair-optics'; globalThis.__nativeHairOracle={evalNativeLegacyHair};` }, bundle: true, write: false, platform: 'node', format: 'iife' });
vm.runInThisContext(bundled.outputFiles[0].text);
const evaluate = globalThis.__nativeHairOracle.evalNativeLegacyHair;
const checks = [];
const check = (name, pass, details) => { checks.push({ name, pass: !!pass, ...(details === undefined ? {} : { details }) }); if (!pass) throw Error(name); };
const fixture = (id, component, thetaR, thetaI, phi, params = {}) => ({
  id,
  input: { component, normal: [0, 0, 1], tangent: [0, 1, 0], view: [0, Math.sin(thetaR), Math.cos(thetaR)], light: [Math.sin(phi) * Math.cos(thetaI), Math.sin(thetaI), Math.cos(phi) * Math.cos(thetaI)], roughnessU: .05, roughnessV: .3, offsetRadians: 0, ...params },
});
const fixtures = [];
for (const component of ['reflection', 'transmission']) {
  for (const thetaR of [-.4, 0, .4]) for (const thetaI of [-.6, 0, .6]) for (const phiDeviation of [0, .3]) {
    fixtures.push(fixture(`${component}-r${thetaR}-i${thetaI}-phi${phiDeviation}`, component, thetaR, thetaI, component === 'reflection' ? phiDeviation : Math.PI - phiDeviation));
  }
  fixtures.push(fixture(`${component}-wrong-hemisphere`, component, .1, .2, component === 'reflection' ? Math.PI : 0));
  fixtures.push(fixture(`${component}-offset-positive`, component, 0, -.16, component === 'reflection' ? 0 : Math.PI, { offsetRadians: .08 }));
  fixtures.push(fixture(`${component}-offset-negative`, component, 0, .16, component === 'reflection' ? .2 : Math.PI - .2, { offsetRadians: -.08 }));
  fixtures.push(fixture(`${component}-roughness-clamp-low`, component, .1, -.1, component === 'reflection' ? 0 : Math.PI, { roughnessU: 0, roughnessV: 0 }));
  fixtures.push(fixture(`${component}-roughness-clamp-high`, component, -.2, .3, component === 'reflection' ? .4 : Math.PI - .4, { roughnessU: 2, roughnessV: 2 }));
  fixtures.push(fixture(`${component}-near-light-pole`, component, 0, Math.PI / 2 - .0001, component === 'reflection' ? 0 : Math.PI));
}
const cpp = `#include <cmath>
#include <algorithm>
#include <iostream>
#include <iomanip>
#define ccl_device
#define ccl_private
#define M_PI_F 3.14159265358979323846f
#define M_PI_2_F 1.57079632679489661923f
struct float3 { float x,y,z; };
float dot(float3 a,float3 b){return a.x*b.x+a.y*b.y+a.z*b.z;}
float3 operator-(float3 a,float3 b){return {a.x-b.x,a.y-b.y,a.z-b.z};}
float3 operator*(float3 a,float b){return {a.x*b,a.y*b,a.z*b};}
float3 normalize(float3 a){float l=std::sqrt(dot(a,a));return {a.x/l,a.y/l,a.z/l};}
using Spectrum=float;
struct ShaderClosure {float3 N;};
struct HairBsdf {float3 N,T;float roughness1,roughness2,offset;};
float zero_spectrum(){return 0;}
float make_spectrum(float x){return x;}
float fast_acosf(float x){return std::acos(std::clamp(x,-1.0f,1.0f));}
float fast_atan2f(float y,float x){return std::atan2(y,x);}
float fast_cosf(float x){return std::cos(x);}
${sourceFunctions}
int main(){int component;HairBsdf bsdf;float3 wi,wo;float uiOffset;
while(std::cin>>component>>bsdf.N.x>>bsdf.N.y>>bsdf.N.z>>bsdf.T.x>>bsdf.T.y>>bsdf.T.z>>wi.x>>wi.y>>wi.z>>wo.x>>wo.y>>wo.z>>bsdf.roughness1>>bsdf.roughness2>>uiOffset){
 bsdf.N=normalize(bsdf.N);bsdf.T=normalize(bsdf.T);wi=normalize(wi);wo=normalize(wo);
 bsdf.roughness1=std::clamp(bsdf.roughness1,.001f,1.0f);bsdf.roughness2=std::clamp(bsdf.roughness2,.001f,1.0f);bsdf.offset=-uiOffset;
 float pdf=0;float value=component==0?bsdf_hair_reflection_eval((ShaderClosure*)&bsdf,wi,wo,&pdf):bsdf_hair_transmission_eval((ShaderClosure*)&bsdf,wi,wo,&pdf);
 std::cout<<std::setprecision(12)<<value<<" "<<pdf<<"\\n";
}}`;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'native-hair-oracle-'));
let rows;
try {
  await fs.writeFile(path.join(temp, 'oracle.cpp'), cpp);
  execFileSync('/usr/bin/clang++', ['-std=c++17', '-O2', path.join(temp, 'oracle.cpp'), '-o', path.join(temp, 'oracle')]);
  const input = fixtures.map(({ input: v }) => [v.component === 'reflection' ? 0 : 1, ...v.normal, ...v.tangent, ...v.view, ...v.light, v.roughnessU, v.roughnessV, v.offsetRadians].join(' ')).join('\n') + '\n';
  rows = execFileSync(path.join(temp, 'oracle'), [], { input, encoding: 'utf8' }).trim().split('\n').map(row => row.trim().split(/\s+/).map(Number));
} finally { await fs.rm(temp, { recursive: true, force: true }); }
let maxAbsoluteError = 0, maxRelativeError = 0;
for (let i = 0; i < fixtures.length; i++) {
  const f = fixtures[i], result = evaluate(f.input), [evalCos, pdf] = rows[i];
  const abs = Math.abs(result.evalCos - evalCos), relative = abs / Math.max(Math.abs(evalCos), 1e-8);
  f.expected = { evalCos, pdf };
  f.cpu = result;
  f.absoluteError = abs;
  maxAbsoluteError = Math.max(maxAbsoluteError, abs); maxRelativeError = Math.max(maxRelativeError, relative);
}
check('pinned C float formula oracle agrees with JS double over representative fixtures', fixtures.every(f => Number.isFinite(f.expected.evalCos) && f.absoluteError <= 1e-5 + 2e-4 * Math.abs(f.expected.evalCos)), { cases: fixtures.length, absoluteTolerance: 1e-5, relativeTolerance: 2e-4, maxAbsoluteError, maxRelativeError });
check('per-closure source eval equals its own PDF', fixtures.every(f => f.expected.evalCos === f.expected.pdf && f.cpu.evalCos === f.cpu.pdf));
const rPeak = evaluate(fixture('r', 'reflection', 0, 0, 0).input).evalCos;
const tPeak = evaluate(fixture('t', 'transmission', 0, 0, Math.PI).input).evalCos;
check('independent normal-incidence peak formula matches', Math.abs(rPeak - 1 / (16 * .05 * .3 * Math.atan(Math.PI / (.2)))) < 1e-12 && Math.abs(tPeak - 1 / (8 * .05 * .3 * Math.atan(Math.PI / (.2)) * Math.atan(Math.PI / (.6)))) < 1e-12, { reflection: rPeak, transmission: tPeak });
check('positive UI offset shifts longitudinal peak toward negative incident angle', evaluate(fixture('offset', 'reflection', 0, -.16, 0, { offsetRadians: .08 }).input).evalCos > evaluate(fixture('offset', 'reflection', 0, .16, 0, { offsetRadians: .08 }).input).evalCos);
const bad = fixture('bad', 'reflection', 0, 0, 0).input;
check('tangent-pole and zero-length directions return explicit guarded zero', evaluate({ ...bad, view: [0, 1, 0] }).valid === false && evaluate({ ...bad, normal: [0, 0, 0] }).valid === false);
let threw = false; try { evaluate({ ...bad, roughnessU: NaN }); } catch { threw = true; }
check('nonfinite material data rejects', threw);
const before = JSON.stringify(bad); evaluate(bad); check('input data is not mutated', JSON.stringify(bad) === before);
// Independently check the real-arithmetic error bound of the GLSL range-
// reduced atan approximation. This is not a GPU Float32 arithmetic test.
const reducedAtan = x => {
  const a = Math.abs(x), invert = a > 1, r = invert ? 1 / a : a;
  const u = r / (1 + Math.sqrt(1 + r * r));
  let sum = 0;
  for (let k = 0; k < 8; k++) sum += (k % 2 ? -1 : 1) * u ** (2 * k + 1) / (2 * k + 1);
  const angle = 2 * sum;
  return Math.sign(x) * (invert ? Math.PI / 2 - angle : angle);
};
let atanMaxError = 0;
for (let i = -10000; i <= 10000; i++) {
  const x = i / 10000;
  atanMaxError = Math.max(atanMaxError, Math.abs(reducedAtan(x) - Math.atan(x)));
  if (x !== 0) atanMaxError = Math.max(atanMaxError, Math.abs(reducedAtan(1 / x) - Math.atan(1 / x)));
}
check('eight-term range-reduced atan real-arithmetic bound over signed reciprocal grid', atanMaxError < 3.7e-8, { gridPoints: 40001, maxAbsoluteRadians: atanMaxError, scope: 'Double polynomial reference, not driver shader arithmetic.' });
const closurePath = 'artifacts/native-groom-capture/kitten-original-viewport-child8/active-source-hair-closures.json';
const report = {
  checkedAtUTC: new Date().toISOString(), pass: checks.every(c => c.pass),
  schema: { input: 'NativeLegacyHairEvalInput: all directions point away from surface, normal/tangent/view/light are xyz', expected: 'bare C float closure evalCos and same closure PDF; no RGB weight, N.L, or 1/pi applied', components: ['reflection', 'transmission'] },
  source: { url, sha256: sha(upstream), tag: 'v3.6.23', functions: ['bsdf_hair_reflection_eval', 'bsdf_hair_transmission_eval'], implementation: 'Exact original function text is compiled transiently; standard libm replaces fast_acosf/fast_atan2f/fast_cosf. Setup clamps and UI-offset negation follow original source.', wrapperSHA256: sha(cpp), closureAudit: closurePath, closureAuditSHA256: sha(await fs.readFile(closurePath)) },
  moduleSHA256: sha(await fs.readFile('lib/cat-native-hair-optics.ts')), validation: { checks, maxAbsoluteError, maxRelativeError }, fixtures,
  limits: ['Equation parity, not bitwise Cycles fast-math or a rendered source-image match.', 'Each fixture is one bare closure; active source graph adds reflection and transmission with its original shared scene-linear RGB.', 'Round cross-section visibility, self-shadowing, indirect transport and multiple scattering are not evaluated here.', 'No source asset, application, renderer or default changed; no Blender, browser or GPU ran.'],
};
await fs.writeFile(out + '/cpu-oracle.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pass: report.pass, cases: fixtures.length, checks: checks.length, maxAbsoluteError, maxRelativeError, moduleSHA256: report.moduleSHA256 }));
