/** Pure CPU contracts for whole-patch LOD ordering. No model or GPU needed. */
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const bundled=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`import{createCatGroomPatchOrder}from'./lib/cat-groom-patch-order';globalThis.__patchOrderAudit={createCatGroomPatchOrder};`},bundle:true,write:false,format:'iife',platform:'node'});
vm.runInThisContext(bundled.outputFiles[0].text);
const orderPatches=globalThis.__patchOrderAudit.createCatGroomPatchOrder;
const checks=[];
function check(name,pass,details){checks.push({name,pass:!!pass,...(details===undefined?{}:{details})});if(!pass)throw Error(name);}
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const rejects=fn=>{try{fn();return false;}catch{return true;}};
const rng=seed=>{let x=seed;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/0x100000000;};};
const lengths=[0,1,5,6,7,12,13,127,70000];
const summaries=[];
for(const count of lengths){
  const roots=Array.from({length:count},(_,i)=>Object.freeze({id:i}));Object.freeze(roots);
  const result=orderPatches(roots,6);
  const seen=new Uint8Array(count);
  for(const index of result)if(index<count)seen[index]++;
  check(`all original roots occur exactly once (${count})`,result instanceof Uint32Array&&result.length===count&&seen.every(n=>n===1));
  check(`default ordering is deterministic and root-independent (${count})`,equal(result,orderPatches(roots,6))&&equal(result,orderPatches(roots.map(()=>null),6)));
  let lastPatch=-1,valid=true;
  const patchOrder=[];
  for(let i=0;i<result.length;i++){
    const index=result[i],patch=Math.floor(index/6);
    if(patch!==lastPatch){patchOrder.push(patch);valid&&=index===patch*6;lastPatch=patch;}
    else valid&&=index===result[i-1]+1;
  }
  check(`patch members are contiguous and retain planting order (${count})`,valid&&new Set(patchOrder).size===Math.ceil(count/6));
  // Checking every prefix in small cases catches both a moved partial patch
  // and cuts within a full patch; sample all meaningful budgets in large ones.
  const prefixes=count<200?Array.from({length:count+1},(_,i)=>i):[0,1,5,6,7,Math.floor(count*.18),Math.floor(count*.25),Math.floor(count*.5),count-1,count];
  let prefixPass=true;
  for(const n of prefixes){
    const perPatch=new Map();for(let i=0;i<n;i++){const p=Math.floor(result[i]/6);perPatch.set(p,(perPatch.get(p)||0)+1);}
    const incomplete=[...perPatch].filter(([p,v])=>v!==Math.min(6,count-p*6));
    prefixPass&&=incomplete.length<=1&&(incomplete.length===0||incomplete[0][0]===Math.floor(result[n-1]/6));
  }
  check(`any checked draw prefix cuts at most its last patch (${count})`,prefixPass,{prefixes:prefixes.length});
  summaries.push({count,patches:patchOrder.length,tailPatchSize:count%6||Math.min(count,6),firstIndices:[...result.slice(0,18)]});
}
const roots=Array.from({length:127},(_,id)=>({id}));
check('caller independent fixed seed is reproducible and changes group order',equal(orderPatches(roots,6,rng(123)),orderPatches(roots,6,rng(123)))&&!equal(orderPatches(roots,6,rng(123)),orderPatches(roots,6,rng(321))));
check('custom group size includes undersized final group',equal(orderPatches([0,1,2,3,4,5,6,7],3,()=>0),new Uint32Array([3,4,5,6,7,0,1,2])));
check('invalid group sizes and invalid random values reject',[-1,0,.5,Infinity,NaN].every(size=>rejects(()=>orderPatches(roots,size)))&&[-.1,1,Infinity,NaN].every(value=>rejects(()=>orderPatches(roots,6,()=>value))));
let calls=0;orderPatches([0,1,2,3,4,5,6,7,8,9,10,11,12],6,()=>{calls++;return .2;});
check('shuffle consumes only patch-count minus one random samples',calls===2);
check('empty and single-patch orders consume no random samples',equal(orderPatches([],6,()=>{throw Error('not called');}),[])&&equal(orderPatches([0,1,2],6,()=>{throw Error('not called');}),[0,1,2]));
const out='artifacts/groom-patch-order';await fs.mkdir(out,{recursive:true});
const report={checkedAtUTC:new Date().toISOString(),pass:checks.every(c=>c.pass),checks,summaries,moduleSHA256:createHash('sha256').update(await fs.readFile('lib/cat-groom-patch-order.ts')).digest('hex'),limits:['Ordering only: does not itself create shared centerlines, move roots, change widths or increase coverage.','A partial last planting patch stays intact, but an arbitrary draw count may clip the final visible patch.','Must consume original planting order; applying to an already per-root shuffled array cannot recover patch identity.','GPU/browser/application integration was not executed or changed by this audit.']};
await fs.writeFile(out+'/cpu-validation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,checks:checks.length,moduleSHA256:report.moduleSHA256}));
