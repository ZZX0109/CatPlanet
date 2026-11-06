/** CPU packing/interpolation checks only. No renderer, textures or source edits. */
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

const compiled=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:"import {packNativeCurveData,sampleNativeCurveCatmullRom}from'./lib/cat-native-curve-data';globalThis.__nativeDataAudit={packNativeCurveData,sampleNativeCurveCatmullRom};"},bundle:true,write:false,platform:'node',format:'iife'});
vm.runInThisContext(compiled.outputFiles[0].text);
const{packNativeCurveData:pack,sampleNativeCurveCatmullRom:sample}=globalThis.__nativeDataAudit;
const checks=[];const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});if(!pass)throw Error(name+':'+JSON.stringify(details));};
const hash=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const count=3,points=new Float32Array(count*27),radii=new Float32Array([.001,.002,.003]),colors=new Float32Array([.1,.2,.3,.4,.5,.6,.7,.8,.9]);
for(let c=0;c<count;c++)for(let n=0;n<9;n++)points.set([n,c,Math.sin(n*.7)*c],(c*9+n)*3);
const before={points:hash(points),radii:hash(radii),colors:hash(colors)};
const packed=pack({points,radii,colors},{maxTextureSize:8,preferredWidth:7});
check('records cross actual2D rows without wasting a row per curve',packed.width===7&&packed.height===5&&packed.height<=8,{width:packed.width,height:packed.height});
let error=0;for(let c=0;c<count;c++)for(let n=0;n<9;n++){const o=(c*10+n)*4;for(let a=0;a<3;a++)error=Math.max(error,Math.abs(packed.data[o+a]-points[(c*9+n)*3+a]));error=Math.max(error,Math.abs(packed.data[o+3]-radii[c]));}
check('every physical knot/radius survives cross-row roundtrip',error===0,error);
check('linear root colours are neither gamma transformed nor premultiplied',colors.every((v,i)=>v===packed.data[(Math.floor(i/3)*10+9)*4+i%3]));
check('input arrays are unchanged',before.points===hash(points)&&before.radii===hash(radii)&&before.colors===hash(colors));
const start=sample(packed,0,0),end=sample(packed,0,1),middle=sample(packed,0,.5);
check('duplicated endpoint knots and global-t derivatives are explicit',start.position[0]===0&&end.position[0]===8&&start.derivative[0]===4&&end.derivative[0]===4&&middle.derivative[0]===8,{start,end,middle});
let derivativeError=0;for(let c=0;c<count;c++)for(const t of[.1,.25,.4,.61,.9]){const h=1e-7,a=sample(packed,c,t-h),b=sample(packed,c,t+h),q=sample(packed,c,t);for(let k=0;k<3;k++)derivativeError=Math.max(derivativeError,Math.abs(q.derivative[k]-(b.position[k]-a.position[k])/(2*h)));}
check('analytic derivative matches independent finite differences',derivativeError<1e-6,derivativeError);
let inside=true;for(let c=0;c<count;c++)for(let n=0;n<=100;n++){const q=sample(packed,c,n/100);for(let k=0;k<3;k++)inside&&=q.position[k]-q.radius>=packed.bounds.min[k]-1e-9&&q.position[k]+q.radius<=packed.bounds.max[k]+1e-9;}
check('Bezier-hull bounds contain interpolated curves and physical radii',inside,packed.bounds);
const varying=new Float32Array(27);for(let i=0;i<27;i++)varying[i]=.001+i*.00001;
const vp=pack({points,radii:varying,colors},{maxTextureSize:8});
check('per-control-point radii interpolate without cubic negative overshoot',Math.abs(sample(vp,1,.0625).radius-(varying[9]+varying[10])*.5)<1e-10);
const bindings={triangleVertexIndices:new Uint32Array([1,2,3,4,5,6,7,8,9]),barycentric:new Float32Array([.2,.3,.5,.1,.4,.5,0,.5,.5]),sourceAssetSHA256:'fixture'};
const bp=pack({points,radii,colors,rootBindings:bindings},{maxTextureSize:8});bindings.barycentric[0]=.9;
check('source-binding definitions are copied, not borrowed mutable arrays',Math.abs(bp.rootBindings.barycentric[0]-.2)<1e-7);
for(const[name,input,options]of[
  ['capacity exceeds GPU limit',{points:new Float32Array(7*27),radii:new Float32Array(7),colors:new Float32Array(21)},{maxTextureSize:8}],
  ['nonfinite point',{points:new Float32Array(points).fill(NaN),radii,colors},{maxTextureSize:8}],
  ['negative physical radius',{points,radii:new Float32Array([-1,0,0]),colors},{maxTextureSize:8}],
  ['invalid point count',{points:new Float32Array(28),radii,colors},{maxTextureSize:8}],
]){let rejected=false;try{pack(input,options)}catch{rejected=true}check(name+' is rejected',rejected);}
const empty=pack({points:new Float32Array(0),radii:new Float32Array(0),colors:new Float32Array(0)},{maxTextureSize:2048});
check('empty data is a bounded1x1 empty domain',empty.curveCount===0&&empty.width===1&&empty.height===1&&empty.data.every(v=>v===0));
const capacity=180000,large=pack({points:new Float32Array(capacity*27),radii:new Float32Array(capacity),colors:new Float32Array(capacity*3)},{maxTextureSize:2048});
check('180k fits real2D RGBA32F layout under2048 maximum',large.width===2048&&large.height===879&&large.byteLength===2048*879*16,{width:large.width,height:large.height,bytes:large.byteLength});

