import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('authored fixture GLB decodes three primitives and applies migrated room appearance', async ({ page }) => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ownCreatorModel,applyCreatorDesign} from './lib/cat-creator-model';
import {defaultCreatorDesign,parseCreatorDesign,serializeCreatorDesign} from './lib/cat-creator-design';
import {requiredCreatorFaceTargets} from './lib/cat-asset-capabilities';
import {currentRoomAsset,roomModelAsset} from './lib/room-model-assets';
window.__catContractBrowser=async()=>{
  // This original test triangle is a compatibility fixture, not a cat asset.
  // No source model, network service, production registry or account is changed.
  const group=new THREE.Group();
  group.userData={creatorTemplateId:'sphynx-cat-v1',creatorBaseId:'sphynx',
    creatorHeadBounds:{min:[-1,0,-1],max:[1,2,1]},
    creatorLandmarks:{eyeCenters:[[-.2,1,0],[.2,1,0]],earBases:[[-.4,1.5,0],[.4,1.5,0]],muzzleCenter:[0,.5,.3]},creatorFeatures:{blink:false}};
  const pelvis=new THREE.Bone();pelvis.name='PelvisSkinJnt';
  const neck=new THREE.Bone();neck.name='Neck1SkinJnt';neck.position.y=.5;
  const head=new THREE.Bone();head.name='HeadSkinJnt';head.position.y=.5;
  pelvis.add(neck);neck.add(head);group.add(pelvis);
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([-1,0,0,1,0,0,0,2,0, -1,.2,0,1,.2,0,0,1,0, -1,.3,0,1,.3,0,0,1.1,0],3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(18),2));
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(36),4));
  const weights=new Float32Array(36);for(let i=0;i<9;i++)weights[i*4]=1;
  g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  g.computeVertexNormals();g.addGroup(0,3,0);g.addGroup(3,3,1);g.addGroup(6,3,2);
  g.morphTargetsRelative=true;
  g.morphAttributes.position=requiredCreatorFaceTargets.map(name=>{
    const delta=new Float32Array(27);if(name==='Shape_headWidth_high')delta[0]=.1;
    const attribute=new THREE.Float32BufferAttribute(delta,3);attribute.name=name;return attribute;
  });
  const materials=['Skin','sphynx_EyeOptics_L','sphynx_EyeOptics_R'].map((name,i)=>{
    const m=new THREE.MeshStandardMaterial();m.name=name;if(i)m.userData.creatorRole='eye-globe';return m;
  });
  const mesh=new THREE.SkinnedMesh(g,materials);mesh.name='SphynxCat_Surface';mesh.userData.bodySurface=true;
  mesh.bind(new THREE.Skeleton([pelvis,neck,head]));group.add(mesh);group.updateMatrixWorld(true);
  const bytes=await new GLTFExporter().parseAsync(group,{binary:true});
  const decoded=await new GLTFLoader().parseAsync(bytes,'');
  const owned=ownCreatorModel(decoded.scene,decoded.animations,'sphynx');
  const old={schemaVersion:4,templateId:'cat-foundation-v1',coatType:'hairless',shape:{...defaultCreatorDesign.shape,headWidth:76,headRound:17,headWedge:11}};
  const design=parseCreatorDesign(old);
  const roundTrip=parseCreatorDesign(JSON.parse(serializeCreatorDesign(design)));
  const asset=roomModelAsset(currentRoomAsset(roundTrip),roundTrip);
  applyCreatorDesign(owned,roundTrip);
  const body=owned.bodySurface;
  const index=body.morphTargetDictionary.Shape_headWidth_high;
  const vertex=body.getVertexPosition(0,new THREE.Vector3());
  const result={fixtureOnly:true,primitives:owned.meshes.length,bodyMaterial:body.material.name,
    designSchemaVersion:roundTrip.designSchemaVersion,legacyAssetSchemaVersion:asset.schemaVersion,
    assetRevision:asset.assetRevision,targets:owned.capabilities.morphTargetCount,
    weight:body.morphTargetInfluences[index],vertexX:vertex.x,compatible:owned.capabilities.compatible};
  owned.dispose();return result;
};` },
    bundle: true, write: false, platform: 'browser', format: 'iife',
  });
  await page.setContent('<title>Cat modeling contract fixture</title>');
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  const actual = await page.evaluate(() => (window as unknown as { __catContractBrowser: () => Promise<any> }).__catContractBrowser());
  expect(actual.fixtureOnly).toBe(true);
  expect(actual.primitives).toBe(3);
  expect(actual.bodyMaterial).toBe('Skin');
  expect(actual.targets).toBe(26);
  expect(actual.compatible).toBe(true);
  expect(actual.designSchemaVersion).toBe(5);
  expect(actual.legacyAssetSchemaVersion).toBe(4);
  expect(actual.assetRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(actual.weight).toBeCloseTo(.52);
  expect(actual.vertexX).toBeCloseTo(-.948, 5);
});
