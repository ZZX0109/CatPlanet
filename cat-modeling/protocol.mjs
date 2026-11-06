import { createHash } from 'node:crypto';
import { FIXTURE_ID, DEFAULT_PARAMETERS } from './fixture.mjs';
export const sha256 = b => createHash('sha256').update(b).digest('hex');
export const jsonBytes = v => Buffer.from(JSON.stringify(v,null,2)+'\n');
export const record = v => v !== null && typeof v==='object' && !Array.isArray(v);
export function exact(v, keys, label) { if(!record(v)||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k))) throw Error(`${label}: unexpected or missing fields`); }
export function normalizeRequest(v) {
  exact(v,['requestSchemaVersion','engine','parameters'],'request');
  if(v.requestSchemaVersion!==1||v.engine!==FIXTURE_ID) throw Error('Unsupported request version or engine; only the authored deterministic fixture is available');
  exact(v.parameters,Object.keys(DEFAULT_PARAMETERS),'parameters');
  for(const [k,n] of Object.entries(v.parameters)) if(typeof n!=='number'||!Number.isFinite(n)||n<.5||n>1.5) throw Error(`${k}: expected finite number in [0.5, 1.5]`);
  return {requestSchemaVersion:1,engine:FIXTURE_ID,parameters:Object.fromEntries(Object.keys(DEFAULT_PARAMETERS).map(k=>[k,v.parameters[k]]))};
}
export function parseFixtureGlb(bytes) {
  if(bytes.length<28||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length) throw Error('Invalid GLB header/length');
  const len=bytes.readUInt32LE(12);
  if(len%4||bytes.readUInt32LE(16)!==0x4e4f534a||20+len+8>bytes.length) throw Error('Invalid GLB JSON chunk');
  const doc=JSON.parse(bytes.subarray(20,20+len).toString('utf8'));
  const off=20+len; const blen=bytes.readUInt32LE(off);
  if(blen%4||bytes.readUInt32LE(off+4)!==0x004e4942||off+8+blen!==bytes.length) throw Error('Invalid GLB binary chunk');
  if(doc.asset?.version!=='2.0'||doc.buffers?.length!==1||doc.buffers[0].uri||doc.buffers[0].byteLength!==blen) throw Error('External or invalid buffer');
  if(doc.images?.length||doc.skins?.length||doc.animations?.length) throw Error('Fixture cannot contain images, skeleton or animation claims');
  for(const view of doc.bufferViews??[]) if(view.buffer!==0||!Number.isInteger(view.byteOffset)||view.byteOffset<0||!Number.isInteger(view.byteLength)||view.byteLength<0||view.byteOffset+view.byteLength>blen) throw Error('Invalid buffer view');
  for(const a of doc.accessors??[]) {
    const view=doc.bufferViews[a.bufferView];
    if(!view||a.componentType!==5126||a.type!=='VEC3'||a.count!==36||view.byteLength!==a.count*12) throw Error('Invalid fixture accessor');
    for(let i=0;i<a.count*3;i++) if(!Number.isFinite(bytes.readFloatLE(off+8+view.byteOffset+i*4))) throw Error('Nonfinite GLB geometry');
  }
  if(doc.nodes?.filter(n=>n.name==='bodySurface').length!==1) throw Error('Missing/ambiguous explicit bodySurface node');
  return doc;
}
