/** CPU resource/hook contract only. Does not create a WebGL context. */
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

const compiled=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
import * as THREE from 'three';
import {packNativeCurveData}from'./lib/cat-native-curve-data';
import {createNativeCurveRenderer}from'./lib/cat-native-curve-renderer';
import {configureCatFurMaterial,getCatFurMaterialSettings}from'./lib/cat-fur-material';
globalThis.__nativeRendererAudit={THREE,packNativeCurveData,createNativeCurveRenderer,configureCatFurMaterial,getCatFurMaterialSettings};
`},bundle:true,write:false,platform:'node',format:'iife'});
vm.runInThisContext(compiled.outputFiles[0].text);
const{THREE,packNativeCurveData:pack,createNativeCurveRenderer:create,configureCatFurMaterial:configure,getCatFurMaterialSettings:settings}=globalThis.__nativeRendererAudit;
const checks=[];function check(name,pass,details){checks.push({name,pass:!!pass,...(details===undefined?{}:{details})});if(!pass)throw Error(name);}
const sha=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const points=new Float32Array(3*27),radii=new Float32Array([.001,.002,.003]),colors=new Float32Array([.13,.27,.41,.2,.4,.6,.7,.5,.3]);
for(let c=0;c<3;c++)for(let k=0;k<9;k++)points.set([c*.1,k*.03,Math.sin(k*.6)*.01],(c*9+k)*3);
const packed=pack({points,radii,colors},{maxTextureSize:8,preferredWidth:7});
const original=sha(packed.data),preview=create(packed),{geometry,material,texture,mesh}=preview;
check('one compact shader template and exact input instance count',geometry.isInstancedBufferGeometry&&geometry.instanceCount===3&&geometry.attributes.position.count===34&&geometry.index.count===96);
check('all template indices and instance IDs are bounded',geometry.index.array.every(x=>x<34)&&geometry.attributes.nativeCurveIndex.array.every((x,i)=>x===i));
check('physical cross-row records are independently owned without mutation',texture.image.data!==packed.data&&sha(texture.image.data)===original&&sha(packed.data)===original,{texture:[packed.width,packed.height],bytes:texture.image.data.byteLength});
check('floating-point data sampling uses no gamma/mip/Y conversion',texture.type===THREE.FloatType&&texture.format===THREE.RGBAFormat&&texture.minFilter===THREE.NearestFilter&&!texture.generateMipmaps&&!texture.flipY&&texture.colorSpace===THREE.NoColorSpace);
check('MRT selects legacy ribbons without a finite-filter axis',mesh.userData.furRegion==='native-curves'&&mesh.userData.nativeCurveRenderer===true&&settings(material).coverageFilter==='legacy'&&!geometry.hasAttribute('furFilterAxis'));
const shader=()=>({uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader});
const first=shader();material.onBeforeCompile(first,{});
check('physical C/T/span/N precede normal and position projection hooks',first.vertexShader.indexOf('catNativeSample( uv.y')<first.vertexShader.indexOf('#include <beginnormal_vertex>')&&first.vertexShader.includes('objectNormal = catNativeNormalObject;')&&first.vertexShader.indexOf('transformed = catNativeCenter')<first.vertexShader.indexOf('#include <project_vertex>')&&first.vertexShader.includes('vViewPosition = - mvPosition.xyz;'));
check('factory coverage/light hooks survive and width becomes computed state',!first.vertexShader.includes('attribute vec3 furWidth;')&&first.vertexShader.includes('vec3 furWidth;')&&first.vertexShader.includes('furCenter = transformed - furSide * furWidth')&&first.fragmentShader.includes('RE_Direct_CatFur')&&first.fragmentShader.includes('catFurOpaqueDepth'));
const factoryKey=material.customProgramCacheKey();const borrowedDepth=new THREE.Texture();let borrowedDisposed=0;borrowedDepth.addEventListener('dispose',()=>borrowedDisposed++);
configure(material,{renderPass:'accumulation',opaqueDepth:borrowedDepth});
const accumulated=shader();material.onBeforeCompile(accumulated,{});
check('render-pass changes preserve factory MRT variant and borrowed depth',material.customProgramCacheKey()!==factoryKey&&material.customProgramCacheKey().includes('accumulation')&&material.defines.CAT_FUR_MRT===1&&accumulated.uniforms.catFurOpaqueDepth.value===borrowedDepth&&accumulated.fragmentShader.includes('layout(location = 1)'));
mesh.modelViewMatrix.makeScale(2,3,4);
material.onBeforeRender({getCurrentViewport:v=>v.set(0,0,800,600),getRenderTarget:()=>({samples:4})},new THREE.Scene(),new THREE.PerspectiveCamera(),geometry,mesh,null);
const inverse=accumulated.uniforms.catNativeViewToObject.value.elements;
check('factory viewport/sampling callback and nonuniform inverse both update',accumulated.uniforms.catFurViewport.value.x===800&&accumulated.uniforms.catFurSampling.value===1&&Math.abs(inverse[0]-.5)<1e-12&&Math.abs(inverse[4]-1/3)<1e-12&&Math.abs(inverse[8]-.25)<1e-12);
check('CPU template is explicitly excluded as a portable native groom',mesh.userData.portableGroomExport===false&&geometry.userData.portableGroomExport===false&&material.userData.nativeCurveRenderer.skinning===false&&preview.getInfo().morphTargets===false);
const disposal={geometry:0,material:0,texture:0};for(const[k,x]of Object.entries({geometry,material,texture}))x.addEventListener('dispose',()=>disposal[k]++);
const parent=new THREE.Group();parent.add(mesh);preview.dispose();preview.dispose();
check('owned resources dispose once and borrowed depth/input survive',Object.values(disposal).every(n=>n===1)&&borrowedDisposed===0&&mesh.parent===null&&sha(packed.data)===original&&preview.getInfo().disposed,{disposal,borrowedDisposed});
function rejects(fn){try{fn();return false;}catch{return true;}}
const invalid={...packed,data:packed.data.slice()};invalid.data[3]=-1;
check('invalid radius and insufficient raster subdivisions reject before construction',rejects(()=>create(invalid))&&rejects(()=>create(packed,{segments:7})));
const empty=pack({points:new Float32Array(),radii:new Float32Array(),colors:new Float32Array()},{maxTextureSize:8});const ep=create(empty);check('empty input is safely hidden with zero instances',!ep.mesh.visible&&ep.geometry.instanceCount===0);ep.dispose();
const report={checkedAtUTC:new Date().toISOString(),moduleSHA256:createHash('sha256').update(await fs.readFile('lib/cat-native-curve-renderer.ts')).digest('hex'),checks,pass:checks.every(x=>x.pass),limits:['CPU construction/shader-hook/resource checks only; no GPU shader compilation or visual/performance acceptance.','Static data only: no skin/morph deformation, no portable groom/GLB export.','Synthetic fixture validates the transport contract, not native author-groom fidelity.','Do not apply compact/box coverage globally to this legacy-only GPU curve geometry.']};
await fs.mkdir('artifacts/native-curve-renderer',{recursive:true});await fs.writeFile('artifacts/native-curve-renderer/cpu-validation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:report.pass,checks:checks.length,moduleSHA256:report.moduleSHA256}));
