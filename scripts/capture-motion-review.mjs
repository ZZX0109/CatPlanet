import { chromium } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
const directory = "artifacts/table-refinement/motion";
await fs.mkdir(directory, { recursive: true });
const compiled = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createCreatorMotion} from './lib/cat-creator-motion';
const scene=new THREE.Scene();scene.background=new THREE.Color('#dedad2');
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1000,850);renderer.setPixelRatio(1);renderer.toneMapping=THREE.AgXToneMapping;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.replaceChildren(renderer.domElement);document.body.style.margin='0';
const pmrem=new THREE.PMREMGenerator(renderer), room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;scene.environmentIntensity=.4;
scene.add(new THREE.HemisphereLight('#fff7e9','#81766d',.3));
for(const [position,intensity]of [[[-3,4,5],1.8],[[4,1,2],.45],[[0,3,-4],1.2]]){const l=new THREE.DirectionalLight('#fff9f0',intensity);l.position.set(...position);scene.add(l);}
const plane=new THREE.Mesh(new THREE.PlaneGeometry(50,50),new THREE.MeshStandardMaterial({color:'#dedad2',roughness:1}));plane.rotation.x=-Math.PI/2;plane.position.y=-.02;scene.add(plane);
const camera=new THREE.PerspectiveCamera(32,1000/850,.01,60);let current,motion;
window.__motionReview=async(base,pose,angle)=>{
if(current){scene.remove(current);motion.dispose();}
const model=await new GLTFLoader().loadAsync('/models/creator/'+base+'-cat.glb');current=model.scene;scene.add(current);current.updateMatrixWorld(true);
motion=createCreatorMotion(current,base);motion.setPose(pose,true);motion.update(1);current.updateMatrixWorld(true);
const box=new THREE.Box3();let finite=true;const p=new THREE.Vector3();let vertices=0;const lowest=[];
current.traverse(n=>{if(!n.isMesh)return;if(n.isSkinnedMesh)n.skeleton.update();for(let i=0;i<n.geometry.attributes.position.count;i++){n.getVertexPosition(i,p).applyMatrix4(n.matrixWorld);finite&&=p.toArray().every(Number.isFinite);box.expandByPoint(p);vertices++;if(p.y<.005&&n.isSkinnedMesh){const ids=n.geometry.attributes.skinIndex,w=n.geometry.attributes.skinWeight;lowest.push({i,p:p.toArray(),bones:[0,1,2,3].map(j=>[n.skeleton.bones[ids.getComponent(i,j)]?.name,w.getComponent(i,j)])});}}});lowest.sort((a,b)=>a.p[1]-b.p[1]);
const size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
const distance=Math.max(size.y/(2*Math.tan(Math.PI*32/360)*.83),Math.max(size.x,size.z)/(2*Math.tan(Math.PI*32/360)*(1000/850)*.8))+size.z*.4;
const d=new THREE.Vector3(angle==='side'?1:.65,.12,angle==='side'?0:1).normalize();camera.position.copy(center).addScaledVector(d,distance);camera.lookAt(center);renderer.render(scene,camera);
return{base,pose,angle,bounds:{min:box.min.toArray(),max:box.max.toArray()},finite,vertices,lowest:lowest.slice(0,4)};
};`,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
});
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
await page.route("http://localhost:3000/__motion-review", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><body></body>",
  }),
);
await page.goto("http://localhost:3000/__motion-review");
await page.addScriptTag({ content: compiled.outputFiles[0].text });
const reports = [];
for (const base of ["norwegian", "sphynx"])
  for (const pose of ["stand", "rest"])
    for (const angle of ["three", "side"]) {
      reports.push(
        await page.evaluate(
          ([base, pose, angle]) => window.__motionReview(base, pose, angle),
          [base, pose, angle],
        ),
      );
      await page.screenshot({
        path: directory + "/" + base + "-" + pose + "-" + angle + ".png",
      });
    }
await fs.writeFile(
  directory + "/geometry.json",
  JSON.stringify(reports, null, 2),
);
await browser.close();
console.log(JSON.stringify(reports));
