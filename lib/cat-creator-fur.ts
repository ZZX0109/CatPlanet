import * as THREE from "three";
// Legacy structural-cat fur helpers; not used by the Norwegian editor.
type CreatorDesign = { shape: { furDensity: number; furLength: number } };
import type { CreatorModel } from "./cat-creator-model";

type Source = { base: Float32Array; morphs: Float32Array[]; scale: number; strands: { r0:number; r1:number; m0:number; m1:number; tip:number; ids:number[] }[] };
const sources = new WeakMap<THREE.BufferGeometry, Source>();
function sourceFor(g: THREE.BufferGeometry) {
  let source = sources.get(g);
  if (!source) {
    source = { base: Float32Array.from(g.attributes.position.array), morphs: (g.morphAttributes.position ?? []).map(a => Float32Array.from(a.array)), scale: 1, strands: [] };
    if (g.index) for (let start=0;start<g.index.count;start+=9) {
      const ids=new Set<number>();for(let k=0;k<9;k++)ids.add(g.index.getX(start+k));
      source.strands.push({r0:g.index.getX(start),r1:g.index.getX(start+1),m0:g.index.getX(start+6),m1:g.index.getX(start+7),tip:g.index.getX(start+8),ids:[...ids]});
    }
    sources.set(g, source);
  }
  return source;
}
export function creatorFurCount(model: CreatorModel, design: CreatorDesign) {
  return model.meshes.filter(m => /^Fur_/.test(m.name)).reduce((n,m) => n + Math.floor((m.geometry.index?.count ?? 0)/9 * design.shape.furDensity/100), 0);
}
export function cloneOriginalFurGeometry(g: THREE.BufferGeometry) {
  const original = sourceFor(g), copy = g.clone();
  (copy.attributes.position.array as Float32Array).set(original.base);
  copy.morphAttributes.position?.forEach((a,i) => (a.array as Float32Array).set(original.morphs[i]));
  return copy;
}
export function applyCreatorFur(model: CreatorModel, design: CreatorDesign) {
  for (const mesh of model.meshes) {
    if (!/^Fur_/.test(mesh.name)) continue;
    const g=mesh.geometry, index=g.index;
    if (!index) continue;
    const capacity=index.count/9;
    const count=Math.floor(capacity*design.shape.furDensity/100);
    g.setDrawRange(0,count*9);
    mesh.visible=(model.visibility.get(mesh) ?? true) && count>0;
    mesh.userData.furStrands=count;
    const scale=/^Fur_Lid_/.test(mesh.name) ? 1 : .2 + design.shape.furLength*.056;
    const source=sourceFor(g);
    if (source.scale===scale) continue;
    // Each card has a root pair, a middle pair and a tapered tip. Stretch the
    // centreline only, preserving fibre width and every native morph delta.
    // This affine operation commutes with appearance and Blink weights.
    const arrays=[source.base,...source.morphs];
    const outputs=[g.attributes.position,...(g.morphAttributes.position ?? [])];
    for (let a=0;a<arrays.length;a++) {
      const input=arrays[a], output=outputs[a].array as Float32Array;
      for (const {r0,r1,m0,m1,tip,ids} of source.strands) {
        for (let axis=0;axis<3;axis++) {
          const root=(input[r0*3+axis]+input[r1*3+axis])/2;
          const mid=(input[m0*3+axis]+input[m1*3+axis])/2;
          for(const id of ids) {
            const center=id===r0||id===r1 ? root : id===tip ? input[tip*3+axis] : mid;
            output[id*3+axis]=input[id*3+axis]+(scale-1)*(center-root);
          }
        }
      }
      outputs[a].needsUpdate=true;
    }
    // Three caches native morph attributes in a texture by geometry identity.
    // Disposing invalidates that GPU cache; CPU buffers and root bindings stay.
    g.dispose();
    source.scale=scale;
    g.computeBoundingBox();g.computeBoundingSphere();
  }
}

/** Remove undisplayed strands from an owned export copy, including morphs. */
export function trimExportedFur(g: THREE.BufferGeometry) {
  const index=g.index;if(!index)return;
  const count=Math.min(index.count,g.drawRange.count);
  if (!count) return;
  let vertices=0;for(let i=0;i<count;i++) vertices=Math.max(vertices,index.getX(i)+1);
  for (const [name,attribute] of Object.entries(g.attributes)) {
    const a=attribute as THREE.BufferAttribute;
    g.setAttribute(name,new THREE.BufferAttribute(a.array.slice(0,vertices*a.itemSize),a.itemSize,a.normalized));
  }
  for (const name of Object.keys(g.morphAttributes)) {
    const morphs=g.morphAttributes as Record<string,THREE.BufferAttribute[]>;
    morphs[name]=morphs[name].map(a=>new THREE.BufferAttribute(a.array.slice(0,vertices*a.itemSize),a.itemSize,a.normalized));
  }
  g.setIndex(new THREE.BufferAttribute(index.array.slice(0,count),1));
  g.setDrawRange(0,count);
}
