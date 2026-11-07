"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { applyCreatorDesign, cloneCreatorForExport, disposeCreatorExport, ownCreatorModel, type CreatorModel } from "@/lib/cat-creator-model";
import { defaultCreatorDesign, parseCreatorDesign } from "@/lib/cat-creator-design";
import { currentRoomAsset, roomModelAsset } from "@/lib/room-model-assets";
import { getCatCoatProfile } from "@/lib/cat-coat-profiles";
import { createNorwegianFur } from "@/lib/norwegian-fur";
import { catVisualScenario as scenario, catVisualStage, describeCatVisual, type CatVisualView } from "@/lib/cat-visual-validation";

export default function CatVisualValidation() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [report, setReport] = useState<object>({ status: "loading" });
  useEffect(() => {
    let active = true;
    let owned: CreatorModel | undefined;
    let exported: THREE.Group | undefined;
    let decoded: THREE.Group | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    const controller = new AbortController();
    const release = () => {
      owned?.dispose(); owned = undefined;
      disposeCreatorExport(exported); exported = undefined;
      decoded?.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
        node.geometry.dispose();
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
          material.dispose();
        }
      }); decoded = undefined;
      renderer?.dispose(); renderer = undefined;
    };
    void (async () => {
      try {
        const query = new URLSearchParams(location.search);
        const stage = query.get("stage") ?? "creator";
        const view = query.get("view") ?? "three";
        if (!["creator", "roundtrip", "room"].includes(stage) || !Object.hasOwn(scenario.views, view)) throw new Error("Unknown visual stage/view");
        const design = parseCreatorDesign(query.has("design") ? JSON.parse(query.get("design")!) : defaultCreatorDesign);
        const base = getCatCoatProfile(design.coatType).baseModel;
        const asset = stage === "room" ? roomModelAsset(currentRoomAsset(design), design) : null;
        const url = asset?.url ?? `/models/creator/${base}-cat.glb`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Missing review asset: ${url} (${response.status})`);
        const bytes = await response.arrayBuffer();
        const sourceSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
        if (asset && (sourceSha256 !== asset.sha256 || bytes.byteLength !== asset.bytes)) throw new Error("Room archive integrity failed");
        const loader = new GLTFLoader();
        const gltf = await loader.parseAsync(bytes, new URL(url, location.href).href);
        owned = ownCreatorModel(gltf.scene, gltf.animations, base,
          asset ? { assetContract: asset, design } : { design });
        if (base !== "sphynx") {
          const surface = owned.bodySurface;
          owned.fur = await createNorwegianFur(owned.scene, surface, { includeGroom: design.coatMode === "groom" });
          owned.scene.add(...owned.fur.meshes);
        }
        owned.motion.setPose("stand", true);
        owned.motion.setBreathing(false); owned.motion.setIdleBlink(false);
        applyCreatorDesign(owned, design, scenario.blink);
        let object: THREE.Group = owned.scene;
        let animations = owned.animations;
        if (stage === "roundtrip") {
          exported = cloneCreatorForExport(owned, design, scenario.blink);
          const binary = await new GLTFExporter().parseAsync(exported, { binary: true, onlyVisible: true });
          if (!(binary instanceof ArrayBuffer)) throw new Error("Expected binary export");
          const readback = await loader.parseAsync(binary, location.href);
          decoded = readback.scene; object = decoded; animations = readback.animations;
        }
        if (!active) { release(); return; }
        const review = catVisualStage(object, view as CatVisualView);
        renderer = new THREE.WebGLRenderer({ canvas: canvas.current!, antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1); renderer.setSize(scenario.width, scenario.height);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1;
        renderer.render(review.scene, review.camera);
        setReport({ status: "rendered", stage, view, design, scenario, sourceSha256, sourceUrl: url,
          tools: { threeRevision: THREE.REVISION, exporter: "Three GLTFExporter", browser: navigator.userAgent,
            renderer: renderer.getContext().getParameter(renderer.getContext().VERSION) },
          normalization: review.normalization, decoded: describeCatVisual(object, animations),
          scope: "Shared review stage using real creator/room loaders and design/groom functions. Production scenes have separate lighting and interaction; this is not their screenshot." });
      } catch (error) {
        release();
        if (active) setReport({ status: "blocked", error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => { active = false; controller.abort(); release(); };
  }, []);
  return <main><h1>猫咪资产视觉验收</h1><canvas ref={canvas} aria-label="固定条件模型对照" /><pre data-visual-report>{JSON.stringify(report, null, 2)}</pre></main>;
}
