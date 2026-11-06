import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { AgXToneMapping } from "three";

const output = "artifacts/fur-realism/verification";
let compiled: Promise<string> | undefined;
function bundle() {
  return (compiled ??= build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `
      import * as THREE from 'three';
      import {runFurFilterFixture} from './tests/fixtures/fur-filter-fixture.mjs';
      import {runFurSegmentLifecycle} from './tests/fixtures/fur-segment-lifecycle.mjs';
      import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
      import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
      import {createCatFurMaterial,configureCatFurMaterial,createCatFurExportMaterial} from './lib/cat-fur-material';
      import {createCatFurCompositor} from './lib/cat-fur-compositor';
      import {createCatFurSegmentPreview} from './lib/cat-fur-segments';
      import {ownCreatorModel,applyCreatorDesign,cloneCreatorForExport,disposeCreatorExport} from './lib/cat-creator-model';
      import {defaultCreatorDesign as currentDefaultCreatorDesign} from './lib/cat-creator-design';
      import {getCatCoatProfile} from './lib/cat-coat-profiles';
      import {createNorwegianFur} from './lib/norwegian-fur';
      // These regressions intentionally exercise the pre-existing procedural groom.
      const defaultCreatorDesign={...currentDefaultCreatorDesign,coatMode:'groom',coatType:'short',shape:{...currentDefaultCreatorDesign.shape,...getCatCoatProfile('short').defaults}};
      const mean=a=>a.reduce((s,n)=>s+n,0)/Math.max(1,a.length);
      function createRenderer(antialias=true){const canvas=document.createElement('canvas'),context=canvas.getContext('webgl2',{alpha:false,antialias,preserveDrawingBuffer:true});if(!context)throw new Error('WebGL2 context unavailable');const r=new THREE.WebGLRenderer({canvas,context,alpha:false,antialias,preserveDrawingBuffer:true});r.setPixelRatio(1);r.setSize(384,384);r.outputColorSpace=THREE.LinearSRGBColorSpace;r.toneMapping=THREE.NoToneMapping;document.body.append(r.domElement);return r;}
      function lighting(){const scene=new THREE.Scene();scene.background=new THREE.Color(0);scene.add(new THREE.AmbientLight(0xffffff,.8));const key=new THREE.DirectionalLight(0xffffff,1.5);key.position.set(3,1,4);scene.add(key);return{scene,key};}
      function pixels(renderer){const gl=renderer.getContext(),w=renderer.domElement.width,h=renderer.domElement.height,a=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);let energy=0,covered=0,r=0,g=0,b=0,max=0;for(let i=0;i<a.length;i+=4){const e=(a[i]+a[i+1]+a[i+2])/765;energy+=e;if(e>3/255){covered++;r+=a[i];g+=a[i+1];b+=a[i+2];}max=Math.max(max,e);}return{raw:a,energy,covered,meanLit:energy/Math.max(1,covered),meanRGB:[r,g,b].map(v=>v/Math.max(1,covered)/255),max,width:w,height:h};}
      function summary(frame){const {raw,...s}=frame;return s;}
      function shimmer(a,b){let difference=0;for(let i=0;i<a.raw.length;i+=4)difference+=Math.abs((a.raw[i]+a.raw[i+1]+a.raw[i+2])-(b.raw[i]+b.raw[i+1]+b.raw[i+2]))/765;return difference/Math.max(a.energy,b.energy,1);}
      function diagnostics(renderer){const gl=renderer.getContext(),error=gl.getError();return{attributes:gl.getContextAttributes(),samples:gl.getParameter(gl.SAMPLES),error,programs:renderer.info.programs.map(p=>({name:p.name,runnable:p.diagnostics?.runnable??true,programLog:p.diagnostics?.programLog??''}))};}
      function fixture(){const count=2400,segments=4,stride=10,positions=new Float32Array(count*stride*3),normals=new Float32Array(positions.length),span=new Float32Array(positions.length),colors=new Float32Array(positions.length).fill(1),uv=new Float32Array(count*stride*2),indices=new Uint32Array(count*segments*12);let seed=91353;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
        for(let strand=0;strand<count;strand++){const angle=random()*Math.PI*2,radius=Math.sqrt(random())*.56,cx=Math.cos(angle)*radius,cy=Math.sin(angle)*radius,phase=random()*Math.PI*2;
          for(let s=0;s<=segments;s++){const t=s/segments,x=cx+.008*Math.sin(t*Math.PI+phase),y=cy+.34*(t-.5),z=.01*Math.sin(phase),dx=.008*Math.PI*Math.cos(t*Math.PI+phase),dy=.34,length=Math.hypot(dx,dy),half=.00065*Math.max(.02,Math.pow(1-t,.65)),wx=dy/length*half,wy=-dx/length*half;
            for(let side=0;side<2;side++){const i=strand*stride+s*2+side,o=i*3,sign=side===0?-1:1;positions.set([x+wx*sign,y+wy*sign,z],o);normals.set([0,0,1],o);span.set([wx,wy,0],o);uv.set([side,t],i*2);}}
          for(let s=0;s<segments;s++){const i=strand*stride+s*2;indices.set([i,i+1,i+2,i+1,i+3,i+2,i+2,i+1,i,i+2,i+3,i+1],(strand*segments+s)*12);}}
        const geometry=new THREE.BufferGeometry();for(const[name,array,size]of[['position',positions,3],['normal',normals,3],['color',colors,3],['uv',uv,2],['furWidth',span,3]])geometry.setAttribute(name,new THREE.BufferAttribute(array,size));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeBoundingSphere();return{geometry,count,indexCount:indices.length};}
      window.__furRenderingFixture=async()=>{const renderer=createRenderer(),{scene,key}=lighting(),camera=new THREE.PerspectiveCamera(33,1,.05,30),meshData=fixture(),rows=[],materials=[];let mesh;
        try{
          for(const type of ['pbr','short','long','long-no-aa']){const material=type==='pbr'?new THREE.MeshStandardMaterial({vertexColors:true,roughness:.86,metalness:0,side:THREE.FrontSide}):createCatFurMaterial();materials.push(material);if(type!=='pbr')configureCatFurMaterial(material,{coatType:type==='short'?'short':'long',detailLevel:1,sampling:type!=='long-no-aa'});mesh=new THREE.Mesh(meshData.geometry,material);mesh.frustumCulled=false;scene.add(mesh);
            for(const distance of [2.6,5,8]){mesh.rotation.z=0;meshData.geometry.setDrawRange(0,meshData.indexCount);camera.position.set(0,0,distance);camera.lookAt(0,0,0);renderer.render(scene,camera);const full=pixels(renderer);camera.position.x=.00065;camera.lookAt(.00065,0,0);renderer.render(scene,camera);const shifted=pixels(renderer);camera.position.x=0;camera.lookAt(0,0,0);
              if(type!=='pbr')configureCatFurMaterial(material,{coatType:type==='short'?'short':'long',detailLevel:.25,sampling:type!=='long-no-aa'});meshData.geometry.setDrawRange(0,Math.floor(meshData.count*.25)*48);renderer.render(scene,camera);const quarter=pixels(renderer);if(type!=='pbr')configureCatFurMaterial(material,{coatType:type==='short'?'short':'long',detailLevel:1,sampling:type!=='long-no-aa'});meshData.geometry.setDrawRange(0,meshData.indexCount);
              rows.push({type,distance,physicalRootPixelWidth:.0013/(2*distance*Math.tan(THREE.MathUtils.degToRad(33/2)))*384,full:summary(full),quarter:summary(quarter),quarterEnergyRatio:quarter.energy/Math.max(1,full.energy),shiftEnergyRatio:shifted.energy/Math.max(1,full.energy),shimmer:shimmer(full,shifted)});
            }
            camera.position.set(0,0,2.6);camera.lookAt(0,0,0);mesh.rotation.z=0;renderer.render(scene,camera);const axisY=pixels(renderer);mesh.rotation.z=Math.PI/2;renderer.render(scene,camera);const axisX=pixels(renderer);rows.push({type,orientation:true,axisY:summary(axisY),axisX:summary(axisX),directionalEnergyRatio:axisX.energy/Math.max(1,axisY.energy)});scene.remove(mesh);
          }
          return{rows,diagnostics:diagnostics(renderer)};
        }finally{meshData.geometry.dispose();materials.forEach(m=>m.dispose());renderer.dispose();renderer.domElement.remove();}
      };
      window.__furRenderingFallback=async()=>{const rows=[];
        for(const antialias of [false,true]){const renderer=createRenderer(antialias),{scene}=lighting(),data=fixture(),material=createCatFurMaterial(),mesh=new THREE.Mesh(data.geometry,material);scene.add(mesh);
          try{if(!antialias){const camera=new THREE.PerspectiveCamera(33,1,.05,30);camera.position.set(0,0,5);camera.lookAt(0,0,0);configureCatFurMaterial(material,{coatType:'long',sampling:true});renderer.render(scene,camera);const automatic=pixels(renderer);configureCatFurMaterial(material,{sampling:false});renderer.render(scene,camera);const manual=pixels(renderer);let changed=0;for(let i=0;i<automatic.raw.length;i++)if(automatic.raw[i]!==manual.raw[i])changed++;rows.push({mode:'no-MSAA',automatic:summary(automatic),manual:summary(manual),changedComponents:changed,diagnostics:diagnostics(renderer)});
            }else{configureCatFurMaterial(material,{coatType:'long',sampling:true});const camera=new THREE.OrthographicCamera(-.9,.9,.9,-.9,.05,30),frames=[];for(const depth of [2,8]){camera.position.set(0,0,depth);camera.lookAt(0,0,0);renderer.render(scene,camera);frames.push(summary(pixels(renderer)));}rows.push({mode:'orthographic-MSAA',frames,energyRatio:frames[1].energy/Math.max(1,frames[0].energy),diagnostics:diagnostics(renderer)});}
          }finally{data.geometry.dispose();material.dispose();renderer.dispose();renderer.domElement.remove();}}
        return rows;};
      window.__furOitMaterial=async(filter='legacy')=>{
        const renderer=createRenderer(),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10),materials=[],meshes=[],previews=[];
        camera.position.set(0,0,3);camera.lookAt(0,0,0);scene.add(new THREE.AmbientLight(0xffffff,Math.PI));
        const geometry=new THREE.BufferGeometry();
        geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.8,-.8,0,.8,-.8,0,-.8,.8,0,.8,.8,0],3));
        geometry.setAttribute('normal',new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1,0,0,1],3));
        geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(12).fill(1),3));
        geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));
        geometry.setAttribute('furWidth',new THREE.Float32BufferAttribute([.8,0,0,.8,0,0,.8,0,0,.8,0,0],3));geometry.setIndex([0,1,2,1,3,2,2,1,0,2,3,1]);geometry.setAttribute('furFilterAxis',new THREE.BufferAttribute(new Int8Array([1,1,1,1]),1));
        const target=new THREE.WebGLRenderTarget(128,128,{count:2,type:THREE.HalfFloatType,depthBuffer:false,stencilBuffer:false});
        const opaque=new THREE.WebGLRenderTarget(128,128,{depthBuffer:true,stencilBuffer:false});opaque.depthTexture=new THREE.DepthTexture(128,128,THREE.UnsignedIntType);
        const wallMaterial=new THREE.MeshBasicMaterial({color:0xff0000}),wallGeometry=new THREE.PlaneGeometry(.5,.5),wall=new THREE.Mesh(wallGeometry,wallMaterial),opaqueScene=new THREE.Scene();wall.position.z=.25;opaqueScene.add(wall);
        const read=(attachment,x=64,y=64)=>{const half=new Uint16Array(4);renderer.readRenderTargetPixels(target,x,y,1,1,half,undefined,attachment);return Array.from(half,v=>THREE.DataUtils.fromHalfFloat(v));};
        const clear=()=>{renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();};
        const draw=()=>{clear();const visible=meshes.map(m=>m.visible);if(filter!=='legacy'){meshes.forEach((m,i)=>{m.updateMatrix();previews[i].mesh.visible=visible[i]&&previews[i].sync();previews[i].mesh.renderOrder=m.renderOrder;m.visible=false;});}try{renderer.render(scene,camera);return{accum:read(0),opticalDepth:read(1)[0]};}finally{meshes.forEach((m,i)=>m.visible=visible[i]);}};
        const rows=[];
        try{
          for(let i=0;i<16;i++){const material=createCatFurMaterial();material.opacity=.2;configureCatFurMaterial(material,{coatType:'long',sampling:true,coverageFilter:filter,renderPass:'accumulation',opaqueDepth:null});materials.push(material);const mesh=new THREE.Mesh(geometry,material);mesh.position.z=-i*.002;mesh.renderOrder=i;mesh.userData={furRegion:'body',strandSegments:1,strandVertices:4,strandIndices:12,strandCount:1,capacity:1};meshes.push(mesh);scene.add(mesh);const preview=createCatFurSegmentPreview(mesh);previews.push(preview);scene.add(preview.mesh);}
          for(const layers of [1,2,8,16]){meshes.forEach((m,i)=>m.visible=i<layers);const frame=draw();rows.push({layers,...frame,coverage:1-Math.exp(-frame.opticalDepth),expectedCoverage:1-Math.pow(.8,layers)});}
          meshes.forEach((m,i)=>{m.visible=true;m.renderOrder=i;materials[i].opacity=i%2?.37:.11;materials[i].color.setRGB(i%2?.2:1,.4,i%2?1:.2)});const forward=draw();meshes.forEach((m,i)=>m.renderOrder=meshes.length-i);const reverse=draw();
          renderer.setRenderTarget(opaque);renderer.setClearColor(0,1);renderer.clear();renderer.render(opaqueScene,camera);
          meshes.forEach((m,i)=>{m.position.z=0;materials[i].opacity=.2;configureCatFurMaterial(materials[i],{opaqueDepth:opaque.depthTexture});});const blocked=draw(),outside={accum:read(0,96,64),opticalDepth:read(1,96,64)[0]};
          meshes.forEach(m=>m.position.z=.5);const inFront=draw();
          const arrays=[];for(const attachment of [0,1]){const data=new Uint16Array(128*128*4);renderer.readRenderTargetPixels(target,0,0,128,128,data,undefined,attachment);arrays.push({attachment,finite:Array.from(data,v=>THREE.DataUtils.fromHalfFloat(v)).every(Number.isFinite)});}
          return{rows,forward,reverse,blocked,outside,inFront,arrays,backend:filter==='legacy'?'ribbons':'segments',proxyInstances:previews.map(p=>p.getInfo().instances),diagnostics:diagnostics(renderer)};
        }finally{previews.forEach(p=>p.dispose());renderer.setRenderTarget(null);target.dispose();opaque.dispose();wallGeometry.dispose();wallMaterial.dispose();geometry.dispose();materials.forEach(m=>m.dispose());renderer.dispose();renderer.domElement.remove();}
      };
      window.__furOitCompositor=async()=>{
        const renderer=createRenderer(),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10),materials=[],meshes=[];scene.background=new THREE.Color(0);scene.add(new THREE.AmbientLight(0xffffff,Math.PI));camera.position.set(0,0,3);camera.lookAt(0,0,0);
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.8,-.8,0,.8,-.8,0,-.8,.8,0,.8,.8,0],3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1,0,0,1],3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(12).fill(1),3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));geometry.setAttribute('furWidth',new THREE.Float32BufferAttribute([.8,0,0,.8,0,0,.8,0,0,.8,0,0],3));geometry.setIndex([0,1,2,1,3,2,2,1,0,2,3,1]);geometry.setDrawRange(0,12);
        for(let i=0;i<16;i++){const material=createCatFurMaterial();material.color.setRGB(.5,.5,.5);material.opacity=.2;configureCatFurMaterial(material,{coatType:'long',sampling:true,coverageFilter:'box'});materials.push(material);const mesh=new THREE.Mesh(geometry,material);mesh.position.z=-i*.002;mesh.renderOrder=i;mesh.userData={furRegion:'body',strandSegments:1,strandVertices:4,strandIndices:12,strandCount:1,capacity:1};meshes.push(mesh);scene.add(mesh);}
        const wallMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(.8,0,0)}),wallGeometry=new THREE.PlaneGeometry(.5,.5),wall=new THREE.Mesh(wallGeometry,wallMaterial);wall.position.z=.25;wall.visible=false;scene.add(wall);
        const liveDisposals={geometry:0,material:0};geometry.addEventListener('dispose',()=>liveDisposals.geometry++);wallGeometry.addEventListener('dispose',()=>liveDisposals.geometry++);for(const material of [...materials,wallMaterial])material.addEventListener('dispose',()=>liveDisposals.material++);
        // Three owns a shared DFG lookup texture; warm its PBR path before measuring compositor ownership.
        renderer.render(scene,camera);
        const gl=renderer.getContext(),createdTextures=new Map(),createTexture=gl.createTexture,deleteTexture=gl.deleteTexture,propertiesGet=renderer.properties.get;let textureID=0,lastTexture;renderer.properties.get=function(object){if(object?.isTexture)lastTexture={uuid:object.uuid,name:object.name,depth:!!object.isDepthTexture,renderTarget:object.isRenderTargetTexture,type:object.type,image:object.image?{width:object.image.width,height:object.image.height}:null};return propertiesGet.call(this,object);};
        gl.createTexture=function(){const texture=createTexture.call(this);createdTextures.set(texture,{id:++textureID,owner:lastTexture,stack:new Error().stack});return texture;};gl.deleteTexture=function(texture){createdTextures.delete(texture);return deleteTexture.call(this,texture);};
        const baselineMemory={...renderer.info.memory};
        const compositor=createCatFurCompositor(renderer),rows=[];
        const center=()=>{const gl=renderer.getContext(),a=new Uint8Array(4);gl.readPixels(Math.floor(renderer.domElement.width/2),Math.floor(renderer.domElement.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,a);return Array.from(a,v=>v/255);};
        try{
          meshes.forEach((m,i)=>m.visible=i===0);materials[0].opacity=1;compositor.render(scene,camera,meshes);const opaqueReference=center();materials[0].opacity=.2;
          for(const layers of [1,2,8,16]){meshes.forEach((m,i)=>m.visible=i<layers);compositor.render(scene,camera,meshes);rows.push({layers,pixel:center(),expectedCoverage:1-Math.pow(.8,layers),info:compositor.getInfo(),finite:pixels(renderer).raw.every(Number.isFinite)});}
          const forward=center();meshes.forEach((m,i)=>m.renderOrder=meshes.length-i);compositor.render(scene,camera,meshes);const reverse=center();
          wall.visible=true;compositor.render(scene,camera,meshes);const blocked=center();meshes.forEach(m=>m.position.z=.5);compositor.render(scene,camera,meshes);const inFront=center();
          wall.visible=false;renderer.setSize(256,160);compositor.render(scene,camera,meshes);const resized={info:compositor.getInfo(),pixel:center(),drawingBuffer:[renderer.domElement.width,renderer.domElement.height],memory:{...renderer.info.memory}};
          const statesBefore={autoClear:renderer.autoClear,target:renderer.getRenderTarget(),clearAlpha:renderer.getClearAlpha(),viewport:renderer.getViewport(new THREE.Vector4()).toArray(),scissor:renderer.getScissor(new THREE.Vector4()).toArray(),scissorTest:renderer.getScissorTest(),background:scene.background.getHex(),visible:meshes.map(m=>m.visible)};compositor.render(scene,camera,meshes);const statesAfter={autoClear:renderer.autoClear,target:renderer.getRenderTarget(),clearAlpha:renderer.getClearAlpha(),viewport:renderer.getViewport(new THREE.Vector4()).toArray(),scissor:renderer.getScissor(new THREE.Vector4()).toArray(),scissorTest:renderer.getScissorTest(),background:scene.background.getHex(),visible:meshes.map(m=>m.visible)};
          renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;scene.background=new THREE.Color('#dedad2');
          const corner=()=>{const a=new Uint8Array(4);gl.readPixels(2,2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,a);return Array.from(a);};
          compositor.render(scene,camera,meshes);const backgroundWeighted=corner();
          meshes.forEach(m=>m.visible=false);compositor.render(scene,camera,meshes);const backgroundZero=corner();meshes.forEach(m=>m.visible=true);
          const grayMaterial=new THREE.MeshStandardMaterial({color:new THREE.Color(.5,.5,.5),roughness:1}),originalMaterials=meshes.map(m=>m.material);meshes.forEach(m=>m.material=grayMaterial);compositor.render(scene,camera,meshes);const backgroundGray=corner();meshes.forEach((m,i)=>m.material=originalMaterials[i]);grayMaterial.dispose();
          const backgroundFallback=createCatFurCompositor(renderer,{preferOIT:false});backgroundFallback.render(scene,camera,meshes);const backgroundDisabled=corner();backgroundFallback.dispose();
          const backgrounds={literal:[222,218,210,255],weighted:backgroundWeighted,zero:backgroundZero,gray:backgroundGray,disabled:backgroundDisabled};
          renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;scene.background=new THREE.Color(0);compositor.render(scene,camera,meshes);
          const framebufferStatus=gl.checkFramebufferStatus;let forceIncomplete=true;gl.checkFramebufferStatus=function(target){if(forceIncomplete){forceIncomplete=false;return gl.FRAMEBUFFER_UNSUPPORTED;}return framebufferStatus.call(this,target);};
          try{compositor.render(scene,camera,meshes);}finally{gl.checkFramebufferStatus=framebufferStatus;}
          const permanentFallback={info:compositor.getInfo(),pixel:center(),memory:{...renderer.info.memory},retainedTextures:Array.from(createdTextures.values()),error:gl.getError()};
          compositor.dispose();const memoryOnce={...renderer.info.memory},retainedTextures=Array.from(createdTextures.values());compositor.dispose();const memoryTwice={...renderer.info.memory};const live={...liveDisposals};renderer.render(scene,camera);const afterDispose={pixel:center(),diagnostics:diagnostics(renderer)};
          const originalHas=renderer.extensions.has;renderer.extensions.has=function(name){return name==='EXT_color_buffer_float'?false:originalHas.call(this,name);};const fallback=createCatFurCompositor(renderer);renderer.extensions.has=originalHas;fallback.render(scene,camera,meshes);const unsupported={info:fallback.getInfo(),pixel:center(),diagnostics:diagnostics(renderer)};fallback.dispose();
          const disabledCompositor=createCatFurCompositor(renderer,{preferOIT:false});disabledCompositor.render(scene,camera,meshes);const disabled={info:disabledCompositor.getInfo(),pixel:center(),diagnostics:diagnostics(renderer)};disabledCompositor.dispose();
          return{opaqueReference,rows,forward,reverse,blocked,inFront,resized,statesBefore,statesAfter,backgrounds,permanentFallback,baselineMemory,memoryOnce,memoryTwice,retainedTextures,live,afterDispose,unsupported,disabled};
        }finally{compositor.dispose();gl.createTexture=createTexture;gl.deleteTexture=deleteTexture;renderer.properties.get=propertiesGet;geometry.dispose();wallGeometry.dispose();materials.forEach(m=>m.dispose());wallMaterial.dispose();renderer.dispose();renderer.domElement.remove();}
      };
      window.__furFilterValidation=runFurFilterFixture;
      window.__furSegmentLifecycle=runFurSegmentLifecycle;
      window.__furRenderingActual=async()=>{const g=await new GLTFLoader().loadAsync('/models/creator/norwegian-cat.glb'),model=ownCreatorModel(g.scene,g.animations,'norwegian'),renderer=createRenderer(),{scene}=lighting(),camera=new THREE.PerspectiveCamera(33,1,.05,30),reports=[];let snapshots=[],clone;
        try{const surface=model.meshes.filter(m=>m.isSkinnedMesh).sort((a,b)=>b.geometry.attributes.position.count-a.geometry.attributes.position.count)[0],fur=await createNorwegianFur(model.scene,surface);model.fur=fur;model.scene.add(...fur.meshes);scene.add(model.scene);camera.position.set(5,3.5,7);camera.lookAt(0,1.5,0);
          const guideMetadata=fur.meshes.find(m=>m.userData.furRegion).userData.canonicalGroom.guides;model.scene.updateMatrixWorld(true);surface.skeleton.update();const surfaceToRoot=new THREE.Matrix4().copy(model.scene.matrixWorld).invert().multiply(surface.matrixWorld),surfaceUV=surface.geometry.attributes.uv,point=new THREE.Vector3(),canonical=[];
          for(const guide of guideMetadata){surface.getVertexPosition(guide.surfaceVertex,point).applyMatrix4(surfaceToRoot);const n=new THREE.Vector3().fromArray(guide.normal),t=new THREE.Vector3().fromArray(guide.comb);canonical.push({name:guide.name,surfaceVertex:guide.surfaceVertex,projectionError:point.distanceTo(new THREE.Vector3().fromArray(guide.root)),uvError:Math.max(Math.abs(surfaceUV.getX(guide.surfaceVertex)-guide.uv[0]),Math.abs(surfaceUV.getY(guide.surfaceVertex)-guide.uv[1])),frameError:Math.max(Math.abs(n.length()-1),Math.abs(t.length()-1),Math.abs(n.dot(t))),knotCount:guide.knots.length,finite:[...guide.root,...guide.normal,...guide.comb,...guide.uv,...guide.knots].every(Number.isFinite)});}
          const transitions=[];let previous;
          for(const coat of ['short','long','short','long']){const design={...defaultCreatorDesign,coatType:coat,shape:{...defaultCreatorDesign.shape,...getCatCoatProfile(coat).defaults}};applyCreatorDesign(model,design);fur.setDetail(1);renderer.render(scene,camera);const image=pixels(renderer),attributes=[];
            const current=[];
            for(const mesh of fur.meshes.filter(m=>m.userData.furRegion)){const a=mesh.geometry.attributes,p=a.position,width=a.furWidth,uv=a.uv,stride=mesh.userData.strandVertices,segments=mesh.userData.strandSegments,indexStride=mesh.userData.strandIndices,capacity=mesh.userData.capacity;let pairError=0,uvError=0,finite=true,nonzero=0;for(let i=0;i<p.count;i+=Math.max(2,Math.floor(p.count/400/2)*2)){for(let k=0;k<3;k++){finite&&=Number.isFinite(width.getComponent(i,k));pairError=Math.max(pairError,Math.abs(width.getComponent(i,k)-width.getComponent(i+1,k)));}if(Math.hypot(width.getX(i),width.getY(i),width.getZ(i))>0)nonzero++;uvError=Math.max(uvError,Math.abs(uv.getX(i)),Math.abs(uv.getX(i+1)-1));}for(let strand=0;strand<8;strand++)for(let sample=0;sample<=segments;sample++)for(let side=0;side<2;side++){const vertex=strand*stride+sample*2+side;uvError=Math.max(uvError,Math.abs(uv.getX(vertex)-side),Math.abs(uv.getY(vertex)-sample/segments));}
              const roots=[];for(let strand=0;strand<12;strand++)for(let axis=0;axis<3;axis++)roots.push((p.getComponent(strand*stride,axis)+p.getComponent(strand*stride+1,axis))/2);
              const old=previous?.find(e=>e.region===mesh.userData.furRegion);if(old)transitions.push({from:old.coat,to:coat,region:old.region,sameMesh:old.mesh===mesh,replacedGeometry:old.geometry!==mesh.geometry,oldGeometryDisposals:old.disposed.count,rootError:Math.max(...roots.map((v,i)=>Math.abs(v-old.roots[i])))});
              const disposed={count:0};mesh.geometry.addEventListener('dispose',()=>disposed.count++);current.push({coat,region:mesh.userData.furRegion,mesh,geometry:mesh.geometry,roots,disposed});
              attributes.push({region:mesh.userData.furRegion,stride,segments,indexStride,capacity,indexCount:mesh.geometry.index.count,positionCount:p.count,widthCount:width?.count??0,uvCount:uv?.count??0,pairError,uvError,finite,nonzero});}
            previous=current;
            reports.push({coat,image:summary(image),attributes,diagnostics:diagnostics(renderer)});
          }
          const design={...defaultCreatorDesign,coatType:'long',shape:{...defaultCreatorDesign.shape,...getCatCoatProfile('long').defaults,headRound:100,headWidth:75,headDepth:35,cheeks:80,jaw:75,muzzle:30,muzzleWidth:60}};model.motion.setPose('rest',true);model.motion.update(1,{reducedMotion:true});applyCreatorDesign(model,design);fur.setDetail(.25);fur.refresh();clone=cloneCreatorForExport(model,design,0);clone.traverse(m=>{if(m.isMesh&&m.userData.norwegianFur)snapshots.push(m)});
          const expected=snapshots.filter(m=>m.userData.furRegion).map(m=>({name:m.name,strands:m.userData.strandCount,stride:m.userData.strandVertices,segments:m.userData.strandSegments,indexStride:m.userData.strandIndices,indices:m.geometry.index.count,vertices:m.geometry.attributes.position.count,widthAttribute:!!m.geometry.attributes.furWidth,filterAxisAttribute:!!m.geometry.attributes.furFilterAxis,uvCount:m.geometry.attributes.uv?.count??0,finite:m.geometry.attributes.position.array.every(Number.isFinite),standardMaterial:m.material.isMeshStandardMaterial}));
          const liveDisposals={geometry:0,material:0,texture:0},ownedDisposals={geometry:0,material:0};const observed=new Set();const observe=(resource,kind,counts)=>{if(!resource||observed.has(resource))return;observed.add(resource);resource.addEventListener('dispose',()=>counts[kind]++);};model.scene.traverse(m=>{if(!m.isMesh)return;observe(m.geometry,'geometry',liveDisposals);for(const mat of Array.isArray(m.material)?m.material:[m.material]){observe(mat,'material',liveDisposals);for(const value of Object.values(mat))if(value?.isTexture)observe(value,'texture',liveDisposals);}});for(const m of snapshots){observe(m.geometry,'geometry',ownedDisposals);if(m.userData.ownedFurExportMaterial)for(const mat of Array.isArray(m.material)?m.material:[m.material])observe(mat,'material',ownedDisposals);}const ownedExpected={geometry:ownedDisposals.geometry+snapshots.length,material:new Set(snapshots.filter(m=>m.userData.ownedFurExportMaterial).flatMap(m=>Array.isArray(m.material)?m.material:[m.material])).size};const bytes=await new GLTFExporter().parseAsync(clone,{binary:true,onlyVisible:true,animations:[]});const loaded=await new GLTFLoader().parseAsync(bytes,'');const restored=[];loaded.scene.traverse(m=>{if(m.isMesh&&m.userData.furRegion)restored.push({name:m.name,strands:m.userData.strandCount,stride:m.userData.strandVertices,segments:m.userData.strandSegments,indexStride:m.userData.strandIndices,indices:m.geometry.index.count,vertices:m.geometry.attributes.position.count,uvCount:m.geometry.attributes.uv?.count??0,widthAttribute:!!m.geometry.attributes.furWidth,filterAxisAttribute:!!m.geometry.attributes.furFilterAxis,standardMaterial:m.material.isMeshStandardMaterial,finite:m.geometry.attributes.position.array.every(Number.isFinite)})});
          // Production cleanup is idempotent and owns only exported resources.
          disposeCreatorExport(clone);const once={...ownedDisposals};disposeCreatorExport(clone);const twice={...ownedDisposals};
          // Re-upload textures as well: a closed source bitmap must not be hidden
          // by a texture that happened to already be resident on the GPU.
          model.scene.traverse(m=>{if(!m.isMesh)return;for(const mat of Array.isArray(m.material)?m.material:[m.material])for(const value of Object.values(mat))if(value?.isTexture)value.needsUpdate=true;});renderer.render(scene,camera);const afterExport=pixels(renderer),afterDiagnostics=diagnostics(renderer);
          return{canonical,transitions,reports,expected,restored,exportBytes:bytes.byteLength,animationClips:loaded.animations.length,afterExport:summary(afterExport),afterDiagnostics,disposal:{live:{...liveDisposals},ownedExpected,once,twice}};
        }finally{disposeCreatorExport(clone);model.dispose();renderer.dispose();renderer.domElement.remove();}
      };
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  }).then((r) => r.outputFiles[0].text));
}
async function runner(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route("**/__fur-rendering", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><body></body>",
    }),
  );
  await page.goto("http://localhost:3000/__fur-rendering");
  await page.addScriptTag({ content: await bundle() });
  await mkdir(output, { recursive: true });
  return errors;
}

test("actual MSAA fibre shader compiles and maintains white-fur coverage across distance and LOD", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors = await runner(page),
    r = await page.evaluate(async () => ({
      ...(await (window as any).__furRenderingFixture()),
      fallback: await (window as any).__furRenderingFallback(),
    }));
  await writeFile(
    `${output}/sampling.json`,
    JSON.stringify({ ...r, errors }, null, 2),
  );
  expect(errors).toEqual([]);
  expect(r.diagnostics.error).toBe(0);
  expect(r.diagnostics.attributes.alpha).toBe(false);
  expect(r.diagnostics.samples).toBeGreaterThanOrEqual(2);
  for (const program of r.diagnostics.programs)
    expect(program.runnable).toBe(true);
  for (const row of r.rows.filter((row: any) => !row.orientation)) {
    expect(row.full.energy).toBeGreaterThan(5);
    expect(row.full.covered).toBeGreaterThan(50);
    expect(row.full.meanRGB.every(Number.isFinite)).toBe(true);
    expect(
      Math.max(...row.full.meanRGB) - Math.min(...row.full.meanRGB),
    ).toBeLessThan(0.02);
    expect(row.shiftEnergyRatio).toBeGreaterThan(0.5);
    expect(row.shiftEnergyRatio).toBeLessThan(1.5);
    expect(row.quarter.energy).toBeGreaterThan(0);
  }
  for (const row of r.rows.filter(
    (row: any) => !row.orientation && ["short", "long"].includes(row.type),
  )) {
    const plain = r.rows.find(
      (v: any) => v.type === "pbr" && v.distance === row.distance,
    );
    const sameShading = r.rows.find(
      (v: any) => v.type === "long-no-aa" && v.distance === row.distance,
    );
    expect(row.shimmer).toBeLessThan(plain.shimmer * 0.75);
    expect(row.quarterEnergyRatio).toBeGreaterThan(
      plain.quarterEnergyRatio * 1.4,
    );
    expect(row.quarterEnergyRatio).toBeLessThan(1.5);
    expect(row.full.energy).toBeGreaterThan(plain.full.energy * 0.2);
    if (row.type === "long")
      expect(row.shimmer).toBeLessThan(sameShading.shimmer * 0.75);
  }
  const pbrDirection = r.rows.find(
    (row: any) => row.type === "pbr" && row.orientation,
  ).directionalEnergyRatio;
  for (const kind of ["short", "long"]) {
    const direction = r.rows.find(
      (row: any) => row.type === kind && row.orientation,
    ).directionalEnergyRatio;
    expect(Math.abs(Math.log(direction))).toBeGreaterThan(
      Math.abs(Math.log(pbrDirection)) + 0.02,
    );
  }
  const noMsaa = r.fallback.find((row: any) => row.mode === "no-MSAA"),
    ortho = r.fallback.find((row: any) => row.mode === "orthographic-MSAA");
  expect(noMsaa.diagnostics.samples).toBe(0);
  expect(noMsaa.changedComponents).toBe(0);
  expect(noMsaa.automatic.energy).toBeGreaterThan(5);
  expect(ortho.energyRatio).toBeGreaterThan(0.98);
  expect(ortho.energyRatio).toBeLessThan(1.02);
  for (const row of r.fallback) {
    expect(row.diagnostics.error).toBe(0);
    expect(row.diagnostics.attributes.alpha).toBe(false);
    for (const program of row.diagnostics.programs)
      expect(program.runnable).toBe(true);
  }
});

test("real cat strand attributes render and full current-pose snapshots round-trip with standard PBR fallback", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors = await runner(page),
    r = await page.evaluate(() => (window as any).__furRenderingActual());
  await writeFile(
    `${output}/actual-and-export.json`,
    JSON.stringify({ ...r, errors }, null, 2),
  );
  expect(errors).toEqual([]);
  expect(r.canonical.length).toBeGreaterThan(12);
  for (const guide of r.canonical) {
    expect(guide.finite).toBe(true);
    expect(guide.surfaceVertex).toBeGreaterThanOrEqual(0);
    expect(guide.projectionError).toBeLessThan(1e-5);
    expect(guide.uvError).toBeLessThan(1e-6);
    expect(guide.frameError).toBeLessThan(1e-5);
    expect(guide.knotCount).toBe(12);
  }
  expect(r.reports).toHaveLength(4);
  expect(r.transitions).toHaveLength(9);
  for (const change of r.transitions) {
    expect(change.sameMesh).toBe(true);
    expect(change.replacedGeometry).toBe(true);
    expect(change.oldGeometryDisposals).toBe(1);
    expect(change.rootError).toBeLessThan(1e-6);
  }
  for (const row of r.reports) {
    expect(row.image.energy).toBeGreaterThan(50);
    expect(row.diagnostics.error).toBe(0);
    expect(row.diagnostics.attributes.alpha).toBe(false);
    for (const p of row.diagnostics.programs) expect(p.runnable).toBe(true);
    expect(row.attributes).toHaveLength(3);
    for (const a of row.attributes) {
      expect(a.finite).toBe(true);
      expect(a.stride).toBe(row.coat === "long" ? 18 : 10);
      expect(a.segments).toBe(row.coat === "long" ? 8 : 4);
      expect(a.stride).toBe((a.segments + 1) * 2);
      expect(a.indexStride).toBe(a.segments * 12);
      expect(a.positionCount).toBe(a.capacity * a.stride);
      expect(a.indexCount).toBe(a.capacity * a.indexStride);
      expect(a.widthCount).toBe(a.positionCount);
      expect(a.uvCount).toBe(a.positionCount);
      expect(a.nonzero).toBeGreaterThan(100);
      expect(a.pairError).toBeLessThan(1e-8);
      expect(a.uvError).toBeLessThan(2e-5);
    }
  }
  expect(r.expected).toHaveLength(3);
  expect(r.restored).toHaveLength(3);
  expect(r.animationClips).toBe(0);
  expect(r.exportBytes).toBeGreaterThan(1000000);
  for (let i = 0; i < 3; i++) {
    const a = r.expected[i],
      b = r.restored.find((m: any) => m.name === a.name);
    expect(a.stride).toBe(18);
    expect(a.segments).toBe(8);
    expect(a.vertices).toBe(a.strands * a.stride);
    expect(a.indices).toBe(a.strands * a.indexStride);
    expect(a.widthAttribute).toBe(false);
    expect(a.filterAxisAttribute).toBe(false);
    expect(a.finite).toBe(true);
    expect(a.standardMaterial).toBe(true);
    expect(a.uvCount).toBe(a.vertices);
    expect(b).toBeTruthy();
    expect(b.indices).toBe(a.indices);
    expect(b.vertices).toBe(a.vertices);
    expect(b.stride).toBe(a.stride);
    expect(b.segments).toBe(a.segments);
    expect(b.indexStride).toBe(a.indexStride);
    expect(b.strands).toBe(a.strands);
    expect(b.widthAttribute).toBe(false);
    expect(b.filterAxisAttribute).toBe(false);
    expect(b.standardMaterial).toBe(true);
    expect(b.finite).toBe(true);
  }
  expect(r.afterExport.energy).toBeGreaterThan(50);
  expect(r.afterDiagnostics.error).toBe(0);
  expect(r.disposal.live).toEqual({ geometry: 0, material: 0, texture: 0 });
  expect(r.disposal.once.geometry).toBe(r.disposal.ownedExpected.geometry);
  expect(r.disposal.once.material).toBe(r.disposal.ownedExpected.material);
  expect(r.disposal.twice).toEqual(r.disposal.once);
});

test("studio uses an opaque MSAA context and AgX for fibre coverage", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("http://localhost:3000/studio/base");
  await page.locator('[data-creator-ready="true"]').waitFor({ timeout: 90000 });
  await page.getByRole("button", { name: "短毛猫", exact: true }).click();
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  await page
    .getByRole("button", { name: "附加毛层（实验）", exact: true })
    .click();
  await page
    .locator('[data-creator-ready="true"][data-creator-coat-mode="groom"]')
    .waitFor();
  const actual = await page.locator("canvas").evaluate((canvas) => {
    const host = canvas as any;
    const key = Object.keys(host).find((k) => k.startsWith("__reactFiber"));
    let node = key ? host[key] : undefined;
    while (node && !node.memoizedProps?.model) node = node.return;
    const renderer = node?.memoizedProps?.model.scene.__r3f?.root.getState().gl;
    if (!renderer) throw new Error("Live studio renderer unavailable");
    const gl = renderer.getContext();
    return {
      attributes: gl.getContextAttributes(),
      samples: gl.getParameter(gl.SAMPLES),
      error: gl.getError(),
      toneMapping: renderer.toneMapping,
      furMode: canvas.dataset.furRenderer,
      exposure: renderer.toneMappingExposure,
      programs: renderer.info.programs.map((program: any) => ({
        runnable: program.diagnostics?.runnable ?? true,
        programLog: program.diagnostics?.programLog ?? "",
      })),
    };
  });
  await mkdir(output, { recursive: true });
  await writeFile(
    `${output}/studio-context.json`,
    JSON.stringify({ ...actual, errors }, null, 2),
  );
  expect(errors).toEqual([]);
  expect(actual.attributes.alpha).toBe(false);
  expect(actual.attributes.antialias).toBe(true);
  expect(actual.samples).toBeGreaterThanOrEqual(2);
  expect(actual.error).toBe(0);
  expect(actual.toneMapping).toBe(AgXToneMapping);
  expect(actual.furMode).toBe("weighted");
  expect(actual.exposure).toBeGreaterThan(0);
  for (const program of actual.programs) expect(program.runnable).toBe(true);
});

test("MRT fibres accumulate overlap coverage, preserve order and obey opaque depth", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors = await runner(page),
    all = await page.evaluate(async () => {
      const results = [];
      for (const filter of ["legacy", "box", "compact"])
        results.push({
          filter,
          ...(await (window as any).__furOitMaterial(filter)),
        });
      return results;
    });
  const r = all[0];
  await writeFile(
    `${output}/oit-material.json`,
    JSON.stringify({ ...r, allFilters: all, errors }, null, 2),
  );
  expect(errors).toEqual([]);
  for (const r of all) {
    expect(r.backend).toBe(r.filter === "legacy" ? "ribbons" : "segments");
    if (r.filter !== "legacy")
      expect(r.proxyInstances).toEqual(Array(16).fill(1));
    expect(r.diagnostics.error).toBe(0);
    for (const program of r.diagnostics.programs)
      expect(program.runnable).toBe(true);
    for (const row of r.rows) {
      expect(row.accum.every(Number.isFinite)).toBe(true);
      expect(row.accum[3]).toBeCloseTo(row.layers * 0.2, 2);
      expect(row.coverage).toBeCloseTo(row.expectedCoverage, 2);
    }
    expect(r.rows.at(-1).coverage).toBeGreaterThan(0.95);
    for (let i = 0; i < 4; i++)
      expect(r.forward.accum[i]).toBeCloseTo(r.reverse.accum[i], 2);
    expect(r.forward.opticalDepth).toBeCloseTo(r.reverse.opticalDepth, 2);
    expect(r.blocked.accum[3]).toBe(0);
    expect(r.blocked.opticalDepth).toBe(0);
    expect(r.outside.accum[3]).toBeGreaterThan(2);
    expect(r.inFront.accum[3]).toBeGreaterThan(2);
    for (const attachment of r.arrays) expect(attachment.finite).toBe(true);
  }
});

test("weighted compositor resolves coverage, resizes, preserves live resources and falls back without float targets", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors = await runner(page),
    r = await page.evaluate(() => (window as any).__furOitCompositor());
  await writeFile(
    `${output}/oit-compositor.json`,
    JSON.stringify({ ...r, errors }, null, 2),
  );
  expect(errors).toEqual([]);
  for (const row of r.rows) {
    expect(row.info.mode).toBe("weighted");
    expect(row.info.supported).toBe(true);
    expect(row.info.geometryMode).toBe("segments");
    expect(row.info.segmentInstances).toBe(row.layers);
    expect(row.finite).toBe(true);
    expect(row.pixel[3]).toBe(1);
    for (let c = 0; c < 3; c++)
      expect(
        Math.abs(row.pixel[c] / r.opaqueReference[c] - row.expectedCoverage),
      ).toBeLessThan(0.025);
  }
  for (let c = 0; c < 4; c++)
    expect(Math.abs(r.forward[c] - r.reverse[c])).toBeLessThan(2 / 255);
  expect(r.blocked[0]).toBeGreaterThan(0.7);
  expect(r.blocked[1]).toBeLessThan(0.02);
  expect(r.blocked[2]).toBeLessThan(0.02);
  expect(r.inFront[1]).toBeGreaterThan(0.3);
  expect(r.resized.info.width).toBe(256);
  expect(r.resized.info.height).toBe(160);
  expect(r.resized.drawingBuffer).toEqual([256, 160]);
  for (let c = 0; c < 3; c++)
    expect(Math.abs(r.resized.pixel[c] - r.forward[c])).toBeLessThan(0.02);
  for (const color of [
    r.backgrounds.weighted,
    r.backgrounds.zero,
    r.backgrounds.gray,
    r.backgrounds.disabled,
  ])
    for (let c = 0; c < 4; c++)
      expect(Math.abs(color[c] - r.backgrounds.literal[c])).toBeLessThanOrEqual(
        1,
      );
  expect(r.permanentFallback.info.supported).toBe(false);
  expect(r.permanentFallback.info.mode).toBe("preview");
  expect(r.permanentFallback.info.reason).toBe("opaque-framebuffer-incomplete");
  expect(r.permanentFallback.memory.textures).toBe(r.baselineMemory.textures);
  expect(r.permanentFallback.retainedTextures).toEqual([]);
  expect(r.permanentFallback.error).toBe(0);
  expect(r.statesAfter).toEqual(r.statesBefore);
  expect(r.live).toEqual({ geometry: 0, material: 0 });
  expect(r.memoryOnce.textures).toBe(r.baselineMemory.textures);
  expect(r.retainedTextures).toEqual([]);
  expect(r.memoryTwice).toEqual(r.memoryOnce);
  expect(r.memoryOnce.geometries).toBe(2);
  for (const row of [r.afterDispose, r.unsupported, r.disabled]) {
    expect(row.diagnostics.error).toBe(0);
    expect(row.pixel[3]).toBe(1);
    expect(
      row.pixel.slice(0, 3).reduce((s: number, v: number) => s + v, 0),
    ).toBeGreaterThan(0.1);
    for (const program of row.diagnostics.programs)
      expect(program.runnable).toBe(true);
  }
  expect(r.unsupported.info.supported).toBe(false);
  expect(r.unsupported.info.mode).toBe("preview");
  expect(r.unsupported.info.reason).toBe(
    "float-targets-or-compatible-depth-unavailable",
  );
  expect(r.disabled.info.reason).toBe("disabled");
});

test("finite segment proxies reuse prefixes and dispose only their own resources", async ({
  page,
}) => {
  const errors = await runner(page);
  const result = await page.evaluate(() =>
    (window as any).__furSegmentLifecycle(),
  );
  await mkdir("artifacts/fur-filter/verification", { recursive: true });
  await writeFile(
    "artifacts/fur-filter/verification/segment-lifecycle.json",
    JSON.stringify({ ...result, errors }, null, 2),
  );
  expect(errors).toEqual([]);
  expect(result.repeatedAttributeIdentity).toBe(true);
  expect(result.originalPhysicalUnchangedExceptRequestedPose).toBe(true);
  expect(result.sourceDisposalsBeforeCleanup).toEqual({
    geometry: 0,
    material: 0,
  });
  expect(result.proxyDetached).toBe(true);
  expect(result.sourceStillAttached).toBe(true);
  expect(result.sourceResourcesUnchanged).toBe(true);
  expect(result.syncAfterDispose).toBe(false);
  expect(result.once).toEqual({
    geometry: result.beforeDispose.geometry + 1,
    material: 1,
  });
  expect(result.twice).toEqual(result.once);
  for (const row of result.rows) {
    expect(row.info.instances).toBe(
      row.activeStrands * row.info.segmentsPerStrand,
    );
    expect(row.active).toBe(row.activeStrands > 0);
    expect(row.visible).toBe(row.activeStrands > 0);
    if (["initial-small-prefix", "grow", "shrink"].includes(row.label)) {
      expect(row.sameGeometry, row.label).toBe(false);
      expect(row.geometryDisposals, row.label).toBe(1);
    } else {
      expect(row.sameGeometry, row.label).toBe(true);
      expect(row.geometryDisposals, row.label).toBe(0);
    }
    expect(row.info.capacitySegments).toBe(row.label === "grow" ? 512 : 256);
  }
  const prefix = result.rows.find(
    (row: any) => row.label === "larger-prefix-within-capacity",
  );
  expect(prefix.info.instances).toBe(16);
  expect(prefix.updateRanges.furStart).toEqual([{ start: 0, count: 48 }]);
  expect(prefix.updateRanges.furFilterEnds).toEqual([{ start: 0, count: 32 }]);
  const pose = result.rows.find((row: any) => row.label === "pose-update");
  expect(pose.firstStart[0]).toBeCloseTo(0.5, 6);
  const coat = result.rows.find(
    (row: any) => row.label === "coat-layout-change",
  );
  expect(coat.info.segmentsPerStrand).toBe(4);
  expect(coat.info.instances).toBe(8);
  expect(coat.lastEnd[0]).toBeCloseTo(1, 6);
  expect(coat.lastEnd[1]).toBe(1);
});

test("MRT transverse filters conserve raw accumulation area and white energy across radius, phase and projection", async ({
  page,
}) => {
  test.setTimeout(240000);
  const paths = [
    "tests/fixtures/fur-filter-fixture.mjs",
    "lib/cat-fur-segments.ts",
    "lib/cat-fur-segment-material.ts",
    "lib/cat-fur-material.ts",
    "lib/norwegian-fur.ts",
    "lib/cat-fur-compositor.ts",
    "lib/cat-groom-guides.ts",
  ];
  const sha = (data: string | Buffer) =>
    createHash("sha256").update(data).digest("hex");
  const sources = Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [path, sha(await readFile(path))]),
    ),
  );
  const errors = await runner(page),
    r = await page.evaluate(() => (window as any).__furFilterValidation());
  const sourcesAfter = Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [path, sha(await readFile(path))]),
    ),
  );
  const probe = await bundle();
  await mkdir("artifacts/fur-filter/verification", { recursive: true });
  await writeFile(
    "artifacts/fur-filter/verification/prefilter.json",
    JSON.stringify(
      { ...r, errors, sources, sourcesAfter, probeSHA: sha(probe) },
      null,
      2,
    ),
  );
  await writeFile(
    "artifacts/fur-filter/verification/prefilter-probe.js",
    probe,
  );
  expect(sourcesAfter).toEqual(sources);
  expect(errors).toEqual([]);
  expect(r.diagnostics.error).toBe(0);
  for (const program of r.diagnostics.programs)
    expect(program.runnable).toBe(true);
  for (const check of r.cpuChecks) expect(check.unchanged).toBe(true);
  for (const check of r.backendChecks) {
    expect(check.mode).toBe(check.filter === "legacy" ? "ribbons" : "segments");
    if (check.filter !== "legacy") expect(check.instances).toBe(8);
  }
  for (const fallback of r.fallbacks) expect(fallback.changed).toBe(0);
  for (const snapshot of r.exports) {
    expect(snapshot.positionEqual).toBe(true);
    expect(snapshot.worldHalfWidth).toBeCloseTo(1, 5);
    expect(snapshot.standard).toBe(true);
    expect(snapshot.widthAttribute).toBe(false);
  }
  for (const filter of ["box", "compact"]) {
    const rows = r.rows.filter((v: any) => v.filter === filter);
    for (const row of rows) {
      expect(Math.abs(row.areaBias), JSON.stringify(row)).toBeLessThanOrEqual(
        0.05,
      );
      expect(
        Math.abs(row.whiteEnergyBias),
        JSON.stringify(row),
      ).toBeLessThanOrEqual(0.05);
    }
  }
  for (const convergence of r.referenceConvergence)
    expect(convergence.normalizedL1).toBeLessThan(0.005);
  for (const group of r.referenceGroups.filter(
    (g: any) => g.filter !== "legacy",
  )) {
    const legacy = r.referenceGroups.find(
      (g: any) =>
        g.filter === "legacy" &&
        g.reference === group.reference &&
        g.radius === group.radius &&
        g.projection === group.projection,
    );
    expect(
      group.p95ResidualL1,
      JSON.stringify({ group, legacy }),
    ).toBeLessThanOrEqual(legacy.p95ResidualL1 * 0.8);
  }
});
