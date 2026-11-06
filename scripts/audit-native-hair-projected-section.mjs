/** Exact projected-width integration of the source closure's normal gate. CPU only. */
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const out = 'artifacts/native-groom-capture/optics-source-study';
const built = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `import{evalNativeLegacyHair}from'./lib/cat-native-hair-optics';globalThis.__nativeSectionAudit={evalNativeLegacyHair};` }, bundle: true, write: false, platform: 'node', format: 'iife' });
vm.runInThisContext(built.outputFiles[0].text);
const evaluate = globalThis.__nativeSectionAudit.evalNativeLegacyHair;
const dot = (a,b) => a.reduce((s,x,i) => s+x*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = a => { const l=Math.hypot(...a);return l>1e-12?a.map(x=>x/l):null; };
const samples = 16384;
const gaussNodes = [-.8611363115940526,-.3399810435848563,.3399810435848563,.8611363115940526];
const gaussWeights = [.1739274225687269,.3260725774312731,.3260725774312731,.1739274225687269];
const cases=[];
for (const thetaR of [-.4,0,.4]) for (const phi of [-2.8,-1.9,-1.1,-.6,-.2,0,.2,.6,1.1,1.9,2.8]) {
  const thetaI = thetaR===0?.3:-.2;
  cases.push({id:`view${thetaR}-azimuth${phi}`,T:[0,1,0],V:[0,Math.sin(thetaR),Math.cos(thetaR)],L:[Math.cos(thetaI)*Math.sin(phi),Math.sin(thetaI),Math.cos(thetaI)*Math.cos(phi)]});
}
cases.push({id:'oblique-global-frame',T:unit([.3,.9,-.2]),V:unit([-.3,.2,1]),L:unit([.6,-.1,.8])});
cases.push({id:'light-parallel-tangent',T:[0,1,0],V:[0,0,1],L:[0,1,0]});
cases.push({id:'light-antiparallel-tangent',T:[0,1,0],V:[0,0,1],L:[0,-1,0]});
const results=[];
for(const c of cases){
  const T=unit(c.T),V=unit(c.V),L=unit(c.L);
  const N0=unit(V.map((x,i)=>x-T[i]*dot(T,V))), B=unit(cross(T,V));
  const a=dot(N0,L),b=dot(B,L),r=Math.hypot(a,b);
  const weightR=r>1e-12?Math.max(0,Math.min(1,(1+a/r)/2)):.5;
  const input={tangent:T,view:V,light:L,roughnessU:.05,roughnessV:.3,offsetRadians:0};
  const R=evaluate({...input,normal:L,component:'reflection'}).evalCos;
  const trans=evaluate({...input,normal:L.map(x=>-x),component:'transmission'}).evalCos;
  const predicted=weightR*R+(1-weightR)*trans;
  const at=h=>{
    const radial=Math.sqrt(Math.max(0,1-h*h));
    const normal=N0.map((x,i)=>x*radial+B[i]*h);
    return evaluate({...input,normal,component:'reflection'}).evalCos+evaluate({...input,normal,component:'transmission'}).evalCos;
  };
  let integral=0,positive=0;
  for(let i=0;i<samples;i++){
    const h=-1+(i+.5)*2/samples;
    integral+=at(h)/samples;
    positive+=(a*Math.sqrt(1-h*h)+b*h>=0)?1:0;
  }
  const round4=gaussNodes.reduce((s,h,i)=>s+gaussWeights[i]*at(h),0);
  const error=Math.abs(predicted-integral);
  // One monotone gate boundary: midpoint count can differ by at most one bin.
  const tolerance=Math.abs(R-trans)/samples+1e-10;
  results.push({id:c.id,input:{T,V,L},a,b,weightR,weightT:1-weightR,sourceR:R,sourceTransmission:trans,analytic:predicted,midpointIntegral:integral,midpointReflectionFraction:positive/samples,absoluteError:error,midpointTolerance:tolerance,pass:error<=tolerance,round4,round4AbsoluteError:Math.abs(round4-predicted),degenerateLightProjection:r<=1e-12});
}
const degenerateView={normal:[0,0,1],tangent:[0,1,0],view:[0,1,0],light:[0,0,1],roughnessU:.05,roughnessV:.3,offsetRadians:0};
const degenerateViewResults=['reflection','transmission'].map(component=>evaluate({...degenerateView,component}));
const report={checkedAtUTC:new Date().toISOString(),pass:results.every(r=>r.pass)&&degenerateViewResults.every(r=>r.evalCos===0),scope:'Projected-width local circular cylinder normal gate, not exact round-curve intersection or full Cycles transport',sourceModuleSHA256:createHash('sha256').update(await fs.readFile('lib/cat-native-hair-optics.ts')).digest('hex'),sourceFormula:'Blender v3.6.23 bsdf_hair.h reflection line41 / transmission line89 use N only as complementary gates; all other bare-eval factors are N-independent.',derivation:{normal:'N(h)=N0*sqrt(1-h*h)+B*h, h uniform in [-1,1]',normalGate:'a*sqrt(1-h*h)+b*h >= 0',root:'for b>0, h0=-a/sqrt(a*a+b*b); for b<0 mirrored interval; b=0 follows sign(a)',reflectionProjectedFraction:'wR=(1+a/sqrt(a*a+b*b))/2',response:'wR*R(N=L)+(1-wR)*Transmission(N=-L)',normalization:'Projected-width average 0.5*integral[-1,1] response dh; no extra N.L/pi or arbitrary graph Mix.'},numerical:{cases:results.length,samplesPerCase:samples,maxAbsoluteError:Math.max(...results.map(r=>r.absoluteError)),maxRound4AbsoluteError:Math.max(...results.map(r=>r.round4AbsoluteError)),criterion:'absoluteError <= abs(sourceR-sourceTransmission)/samples + 1e-10; midpoint integration discretizes one gate boundary.'},degenerateViewResults,cases:results,recommendation:'Replace round4 with this analytic complementary-gate average inside the existing explicitly approximate local-cylinder mode. It removes quadrature step changes and costs two source evaluations instead of eight; leave center mode independently traceable.',limits:['View parallel to T: N0/B undefined; existing evaluator guard returns zero and caller must guard frame before using the formula.','Light parallel to T: a=b=0, wR arbitrary (0.5 convention); both source closures return zero at the tangent pole. Near-parallel poles follow the original 0.001-radian rejection.','Fixed local T/V/L over a circular projected section; not varying perspective V, taper/curvature normals, neighboring-strand visibility, self-shadow, multiple scattering or indirect integration.','The identity applies to the bare legacy source evaluator. Any additional N-dependent correction or shading model requires a new derivation.','Original reflection+transmission Add colours remain unchanged; weights integrate geometric gates, not a new material Mix.','CPU numerical quadrature is evidence for the identity, not GPU or actual source-appearance acceptance. No module/application/source asset was changed.']};
await fs.writeFile(out+'/projected-section-identity.json',JSON.stringify(report,null,2)+'\n');
if(!report.pass)throw Error('Projected section identity audit failed.');
console.log(JSON.stringify({pass:report.pass,...report.numerical}));
