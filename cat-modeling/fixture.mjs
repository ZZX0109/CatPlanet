/** Authored here from elementary cuboids; no downloaded geometry or AI weights. */
export const FIXTURE_ID = 'miaoxing-geometric-cat-v1';
export const LICENSE = { status: 'verified', identifier: 'CC0-1.0', source: 'repository-authored-geometric-fixture', trainingAllowed: false, publicDistributionAllowed: true };
export const DEFAULT_PARAMETERS = { bodyScale: 1, headScale: 1, earScale: 1, tailLength: 1 };
export const FIXTURE_VERSIONS = { designSchemaVersion: 1, topologyVersion: FIXTURE_ID, groomSchemaVersion: 1 };
export function dimensions(p) {
  return [
    ['bodySurface', [0, .8, 0], [.45*p.bodyScale,.36*p.bodyScale,.7*p.bodyScale]],
    ['head', [0,1.22,.65], [.32*p.headScale,.3*p.headScale,.3*p.headScale]],
    ['earL', [-.22,1.6,.65], [.095*p.earScale,.18*p.earScale,.085]],
    ['earR', [.22,1.6,.65], [.095*p.earScale,.18*p.earScale,.085]],
    ['pawFL', [-.27,.32,.45], [.13,.32,.14]], ['pawFR', [.27,.32,.45], [.13,.32,.14]],
    ['pawBL', [-.27,.32,-.45], [.13,.32,.14]], ['pawBR', [.27,.32,-.45], [.13,.32,.14]],
    ['tail', [0,1,-.8-.22*p.tailLength], [.09,.09,.35*p.tailLength]],
  ];
}
const vertices = [ // outward-facing cuboid triangles with split face normals
  [[1,0,0],[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]],
  [[-1,0,0],[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]],
  [[0,1,0],[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]],
  [[0,-1,0],[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]],
  [[0,0,1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],
  [[0,0,-1],[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]],
];
export function createFixtureGlb(parameters) {
  const positions=[], normals=[];
  for(const [normal,...quad] of vertices) for(const i of [0,1,2,0,2,3]) { positions.push(...quad[i]); normals.push(...normal); }
  const positionBuffer=Buffer.from(new Float32Array(positions).buffer);
  const normalBuffer=Buffer.from(new Float32Array(normals).buffer);
  const bin=Buffer.concat([positionBuffer,normalBuffer]);
  const nodes=dimensions(parameters).map(([name,translation,scale])=>({name,mesh:0,translation,scale,...(name==='bodySurface'?{extras:{role:'bodySurface'}}:{})}));
  const json={asset:{version:'2.0',generator:FIXTURE_ID,extras:{license:LICENSE}},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],nodes,
    meshes:[{name:'authoredCuboid',primitives:[{attributes:{POSITION:0,NORMAL:1},material:0,mode:4}]}],
    materials:[{name:'fixtureClay',pbrMetallicRoughness:{baseColorFactor:[.61,.36,.18,1],metallicFactor:0,roughnessFactor:.85}}],
    buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positionBuffer.length,target:34962},{buffer:0,byteOffset:positionBuffer.length,byteLength:normalBuffer.length,target:34962}],
    accessors:[{bufferView:0,componentType:5126,count:36,type:'VEC3',min:[-1,-1,-1],max:[1,1,1]},{bufferView:1,componentType:5126,count:36,type:'VEC3'}]};
  let jsonBin=Buffer.from(JSON.stringify(json)); jsonBin=Buffer.concat([jsonBin,Buffer.alloc((4-jsonBin.length%4)%4,32)]);
  const header=Buffer.alloc(12); header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+jsonBin.length+8+bin.length,8);
  const jh=Buffer.alloc(8);jh.writeUInt32LE(jsonBin.length);jh.writeUInt32LE(0x4e4f534a,4);
  const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,jh,jsonBin,bh,bin]);
}
