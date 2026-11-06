"use client";

import {
  Component,
  useCallback,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoundedBox, useAnimations, useGLTF } from "@react-three/drei";
import { models, type ModelId } from "@/lib/models";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import * as THREE from "three";

import RoomCreatorCat from "./RoomCreatorCat";
import type { CreatorDesign } from "@/lib/cat-creator-design";

export type CatMode = "sleep" | "walk";

function Cat({
  mode,
  model,
  reacting,
  onTouch,
  onReady,
}: {
  mode: CatMode;
  model: ModelId;
  reacting: boolean;
  onTouch: () => void;
  onReady: (model: ModelId) => void;
}) {
  const definition = models.find((item) => item.id === model)!;
  const { scene, animations } = useGLTF(definition.url);
  const cat = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    clone.traverse((object) => {
      if (object.name === "cat_LOD0") object.visible = false;
      if (object.name === "cat_LOD1") object.visible = true;
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        if (
          model === "vuena" &&
          object.material instanceof THREE.MeshStandardMaterial
        ) {
          // A separate round-bodied model with silver fur; retain pink ears and nose.
          const material = object.material.clone();
          material.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
              "#include <map_fragment>",
              `#include <map_fragment>
              if(diffuseColor.r > diffuseColor.g * 1.12 && diffuseColor.g > diffuseColor.b * 1.25) {
                float fur = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                diffuseColor.rgb = vec3(fur * 0.65, fur * 0.73, fur * 0.82);
              }`,
            );
          };
          material.customProgramCacheKey = () => "miaoxing-silver-fur-v1";
          object.material = material;
        }
      }
    });
    return clone;
  }, [scene, model]);
  useEffect(
    () => () => {
      cat.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
        if (
          model === "vuena" &&
          object instanceof THREE.Mesh &&
          object.material instanceof THREE.Material
        )
          object.material.dispose();
      });
    },
    [cat, model],
  );
  const { actions } = useAnimations(animations, cat);
  const body = useRef<THREE.Group>(null);
  const facing = useRef<THREE.Group>(null);
  useEffect(() => {
    onReady(model);
  }, [model, onReady]);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const modelData = useMemo(() => {
    cat.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(cat);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const scale = definition.size / Math.max(size.x, size.y, size.z);
    return {
      scale,
      height: size.y * scale,
      width: size.x * scale,
      position: [
        -center.x * scale,
        -bounds.min.y * scale,
        -center.z * scale,
      ] as [number, number, number],
    };
  }, [cat, definition.size]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const action = actions[definition[mode]];
    if (!action) throw new Error("模型缺少所需动作");
    action
      .reset()
      .setEffectiveTimeScale(
        reducedMotion || (mode === "sleep" && definition.proceduralSleep)
          ? 0
          : 1,
      )
      .fadeIn(reducedMotion ? 0 : 0.3)
      .play();
    return () => {
      action.fadeOut(0.2);
    };
  }, [actions, mode, definition, reducedMotion]);

  useFrame(({ clock }, delta) => {
    if (!body.current) return;
    const t = clock.getElapsedTime();
    if (facing.current) {
      const angle = definition.facing + (reacting ? 0 : -0.35);
      facing.current.rotation.y = reducedMotion
        ? angle
        : THREE.MathUtils.damp(facing.current.rotation.y, angle, 6, delta);
      const response =
        reacting && !reducedMotion
          ? Math.sin(t * 9) * (mode === "sleep" ? 0.012 : 0.035)
          : 0;
      facing.current.rotation.x = reducedMotion ? 0 : THREE.MathUtils.damp(
        facing.current.rotation.x,
        response,
        8,
        delta,
      );
    }
    if (mode === "sleep" && definition.proceduralSleep) {
      body.current.rotation.z = reducedMotion
        ? -Math.PI / 2
        : THREE.MathUtils.damp(body.current.rotation.z, -Math.PI / 2, 3, delta);
      body.current.position.y = reducedMotion
        ? modelData.width / 2
        : THREE.MathUtils.damp(
            body.current.position.y,
            modelData.width / 2,
            3,
            delta,
          );
      const breath = reducedMotion ? 1 : 1 + Math.sin(t * 1.45) * 0.008;
      body.current.scale.y = reducedMotion ? 1 : THREE.MathUtils.damp(
        body.current.scale.y,
        breath,
        4,
        delta,
      );
    } else {
      body.current.rotation.z = reducedMotion
        ? 0
        : THREE.MathUtils.damp(body.current.rotation.z, 0, 3, delta);
      const walkBob =
        reducedMotion || mode === "sleep" ? 0 : Math.sin(t * 8) * 0.018;
      body.current.position.y = reducedMotion
        ? modelData.height / 2
        : THREE.MathUtils.damp(
            body.current.position.y,
            modelData.height / 2 + walkBob,
            4,
            delta,
          );
      body.current.scale.y = reducedMotion ? 1 : THREE.MathUtils.damp(
        body.current.scale.y,
        1,
        4,
        delta,
      );
    }
  });

  return (
    <group
      ref={facing}
      onClick={(event) => {
        event.stopPropagation();
        onTouch();
      }}
    >
      <group ref={body} position={[0, modelData.height / 2, 0]}>
        <group position={[0, -modelData.height / 2, 0]}>
          <group scale={modelData.scale} position={modelData.position}>
            <primitive object={cat} />
          </group>
        </group>
      </group>
    </group>
  );
}

