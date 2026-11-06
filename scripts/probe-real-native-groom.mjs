/**
 * Private source-data benchmark, not an app feature or a photorealism claim.
 * RF source remains outside public/. No new hairs, density/width boost or rig
 * transfer: draw only the source VIEWPORT child rows in one static snapshot.
 */
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const argument = name => {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw Error(`Missing value for ${name}`);
  return value;
};
const customCapture = argument("--capture");
const capture = customCapture ?? "artifacts/native-groom-capture/kitten-original-viewport";
const pbrBody = process.argv.includes("--pbr-body");
const output = argument("--output") ?? (customCapture ? `${capture}/web-static` : pbrBody ? "artifacts/native-groom-capture/web-native-original-child1-pbr" : "artifacts/native-groom-capture/web-native-original-child1-same-mrt");
if (output.startsWith("public/") || output.includes("/public/")) throw Error("RF benchmark output must remain private");
const meta = JSON.parse(await readFile(`${capture}/meta.json`, "utf8"));
const rowsTotal = meta.retainedCurves;
const childParameter = meta.sourceParametersRaw.viewportChildParameter;
const views = (argument("--views") ?? "head-chest,whole-side-tail,torso-close").split(",");
const optics = argument("--optics") ?? "broad";
const lighting = argument("--lighting") ?? "studio";
if (!["broad", "source-center", "source-round4", "source-round"].includes(optics)) throw Error("Unknown private optics mode");
if (!["studio", "direct-front", "direct-side", "direct-back"].includes(lighting)) throw Error("Unknown private lighting fixture");
let sourceOptics = null;
if (optics !== "broad") {
  const closures = JSON.parse(await readFile(`${capture}/active-source-hair-closures.json`, "utf8"));
  const components = ["Reflection", "Transmission"].map(component => closures.nodes.find(node => node.component === component));
  if (components.some(component => !component || component.mute)) throw Error("Source active R+T closures missing");
  const socket = (node, name) => {
    const input = node.inputs.find(input => input.name === name);
    if (!input || input.linked) throw Error(`Capture the driven source ${name} parameter before porting it`);
    return input.default;
  };
  const settings = components.map(node => ({ roughnessUV: [socket(node, "RoughnessU"), socket(node, "RoughnessV")], offsetRadians: socket(node, "Offset") }));
  if (JSON.stringify(settings[0]) !== JSON.stringify(settings[1])) throw Error("This private adapter requires equal source R/T parameters");
  sourceOptics = { ...settings[0], crossSection: optics === "source-round" ? "round" : optics === "source-round4" ? "round4" : "center" };
}
const sourceFiles = {
  "body.glb": argument("--body") ?? `${capture}/${pbrBody ? "body-pbr-static.glb" : "body-static.glb"}`,
  "points.f32": `${capture}/points.f32`,
  "counts.u8": `${capture}/counts.u8`,
  "radii.f32": argument("--radii") ?? (customCapture ? `${capture}/radii.f32` : "artifacts/native-curve-radii/kitten-radii-cycles-export-slots.f32"),
  "colors.f32": `${capture}/per-point-color-linear.f32`,
  "roots.f32": `${capture}/root-color-linear.f32`,
};
const resources = Object.fromEntries(await Promise.all(Object.entries(sourceFiles).map(async ([key, path]) => [key, await readFile(path)])));
const hashes = Object.fromEntries(Object.entries(resources).map(([name, bytes]) => [name, { file: sourceFiles[name], bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }]));
const colorMeta = JSON.parse(await readFile(`${capture}/per-point-color-metadata.json`, "utf8"));
// Two original shader-bake atlases use different float UV rasterization. Their
// separately measured error bounds the root metadata comparison; do not hide it.
const colorTolerance = colorMeta.maxNativeAtlasVsIndependentConstantError + 2e-7;
const childRows = meta.curves.map((curve, row) => ({ curve, row })).filter(({ curve }) => curve.kind === "child").map(({ row }) => row);
if (childRows.length !== meta.retainedKinds.child || childRows.length === 0) throw Error("Capture child draw selection differs from native metadata");
for (const [name, bytes] of Object.entries(resources)) {
  const expected = name === "points.f32" || name === "colors.f32" ? rowsTotal * 17 * 3 * 4 : name === "radii.f32" ? rowsTotal * 17 * 4 : name === "roots.f32" ? rowsTotal * 3 * 4 : name === "counts.u8" ? rowsTotal : null;
  if (expected !== null && bytes.length !== expected) throw Error(`Invalid ${name} byte size`);
}
await mkdir(output, { recursive: true });
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {packNativeCurveData} from './lib/cat-native-curve-data';
import {createNativeCurveRenderer} from './lib/cat-native-curve-renderer';
import {createCatFurCompositor} from './lib/cat-fur-compositor';
window.startNativeBenchmark=async()=>{
 const fetchBuffer=async name=>{const response=await fetch('/__private-native-groom-assets/'+name);if(!response.ok)throw Error('Private benchmark resource unavailable: '+name);return response.arrayBuffer();};
 const [body,rawP,rawC,rawR,rawRGB,rawRoot]=await Promise.all(['body.glb','points.f32','counts.u8','radii.f32','colors.f32','roots.f32'].map(fetchBuffer));
 const model=await new GLTFLoader().parseAsync(body,'');
 const input={points:new Float32Array(rawP),counts:new Uint8Array(rawC),radii:new Float32Array(rawR),pointColors:new Float32Array(rawRGB),colors:new Float32Array(rawRoot)};
 const rows=${JSON.stringify(childRows)},count=rows.length;
 const points=new Float32Array(count*17*3),pointCounts=new Uint8Array(count),radii=new Float32Array(count*17),pointColors=new Float32Array(count*17*3),colors=new Float32Array(count*3);
 let maxAxisError=0,rootColorError=0;
 for(let row=0;row<count;row++){
  const source=rows[row];pointCounts[row]=input.counts[source];colors.set(input.colors.subarray(source*3,source*3+3),row*3);
  for(let slot=0;slot<17;slot++){
   const a=(source*17+slot)*3,b=(row*17+slot)*3,x=input.points[a],y=input.points[a+1],z=input.points[a+2];
   points.set([x,z,-y],b);maxAxisError=Math.max(maxAxisError,Math.abs(points[b]-x),Math.abs(points[b+1]-z),Math.abs(points[b+2]+y));
   radii[row*17+slot]=input.radii[source*17+slot];pointColors.set(input.pointColors.subarray(a,a+3),b);
  }
  for(let channel=0;channel<3;channel++)rootColorError=Math.max(rootColorError,Math.abs(colors[row*3+channel]-pointColors[row*17*3+channel]));
 }
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});renderer.setSize(640,640);renderer.setPixelRatio(1);renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=1;document.body.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color(.15,.15,.15);
 scene.add(new THREE.HemisphereLight(0xffffff,0x6a6a6a,${lighting === "studio" ? 1.6 : 0}));
 const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(...${JSON.stringify(lighting === "direct-side" ? [5, 2, 0] : lighting === "direct-back" ? [0, 2, -5] : lighting === "direct-front" ? [0, 2, 5] : [-3, 5, 5])});scene.add(key);
 const fill=new THREE.DirectionalLight(0xffffff,${lighting === "studio" ? .8 : 0});fill.position.set(4,2,1);scene.add(fill);
 const group=new THREE.Group();group.add(model.scene);scene.add(group);
 const bodyBounds=new THREE.Box3().setFromObject(model.scene),size=bodyBounds.getSize(new THREE.Vector3()),center=bodyBounds.getCenter(new THREE.Vector3()),normalization=3/size.y;
 group.scale.setScalar(normalization);group.position.set(-center.x*normalization,-bodyBounds.min.y*normalization,-center.z*normalization);group.updateMatrixWorld(true);
 const materialSummary=[];model.scene.traverse(object=>{if(object.isMesh){object.frustumCulled=false;for(const material of Array.isArray(object.material)?object.material:[object.material])materialSummary.push({object:object.name,name:material.name,type:material.type,map:!!material.map,normalMap:!!material.normalMap,color:material.color?.toArray(),roughness:material.roughness,metalness:material.metalness});}});
 const packed=packNativeCurveData({pointsPerCurve:17,points,pointCounts,radii,colors,pointColors},{maxTextureSize:renderer.capabilities.maxTextureSize,preferredWidth:2048});
 const resource=createNativeCurveRenderer(packed,{segments:32,name:'OriginalNativeViewportChildrenOnly',sourceHairOptics:${JSON.stringify(sourceOptics ?? undefined)}});group.add(resource.mesh);
 const camera=new THREE.OrthographicCamera(-2,2,2,-2,.01,100);const compositor=createCatFurCompositor(renderer);
 const views={
  'head-chest':{target:[0,.086,.105],offset:[2.3,.9,4.5],span:2.7},
  'whole-side-tail':{target:[0,.066,-.03],offset:[6,1.0,1.4],span:8.2},
  'torso-close':{target:[-.025,.07,-.005],offset:[5,.5,1.0],span:2.8},
  'tail-close':{target:[0,.075,-.145],offset:[6,.4,.8],span:3.8},
 };
 const positionOf=p=>new THREE.Vector3(...p).applyMatrix4(group.matrixWorld);
 const read=()=>{const gl=renderer.getContext(),bytes=new Uint8Array(640*640*4);gl.readPixels(0,0,640,640,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;};
 const inspect=()=>{const gl=renderer.getContext();return {glError:gl.getError(),programs:renderer.info.programs.map(p=>({runnable:p.diagnostics?.runnable??true,log:p.diagnostics?.programLog??''})),draw:renderer.info.render,compositor:compositor.getInfo()};};
 const baselines={};
 window.nativeBenchmark={renderer,scene,group,model,resource,camera,compositor,views,read,baselines};
 window.renderNativeBenchmark=(view,enabled)=>{
  const setup=views[view];if(!setup)throw Error('Unknown source benchmark view');
  const target=positionOf(setup.target);camera.left=camera.bottom=-setup.span/2;camera.right=camera.top=setup.span/2;camera.position.copy(target).add(new THREE.Vector3(...setup.offset));camera.lookAt(target);camera.updateProjectionMatrix();
  // Keep the opaque target, MSAA resolve and colour transform identical. Merely
  // dropping candidates would use the compositor's direct-render fallback.
  resource.mesh.visible=true;resource.geometry.instanceCount=enabled?count:0;compositor.render(scene,camera,[resource.mesh]);
  const pixels=read();let difference=null;
  if(!enabled)baselines[view]=pixels;
  else {const previous=baselines[view];let sum=0,max=0,changed=0;if(!previous)throw Error('Capture body-only first');for(let i=0;i<pixels.length;i+=4){let pixel=0;for(let c=0;c<3;c++){const d=Math.abs(pixels[i+c]-previous[i+c]);sum+=d;max=Math.max(max,d);pixel=Math.max(pixel,d);}if(pixel>3)changed++;}difference={meanAbsRGB:sum/(640*640*3),maximumChannelDifference:max,pixelsDifferenceGT3:changed};}
  return {...inspect(),view,enabled,actualSourceChildrenDrawn:enabled?count:0,camera:{position:camera.position.toArray(),target:target.toArray(),span:setup.span},difference};
 };
 window.disposeNativeBenchmark=()=>{resource.dispose();compositor.dispose();model.scene.traverse(object=>{if(object.isMesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}});renderer.dispose();return resource.getInfo();};
 return {resource:resource.getInfo(),sourceRows:{first:rows[0],last:rows[rows.length-1],parentsDrawn:0,childrenDrawn:count},coordinateTransform:'source WORLD[x,y,z] -> web[x,z,-y] once; body/curves share normalization group',maxAxisError,rootColorError,bodyBounds:{min:bodyBounds.min.toArray(),max:bodyBounds.max.toArray()},normalization,materialSummary,samplingPolicy:{physicalRadiusScale:1,representativeLODWidthGain:1,rasterSupportMinimumPixels:.45,subpixelWidthUsesCoverage:true,coverageFilter:'legacy',bodyOnlyUsesSameMRTWithZeroCurveInstances:true},limits:['Static snapshot only, no skin/morph/bone animation transport','Viewport child parameter${childParameter}, not render250 coat density','glTF body material is an approximation to original node graph','Fibre optics are real-time approximation, not original two HairBSDF closures','Native17 prefix drops duplicate padding, export-slot close-tip may not draw on short prefixes']};
};
` }, bundle: true, format: "iife", platform: "browser", target: "es2022", write: false });
await writeFile(`${output}/probe.browser.js`, bundle.outputFiles[0].contents);
const browser=await chromium.launch({args:["--enable-unsafe-swiftshader"]});
const page=await browser.newPage({viewport:{width:640,height:640},deviceScaleFactor:1});
const errors=[],frames=[];let setup,cleanup;
page.on("pageerror",error=>errors.push(error.message));
page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
try {
 await page.route("**/__private-native-groom-bench",route=>route.fulfill({contentType:"text/html",body:'<!doctype html><link rel="icon" href="data:,"><style>body{margin:0}canvas{display:block}</style>'}));
 await page.route("**/__private-native-groom-assets/*",route=>{
  const name=new URL(route.request().url()).pathname.split("/").pop(),data=resources[name];
  return data?route.fulfill({contentType:name.endsWith(".glb")?"model/gltf-binary":"application/octet-stream",body:data}):route.fulfill({status:404,body:"Unknown private benchmark file"});
 });
 await page.goto("http://localhost:3000/__private-native-groom-bench");
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 setup=await page.evaluate(()=>window.startNativeBenchmark());
 if(setup.maxAxisError!==0 || setup.rootColorError>colorTolerance)throw Error('Source coordinate or linear root colour mismatch beyond independent bake tolerance');
 for(const view of views){
  for(const enabled of [false,true]){
   const frame=await page.evaluate(({view,enabled})=>window.renderNativeBenchmark(view,enabled),{view,enabled});
   frames.push(frame);await page.locator("canvas").screenshot({path:`${output}/${view}-${enabled?`native-child${childParameter}`:"body-only"}.png`});
   if(frame.glError||frame.programs.some(program=>!program.runnable))throw Error('Actual source GPU shader failed');
   if(enabled&&frame.difference.pixelsDifferenceGT3===0)throw Error('Actual native curves made no visible difference');
  }
 }
 cleanup=await page.evaluate(()=>window.disposeNativeBenchmark());
 if(errors.length)throw Error(errors[0]);
 const codeFiles=["scripts/probe-real-native-groom.mjs","lib/cat-native-curve-data.ts","lib/cat-native-curve-renderer.ts","lib/cat-fur-material.ts","lib/cat-fur-compositor.ts","lib/cat-native-hair-material.ts","lib/cat-native-hair-optics.ts"];
 const code=Object.fromEntries(await Promise.all(codeFiles.map(async path=>[path,createHash("sha256").update(await readFile(path)).digest("hex")])));
 await writeFile(`${output}/report.json`,JSON.stringify({status:`actual native static viewport child${childParameter} web transport benchmark; visual/source comparison still required; not app/default or photorealistic acceptance`,capture,childParameter,optics,lighting,sourceOptics,hashes,colorTolerance,rootColorProvenance:colorMeta.rootComparisonToPriorIndependentBake??'Read color metadata; root may derive from per-point slot0, not independent validation',setup,frames,cleanup,errors,code},null,2));
 console.log(JSON.stringify({output,frames:frames.length,sourceRows:setup.sourceRows,errors}));
}catch(error){await writeFile(`${output}/failure.json`,JSON.stringify({error:error.stack,errors,setup,frames},null,2));throw error;}
finally{await browser.close();}
