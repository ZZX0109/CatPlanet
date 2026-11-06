"use client";
import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Box3, Group, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  applyCreatorDesign,
  ownCreatorModel,
  type CreatorModel,
} from "@/lib/cat-creator-model";
import type { CreatorDesign } from "@/lib/cat-creator-design";
import { currentRoomAsset, roomModelAsset } from "@/lib/room-model-assets";
import { getCatCoatProfile } from "@/lib/cat-coat-profiles";
import { createNorwegianFur } from "@/lib/norwegian-fur";

export default function RoomCreatorCat({
  design,
  assetId,
  reacting,
  onTouch,
  onReady,
}: {
  assetId?: string | null;
  design: CreatorDesign;
  reacting: boolean;
  onTouch: () => void;
  onReady: () => void;
}) {
  const [model, setModel] = useState<CreatorModel | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const facing = useRef<Group>(null);
  const base = getCatCoatProfile(design.coatType).baseModel;
  const version = assetId ?? currentRoomAsset(design);
  const asset = roomModelAsset(version, design);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let owned: CreatorModel | undefined;
    setModel(null);
    setError(null);
    (async () => {
      try {
        const response = await fetch(asset.url, { signal: controller.signal });
        if (!response.ok) throw new Error("猫咪下载失败");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== asset.bytes)
          throw new Error("猫咪模型文件不完整");
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        if (hash !== asset.sha256) throw new Error("猫咪模型版本校验失败");
        const gltf = await new GLTFLoader().parseAsync(
          bytes,
          new URL(asset.url, location.href).href,
        );
        owned = ownCreatorModel(gltf.scene, gltf.animations, base);
        if (!active) {
          owned.dispose();
          return;
        }
        if (base !== "sphynx") {
          const surface = owned.bodySurface;
          const fur = await createNorwegianFur(owned.scene, surface, {
            includeGroom: design.coatMode === "groom",
          });
          if (!active) {
            fur.dispose();
            owned.dispose();
            return;
          }
          owned.fur = fur;
          owned.scene.add(...fur.meshes);
        }
        if (!active) {
          owned.dispose();
          return;
        }
        setModel(owned);
      } catch (e) {
        owned?.dispose();
        if (active)
          setError(e instanceof Error ? e : new Error("猫咪加载失败"));
      }
    })();
    return () => {
      active = false;
      controller.abort();
      owned?.dispose();
    };
  }, [base, asset, design.coatMode]);
  useEffect(() => {
    if (!model || model.baseId !== base) return;
    if (
      base !== "sphynx" &&
      model.fur?.preparedGroom !== (design.coatMode === "groom")
    )
      return;
    applyCreatorDesign(model, design);
    onReady();
  }, [model, design, base, onReady]);
  useFrame(() => {
    // A turn acknowledges touch without moving the skin away from static fur.
    if (facing.current)
      facing.current.rotation.y = asset.facing + (reacting ? 0 : -0.35);
  });
  if (error) throw error;
  if (
    !model ||
    model.baseId !== base ||
    (base !== "sphynx" &&
      model.fur?.preparedGroom !== (design.coatMode === "groom"))
  )
    return null;
  const bounds: Box3 = model.wholeBounds;
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const scale = asset.roomSize / Math.max(size.x, size.y, size.z);
  return (
    <group
      ref={facing}
      onClick={(e) => {
        e.stopPropagation();
        onTouch();
      }}
    >
      <group
        scale={scale}
        position={[-center.x * scale, -bounds.min.y * scale, -center.z * scale]}
      >
        <primitive object={model.scene} />
      </group>
    </group>
  );
}