function RoomSet() {
  return (
    <>
      <color attach="background" args={["#f3dfd0"]} />
      <fog attach="fog" args={["#f3dfd0", 8, 15]} />
      <ambientLight intensity={1.45} color="#fff6e9" />
      <hemisphereLight intensity={1.1} color="#fffaf0" groundColor="#c7a58b" />
      <directionalLight
        position={[-3, 6, 4]}
        intensity={2.2}
        color="#fff1d9"
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[3, 2, -2]} intensity={0.8} color="#f6c3a8" />

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.045, 0]}
        receiveShadow
      >
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#e9c7ad" roughness={1} />
      </mesh>
      <mesh position={[0, 2.5, -3.15]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color="#f5e7d7" roughness={1} />
      </mesh>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.022, 0.1]}
        receiveShadow
      >
        <circleGeometry args={[2.15, 64]} />
        <meshStandardMaterial color="#e7bca6" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0.1]}>
        <circleGeometry args={[1.92, 64]} />
        <meshStandardMaterial color="#f1d5c1" roughness={1} />
      </mesh>

      <group position={[0, 0, -3.08]}>
        <mesh position={[0.95, 2.5, 0]}>
          <boxGeometry args={[2.05, 1.62, 0.12]} />
          <meshStandardMaterial color="#c59172" roughness={0.8} />
        </mesh>
        <mesh position={[0.95, 2.5, 0.08]}>
          <boxGeometry args={[1.78, 1.36, 0.08]} />
          <meshStandardMaterial color="#f4d9c1" roughness={0.7} />
        </mesh>
        <mesh position={[0.95, 2.5, 0.14]}>
          <boxGeometry args={[1.61, 1.18, 0.05]} />
          <meshBasicMaterial color="#f7dfc2" />
        </mesh>
        <mesh position={[1.5, 2.77, 0.19]}>
          <sphereGeometry args={[0.22, 24, 24]} />
          <meshBasicMaterial color="#fff0ca" />
        </mesh>
        <mesh position={[0.95, 2.5, 0.23]}>
          <boxGeometry args={[0.055, 1.23, 0.04]} />
          <meshStandardMaterial color="#c59172" />
        </mesh>
        <mesh position={[0.95, 2.5, 0.23]}>
          <boxGeometry args={[1.69, 0.055, 0.04]} />
          <meshStandardMaterial color="#c59172" />
        </mesh>
      </group>

      <group position={[-1.1, 0.04, -0.32]} rotation={[0, -0.18, 0]}>
        <RoundedBox
          args={[1.38, 0.3, 0.92]}
          radius={0.15}
          smoothness={3}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color="#fff5e7" roughness={0.92} />
        </RoundedBox>
        <mesh position={[0, 0.18, 0.18]} castShadow>
          <sphereGeometry args={[0.21, 24, 16]} />
          <meshStandardMaterial color="#e8c4ad" roughness={0.95} />
        </mesh>
      </group>

      <group position={[-2.55, 0, -1.6]}>
        <mesh position={[0, 0.22, 0]} castShadow>
          <cylinderGeometry args={[0.22, 0.27, 0.44, 18]} />
          <meshStandardMaterial color="#c88b6b" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.8, 0]}>
          <sphereGeometry args={[0.48, 12, 10]} />
          <meshStandardMaterial color="#a9aa7e" roughness={1} />
        </mesh>
        <mesh position={[-0.22, 0.96, 0.08]} scale={[0.55, 0.75, 0.5]}>
          <sphereGeometry args={[0.42, 12, 10]} />
          <meshStandardMaterial color="#bbc09a" roughness={1} />
        </mesh>
      </group>
    </>
  );
}