const assetPath='artifacts/native-coat-study/qa-round02/long-asset.json';
const bytes=await fs.readFile(assetPath),asset=JSON.parse(bytes),actualCount=asset.curves.length;
const ap=new Float32Array(actualCount*27),ar=new Float32Array(actualCount),ac=new Float32Array(actualCount*3);
for(let i=0;i<actualCount;i++){const c=asset.curves[i];for(let n=0;n<9;n++){const[x,y,z]=c.controlPoints[n];ap.set([x,z,-y],(i*9+n)*3);}ar[i]=c.diameterMm/(asset.metresPerUnit*1000*2);ac.set(c.rootColorLinear.slice(0,3),i*3);}
const actual=pack({points:ap,radii:ar,colors:ac},{maxTextureSize:2048});
let actualError=0;for(let i=0;i<actualCount;i++)for(let n=0;n<9;n++)for(let k=0;k<3;k++)actualError=Math.max(actualError,Math.abs(ap[(i*9+n)*3+k]-actual.data[(i*10+n)*4+k]));
check('frozen v2 actual control points survive Web-space packing exactly',actual.curveCount===28500&&actualError===0,{curves:actual.curveCount,width:actual.width,height:actual.height,bytes:actual.byteLength,maxRadius:actual.maxRadius,error:actualError});
check('all actual packed values remain finite',actual.data.every(Number.isFinite));
const result={capturedAt:new Date().toISOString(),moduleSHA:createHash('sha256').update(await fs.readFile('lib/cat-native-curve-data.ts')).digest('hex'),checks,pass:checks.every(c=>c.pass),actual:{source:assetPath,sha:createHash('sha256').update(bytes).digest('hex'),curveCount:actualCount,texture:[actual.width,actual.height],bytes:actual.byteLength,bounds:actual.bounds,maxRadius:actual.maxRadius},notes:['No GPU/shader/visual acceptance claim.','The180k zero-radius fixture checks capacity/layout only, not groom shape or performance.','Actual asset colours are preserved as producer-labelled linear input; colour management belongs to the asset importer.']};
await fs.mkdir('artifacts/native-curve-data',{recursive:true});await fs.writeFile('artifacts/native-curve-data/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
