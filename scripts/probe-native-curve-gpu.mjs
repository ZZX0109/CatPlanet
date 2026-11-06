/** Synthetic data fidelity probe, not a cat groom or a visual-quality claim. */
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const pointColorMode = process.argv.includes("--point-colors");
const native17 = pointColorMode || process.argv.includes("--native17");
const output = pointColorMode ? "artifacts/native-curve-renderer/gpu-probe-point-colors" : native17 ? "artifacts/native-curve-renderer/gpu-probe-native17" : "artifacts/native-curve-renderer/gpu-probe";
await mkdir(output, { recursive: true });
const result = await build({ stdin: { resolveDir: process.cwd(), contents: `
import * as THREE from 'three';
import {packNativeCurveData} from './lib/cat-native-curve-data';
import {createNativeCurveRenderer} from './lib/cat-native-curve-renderer';
import {createCatFurCompositor} from './lib/cat-fur-compositor';
import {createCatFurMaterial,configureCatFurMaterial} from './lib/cat-fur-material';
window.runProbe=()=>{
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
 renderer.setSize(384,384);renderer.setPixelRatio(1);renderer.toneMapping=THREE.AgXToneMapping;document.body.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color(0,0,0);
 scene.add(new THREE.HemisphereLight(0xffffff,0xffffff,2));
 const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(-2,3,4);scene.add(light);
 const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,10);camera.position.set(0,0,3);camera.lookAt(0,0,0);
 const capacity=${native17 ? 17 : 9},counts=${native17 ? "new Uint8Array([8,17])" : "null"};
 const points=new Float32Array(2*capacity*3),radii=new Float32Array(2*capacity).fill(.025),colors=new Float32Array([.8,.05,.02,.02,.7,.04]);
 const pointColors=new Float32Array(2*capacity*3);
 for(let c=0;c<2;c++)for(let i=0;i<capacity;i++){const n=counts?counts[c]:capacity,t=Math.min(i,n-1)/(n-1);points.set([(c===0?-.5:.5)+(counts&&c===0?.11*Math.sin(t*Math.PI*4):.08*Math.sin(t*Math.PI)),-.6+t*1.2,0],(c*capacity+i)*3);}
 for(let c=0;c<2;c++)for(let i=0;i<capacity;i++){const n=counts?counts[c]:capacity,t=Math.min(i,n-1)/(n-1),gain=.2+.8*t*t;for(let a=0;a<3;a++)pointColors[(c*capacity+i)*3+a]=colors[c*3+a]*gain;}
 const packed=packNativeCurveData({points,radii,colors${native17 ? ",pointsPerCurve:17,pointCounts:counts" : ""}${pointColorMode ? ",pointColors" : ""}},{maxTextureSize:renderer.capabilities.maxTextureSize,preferredWidth:16});
 const resource=createNativeCurveRenderer(packed,{segments:16});scene.add(resource.mesh);
 const plane=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({color:new THREE.Color(.18,.18,.18)}));plane.position.z=.5;plane.visible=false;scene.add(plane);
 const compositor=createCatFurCompositor(renderer);
 const inspect=()=>{const gl=renderer.getContext(),pixels=new Uint8Array(384*384*4);gl.readPixels(0,0,384,384,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let red=0,green=0,rx=0,gx=0;for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2],x=(i/4)%384;if(r>g*1.4&&r>b*1.4&&r>5){red++;rx+=x;}if(g>r*1.4&&g>b*1.4&&g>5){green++;gx+=x;}}return {red,green,redMeanX:red?rx/red:null,greenMeanX:green?gx/green:null,glError:gl.getError(),programs:renderer.info.programs.map(p=>({runnable:p.diagnostics?.runnable??true,log:p.diagnostics?.programLog??''}))};};
 const ownSample=(curve,t)=>{const n=counts?counts[curve]:capacity,s=t*(n-1),i=Math.min(n-2,Math.floor(s)),u=s-i,get=(k,a)=>points[(curve*capacity+Math.min(n-1,Math.max(0,k)))*3+a],p=[],d=[];for(let a=0;a<3;a++){const p0=get(i-1,a),p1=get(i,a),p2=get(i+1,a),p3=get(i+2,a),A=-p0+p2,B=2*p0-5*p1+4*p2-p3,C=-p0+3*p1-3*p2+p3;p.push(.5*(2*p1+A*u+B*u*u+C*u*u*u));d.push(.5*(A+2*B*u+3*C*u*u));}return {p,d};};
 const ownColor=(curve,t)=>{if(!${pointColorMode})return Array.from(colors.subarray(curve*3,curve*3+3));const n=counts?counts[curve]:capacity,s=t*(n-1),i=Math.min(n-2,Math.floor(s)),u=s-i;return [0,1,2].map(a=>pointColors[(curve*capacity+i)*3+a]*(1-u)+pointColors[(curve*capacity+i+1)*3+a]*u);};
 const p=[],norm=[],col=[],uv=[],width=[],idx=[];
 for(let c=0;c<2;c++)for(let j=0;j<=16;j++){const {p:center,d}=ownSample(c,j/16),l=Math.hypot(d[0],d[1]),span=[d[1]/l,-d[0]/l,0],radius=radii[c*capacity],base=c*34+j*2,color=ownColor(c,j/16);for(let side=0;side<2;side++){for(let a=0;a<3;a++){p.push(center[a]+(side*2-1)*span[a]*radius);width.push(span[a]*radius);col.push(color[a]);}norm.push(0,0,1);uv.push(side,j/16);}if(j<16)idx.push(base,base+1,base+2,base+1,base+3,base+2);}
 const cg=new THREE.BufferGeometry();for(const [name,data,size]of[['position',p,3],['normal',norm,3],['color',col,3],['uv',uv,2],['furWidth',width,3]])cg.setAttribute(name,new THREE.Float32BufferAttribute(data,size));cg.setIndex(idx);
 const cm=createCatFurMaterial();configureCatFurMaterial(cm,{coatType:'short',detailLevel:1,coverageFilter:'legacy'});const cpu=new THREE.Mesh(cg,cm);cpu.visible=false;scene.add(cpu);
 const read=()=>{const gl=renderer.getContext(),a=new Uint8Array(384*384*4);gl.readPixels(0,0,384,384,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;};
 window.nativeProbe={renderer,scene,camera,resource,plane,compositor,inspect,packed,cpu,read};
 renderer.render(scene,camera);window.nativeProbe.directPixels=read();return {...inspect(),resource:resource.getInfo(),texture:[packed.width,packed.height]};
};
window.compareProbeCPU=()=>{const p=window.nativeProbe;p.resource.mesh.visible=false;p.cpu.visible=true;p.renderer.render(p.scene,p.camera);const actual=p.read(),expected=p.directPixels;let sum=0,max=0,changed=0;for(let i=0;i<actual.length;i+=4){let pixel=0;for(let c=0;c<3;c++){const d=Math.abs(actual[i+c]-expected[i+c]);sum+=d;max=Math.max(max,d);pixel=Math.max(pixel,d);}if(pixel>3)changed++;}p.cpu.visible=false;p.resource.mesh.visible=true;return {meanAbsRGB:sum/(384*384*3),maximumChannelDifference:max,pixelsDifferenceGT3:changed};};
window.renderProbe=(mode)=>{const p=window.nativeProbe;p.plane.visible=mode==='occluded';if(mode==='orbit'){p.camera.position.set(1.2,.25,3);p.camera.lookAt(0,0,0);p.camera.updateProjectionMatrix();}p.compositor.render(p.scene,p.camera,[p.resource.mesh]);return {...p.inspect(),compositor:p.compositor.getInfo()};};
window.disposeProbe=()=>{const p=window.nativeProbe;p.compositor.dispose();p.resource.dispose();p.resource.dispose();p.cpu.geometry.dispose();p.cpu.material.dispose();p.plane.geometry.dispose();p.plane.material.dispose();p.renderer.dispose();return p.resource.getInfo();};
` }, bundle: true, format: "iife", platform: "browser", target: "es2022", write: false });
await writeFile(`${output}/probe.browser.js`, result.outputFiles[0].contents);
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 384, height: 384 }, deviceScaleFactor: 1 });
const errors = [], frames = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
try {
  await page.route("**/__native-curve-gpu-probe", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><style>body{margin:0}canvas{display:block}</style>" }));
  await page.goto("http://localhost:3000/__native-curve-gpu-probe");
  await page.addScriptTag({ content: result.outputFiles[0].text });
  const direct = await page.evaluate(() => window.runProbe());
  frames.push({ mode: "direct", ...direct });
  await page.locator("canvas").screenshot({ path: `${output}/direct.png` });
  if (direct.red < 200 || direct.green < 200 || direct.redMeanX > 140 || direct.greenMeanX < 245) throw Error("Data-driven curve positions or native colours did not draw");
  const reference = await page.evaluate(() => window.compareProbeCPU());
  frames.push({ mode: "independent-cpu-geometry-reference", ...reference });
  await page.locator("canvas").screenshot({ path: `${output}/cpu-reference.png` });
  if (reference.meanAbsRGB > .15 || reference.pixelsDifferenceGT3 > 100) throw Error("GPU curve prefix geometry differs from independent CPU tessellation");
  for (const mode of ["mrt", "occluded", "orbit"]) {
    const actual = await page.evaluate((m) => window.renderProbe(m), mode);
    frames.push({ mode, ...actual });
    await page.locator("canvas").screenshot({ path: `${output}/${mode}.png` });
    if (mode === "occluded" ? actual.red + actual.green !== 0 : actual.red < 100 || actual.green < 100) throw Error(`Native curve ${mode} image check failed`);
    if (actual.glError || actual.programs.some((p) => !p.runnable)) throw Error("Native curve GPU shader failure");
  }
  const cleanup = await page.evaluate(() => window.disposeProbe());
  if (errors.length) throw Error(errors[0]);
  const paths = ["lib/cat-native-curve-renderer.ts", "lib/cat-native-curve-data.ts", "lib/cat-fur-material.ts", "lib/cat-fur-compositor.ts"];
  const sources = Object.fromEntries(await Promise.all(paths.map(async (p) => [p, createHash("sha256").update(await readFile(p)).digest("hex")])));
  await writeFile(`${output}/report.json`, JSON.stringify({ status: "synthetic GPU data/depth/colour probe passed; not native-asset or photorealistic acceptance", pointColorMode, frames, cleanup, errors, sources }, null, 2));
  console.log(JSON.stringify({ frames: frames.length, errors, output }));
} catch (e) { await writeFile(`${output}/failure.json`, JSON.stringify({ error: e.stack, errors, frames }, null, 2)); throw e; }
finally { await browser.close(); }