class SceneBoundary extends Component<
  { children: ReactNode; retry: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="scene-fallback">
        <p>房间暂时没有加载成功，资料仍然保留。</p>
        <button onClick={this.props.retry}>重新加载房间</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function RoomCamera({ yaw, zoom }: { yaw: number; zoom: number }) {
  const camera = useThree(state => state.camera);
  useEffect(() => {
    camera.position.set(Math.sin(yaw) * 6.5 * zoom, 2.6 * zoom, Math.cos(yaw) * 6.5 * zoom);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, yaw, zoom]);
  return null;
}
function ContextMonitor({ lost }: { lost: () => void }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const listener = (event: Event) => {
      event.preventDefault();
      lost();
    };
    gl.domElement.addEventListener("webglcontextlost", listener);
    return () =>
      gl.domElement.removeEventListener("webglcontextlost", listener);
  }, [gl, lost]);
  return null;
}
export default function CatRoomCanvas({
  mode,
  appearance,
  appearanceAsset,
  model = "toon",
  reacting = false,
  onTouch = () => {},
}: {
  mode: CatMode;
  model?: ModelId;
  appearance?: CreatorDesign | null;
  appearanceAsset?: string | null;
  reacting?: boolean;
  onTouch?: () => void;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState({ yaw: 0, zoom: 1 });
  const [loadedModel, setLoadedModel] = useState<string | null>(null);
  const appearanceKey = `${model}:${appearanceAsset ?? ""}:${JSON.stringify(appearance ?? null)}`;
  const creatorReady = useCallback(() => setLoadedModel(appearanceKey), [appearanceKey]);
  const detectGraphics = useCallback(() => {
    const canvas = document.createElement("canvas");
    try {
      const context = canvas.getContext("webgl2");
      setAvailable(!!context);
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      setAvailable(false);
    }
  }, []);
  useEffect(detectGraphics, [detectGraphics]);
  if (available === null)
    return (
      <div className="scene-fallback" role="status">
        正在准备房间…
      </div>
    );
  if (!available)
    return (
      <div className="scene-fallback">
        <p>当前设备无法显示 3D 房间。</p>
        <p>仍然可以编辑和保存纪念资料，也可以换一个支持 WebGL 的浏览器探望。</p>
        <button onClick={() => { setAttempt(a => a + 1); setLoadedModel(null); detectGraphics(); }}>重新检测 3D</button>
      </div>
    );
  return (
    <SceneBoundary
      key={`${attempt}:${appearanceKey}`}
      retry={() => {
        useGLTF.clear(models.find((m) => m.id === model)!.url);
        setLoadedModel(null);
        setAttempt((a) => a + 1);
      }}
    >
      <Canvas
        data-model-ready={loadedModel === appearanceKey ? model : undefined}
        shadows="percentage"
        dpr={[1, 1.5]}
        camera={{ position: [0, 2.6, 6.5], fov: 36 }}
        gl={{ antialias: true, alpha: false }}
      >
        <ContextMonitor lost={() => setAvailable(false)} />
        <RoomSet />
        <RoomCamera yaw={view.yaw} zoom={view.zoom} />
        <Suspense fallback={null}>
          {appearance ? <RoomCreatorCat assetId={appearanceAsset} design={appearance} reacting={reacting} onTouch={onTouch} onReady={creatorReady} /> : <Cat
            key={model}
            mode={mode}
            model={model}
            reacting={reacting}
            onTouch={onTouch}
            onReady={creatorReady}
          />}
        </Suspense>
      </Canvas>
      {loadedModel === appearanceKey && <div className="room-camera-controls" role="group" aria-label="房间视角" data-camera-yaw={view.yaw} data-camera-zoom={view.zoom}>
        <button type="button" onClick={() => setView(v => ({ ...v, yaw: Math.max(-Math.PI / 3, v.yaw - Math.PI / 12) }))} disabled={view.yaw <= -Math.PI / 3} aria-label="向左转动视角">左转</button>
        <button type="button" onClick={() => setView(v => ({ ...v, yaw: Math.min(Math.PI / 3, v.yaw + Math.PI / 12) }))} disabled={view.yaw >= Math.PI / 3} aria-label="向右转动视角">右转</button>
        <button type="button" onClick={() => setView(v => ({ ...v, zoom: Math.max(.6, +(v.zoom - .1).toFixed(2)) }))} disabled={view.zoom <= .6} aria-label="拉近视角">拉近</button>
        <button type="button" onClick={() => setView(v => ({ ...v, zoom: Math.min(1.2, +(v.zoom + .1).toFixed(2)) }))} disabled={view.zoom >= 1.2} aria-label="拉远视角">拉远</button>
        <button type="button" onClick={() => setView({ yaw: 0, zoom: 1 })} aria-label="恢复默认视角">回正</button>
      </div>}
      {loadedModel !== appearanceKey && (
        <div className="model-loading" role="status">
          猫咪正在来房间的路上…
        </div>
      )}
    </SceneBoundary>
  );
}
