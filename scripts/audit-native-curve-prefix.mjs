/** CPU-only Native17 prefix compatibility. No Blender, browser, GL or new groom. */
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

const output='artifacts/native-curve-renderer/native17';await fs.mkdir(output,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
const arrayHash=x=>hash(Buffer.from(x.buffer,x.byteOffset,x.byteLength));
const legacyFile=path.join(output,'legacy-9-pack.snapshot.js');
try{await fs.access(legacyFile);}catch{
  const source='artifacts/native-curve-renderer/gpu-probe/probe.browser.js';
  const text=await fs.readFile(source,'utf8');
  if(text.includes('native-curve17-prefix-v2'))throw Error('Legacy oracle must come from the immutable nine-knot GPU probe.');
  const ast=ts.createSourceFile(source,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let found;
  function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='packNativeCurveData')found=node;else ts.forEachChild(node,visit);}visit(ast);
  if(!found)throw Error('Archived legacy pack function not found.');
  await fs.writeFile(legacyFile,'const NATIVE_CURVE_POINTS=9;const NATIVE_CURVE_TEXELS=10;\n'+found.getText(ast)+'\nglobalThis.legacyPack=packNativeCurveData;\n');
  await fs.writeFile(path.join(output,'legacy-oracle-provenance.json'),JSON.stringify({source,sourceSHA256:hash(text),scope:'Pack function extracted from the already GPU-tested nine-knot bundle; no renderer/browser function is executed.'},null,2)+'\n');
}
const legacyContext=vm.createContext({});vm.runInContext(await fs.readFile(legacyFile,'utf8'),legacyContext);
const compiled=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
import * as THREE from 'three';
import {packNativeCurveData,sampleNativeCurveCatmullRom,getNativeCurvePointCount}from'./lib/cat-native-curve-data';
import {createNativeCurveRenderer}from'./lib/cat-native-curve-renderer';
globalThis.__prefixAudit={THREE,packNativeCurveData,sampleNativeCurveCatmullRom,getNativeCurvePointCount,createNativeCurveRenderer};
`},bundle:true,write:false,platform:'node',format:'iife'});
vm.runInThisContext(compiled.outputFiles[0].text);
const{THREE,packNativeCurveData:pack,sampleNativeCurveCatmullRom:sample,getNativeCurvePointCount:countFor,createNativeCurveRenderer:create}=globalThis.__prefixAudit;
const checks=[];function check(name,pass,details){checks.push({name,pass:!!pass,...(details===undefined?{}:{details})});if(!pass)throw Error(name);}
const fail=fn=>{try{fn();return false;}catch{return true;}};
let oldEqual=true;const oldCases=[];
for(const count of[0,1,3,7]){
  const points=new Float32Array(count*27),radii=new Float32Array(count*9),colors=new Float32Array(count*3);
  for(let c=0;c<count;c++){colors.set([.13+c*.01,.3,.6],c*3);for(let n=0;n<9;n++){points.set([c*.1+n*.013,Math.sin(n*.71+c)*.03,n*.1],(c*9+n)*3);radii[c*9+n]=.001*(1-n/10);}}
  const input={points,radii,colors},options={maxTextureSize:16,preferredWidth:7},old=legacyContext.legacyPack(input,options),next=pack(input,options);
  const meta=p=>JSON.stringify({...p,data:null});const equal=arrayHash(old.data)===arrayHash(next.data)&&meta(old)===meta(next);
  oldEqual&&=equal;oldCases.push({count,equal,bytes:next.byteLength,dataSHA256:arrayHash(next.data)});
}
check('all legacy nine-knot packet bytes and metadata equal archived implementation',oldEqual,oldCases);

const counts=new Uint8Array([2,8,14,17]),N=counts.length;
const points=new Float32Array(N*17*3),radii=new Float32Array(N*17),colors=new Float32Array(N*3);
for(let c=0;c<N;c++){
  colors.set([.16+c*.1,.4,.6],c*3);
  for(let k=0;k<17;k++){const n=Math.min(k,counts[c]-1);points.set([10+c*.2+n*.012,1+Math.sin(n*.41+c)*.01,2+n*.021],(c*17+k)*3);radii[c*17+k]=k<counts[c]?.001*(1-n/(counts[c]+1)):100;}
}
const before=[points,radii,colors,counts].map(arrayHash);
const input={points,radii,colors,pointsPerCurve:17,pointCounts:counts};const packed=pack(input,{maxTextureSize:16,preferredWidth:7});
check('Native17 layout is explicit and packs eighteen texels across rows',packed.layout==='native-curve17-prefix-v2'&&packed.pointsPerCurve===17&&packed.texelsPerCurve===18&&packed.width===7&&packed.height===11);
let exact=true;for(let c=0;c<N;c++){const base=c*18*4;exact&&=packed.data[base+17*4+3]===counts[c]&&countFor(packed,c)===counts[c];for(let n=0;n<17;n++)for(let a=0;a<3;a++)exact&&=packed.data[base+n*4+a]===points[(c*17+n)*3+a];}
check('all original slots and each valid count survive without resampling',exact);
let knotError=0,endError=0;for(let c=0;c<N;c++){for(let n=0;n<counts[c];n++){const q=sample(packed,c,n/(counts[c]-1));for(let a=0;a<3;a++)knotError=Math.max(knotError,Math.abs(q.position[a]-points[(c*17+n)*3+a]));}for(let a=0;a<3;a++)endError=Math.max(endError,Math.abs(sample(packed,c,1).position[a]-points[(c*17+counts[c]-1)*3+a]));}
check('valid source knots and true short-child endpoints are retained',knotError<1e-12&&endError<1e-12,{knotError,endError});
let derivError=0,inside=true;for(let c=0;c<N;c++)for(let i=0;i<=200;i++){
  const t=i/200,q=sample(packed,c,t);for(let a=0;a<3;a++)inside&&=q.position[a]-q.radius>=packed.bounds.min[a]-1e-10&&q.position[a]+q.radius<=packed.bounds.max[a]+1e-10;
  if(i>0&&i<200){const h=1e-7,l=sample(packed,c,t-h),r=sample(packed,c,t+h);for(let a=0;a<3;a++)derivError=Math.max(derivError,Math.abs(q.derivative[a]-(r.position[a]-l.position[a])/(2*h)));}
}
check('variable-prefix analytic derivatives match finite differences',derivError<2e-6,{maximumError:derivError});
check('bounds contain valid curves without phantom origin or unused radii',inside&&packed.bounds.min[0]>9&&packed.maxRadius<.002,{bounds:packed.bounds,maxRadius:packed.maxRadius});
check('packing leaves points counts radii and linear colours unchanged',before.every((h,i)=>h===[points,radii,colors,counts].map(arrayHash)[i]));
const saved=packed.data.slice();counts[1]=3;points[0]=-99;
check('packed count and root remain independent after caller mutates input',countFor(packed,1)===8&&sample(packed,0,0).position[0]===10&&arrayHash(packed.data)===arrayHash(saved));
counts[1]=8;points[0]=10;
check('missing counts mean all seventeen points, not legacy alpha one',pack({points:new Float32Array(51),radii:new Float32Array([.001]),colors:new Float32Array([.1,.2,.3]),pointsPerCurve:17},{maxTextureSize:8}).data[17*4+3]===17);
const badPad=points.slice();badPad.set([0,0,0],(0*17+2)*3);
check('zero padding is rejected rather than drawing a child to origin',fail(()=>pack({...input,points:badPad},{maxTextureSize:16})));
check('prefix counts reject absent records wrong dtype and values outside 2..17',fail(()=>pack({...input,pointCounts:new Uint8Array([1,8,14,17])},{maxTextureSize:16}))&&fail(()=>pack({...input,pointCounts:new Uint8Array([2,8,14,18])},{maxTextureSize:16}))&&fail(()=>pack({...input,pointCounts:new Uint8Array(3)},{maxTextureSize:16}))&&fail(()=>pack({...input,pointCounts:new Uint16Array([2,8,14,17])},{maxTextureSize:16})));
check('unsupported point layouts and legacy prefix ambiguity reject',fail(()=>pack({...input,pointsPerCurve:13},{maxTextureSize:16}))&&fail(()=>pack({points:new Float32Array(27),radii:new Float32Array([.001]),colors:new Float32Array(3),pointCounts:new Uint8Array([8])},{maxTextureSize:8})));
const nonfinite=points.slice();nonfinite[0]=NaN;const negative=radii.slice();negative[0]=-.1;
check('Native17 validates finite coordinates radii and physical texture capacity',fail(()=>pack({...input,points:nonfinite},{maxTextureSize:16}))&&fail(()=>pack({...input,radii:negative},{maxTextureSize:16}))&&fail(()=>pack(input,{maxTextureSize:8})));
const preview=create(packed),shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};preview.material.onBeforeCompile(shader,{});
check('renderer exposes dynamic point/record uniforms and preserves vec4 colour fix',shader.uniforms.catNativeCurvePoints.value===17&&shader.uniforms.catNativeCurveTexels.value===18&&shader.vertexShader.includes('min( pointCount - 1, segment + 2 )')&&shader.vertexShader.includes('vColor.rgb = catNativeColor;')&&preview.getInfo().layout===packed.layout);
const corrupt={...packed,data:packed.data.slice()};corrupt.data[17*4+3]=1;
check('renderer rejects invalid packed prefix counts and untagged Native17',fail(()=>create(corrupt))&&fail(()=>create({...packed,layout:undefined})));
const disposed={geometry:0,material:0,texture:0};for(const[k,o]of Object.entries({geometry:preview.geometry,material:preview.material,texture:preview.texture}))o.addEventListener('dispose',()=>disposed[k]++);preview.dispose();preview.dispose();
check('Native17 owns and releases only its copied preview resources once',Object.values(disposed).every(x=>x===1)&&arrayHash(packed.data)===arrayHash(saved),disposed);
const empty=pack({points:new Float32Array(),radii:new Float32Array(),colors:new Float32Array(),pointsPerCurve:17,pointCounts:new Uint8Array()},{maxTextureSize:8});const emptyPreview=create(empty);check('empty Native17 record set is valid and hidden',empty.curveCount===0&&!emptyPreview.mesh.visible);emptyPreview.dispose();
const report={checkedAtUTC:new Date().toISOString(),pass:checks.every(x=>x.pass),checks,moduleSHA256:{data:hash(await fs.readFile('lib/cat-native-curve-data.ts')),renderer:hash(await fs.readFile('lib/cat-native-curve-renderer.ts'))},legacyOracleSHA256:hash(await fs.readFile(legacyFile)),limits:['CPU-only: no GPU compilation, native-asset appearance or performance acceptance.','Native17 stores all original cache points; Catmull interpolation is still a display model, not a claim of matching Blender Cycles curve interpolation.','Short records repeat endpoint XYZ; zero coordinates are never used to infer cache validity.']};
await fs.writeFile(path.join(output,'cpu-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:report.pass,checks:checks.length,moduleSHA256:report.moduleSHA256}));
