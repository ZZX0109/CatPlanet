"use client";

import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  applyCreatorDesign,
  creatorPartFor,
  type CreatorModel,
} from "@/lib/cat-creator-model";
import {
  type CreatorDesign,
  type CreatorGroup,
  type CreatorKey,
} from "@/lib/cat-creator-design";
import type { CreatorPose } from "@/lib/cat-creator-motion";
import { createCatFurCompositor } from "@/lib/cat-fur-compositor";

export type CreatorView = "front" | "three" | "side" | "whole";
export type ViewRequest = {
  view: CreatorView | "left" | "right" | "closer" | "farther";
  serial: number;
};
const DRAG_KEYS: Record<CreatorGroup, [CreatorKey, CreatorKey]> = {
  head: ["headWidth", "headDepth"],
  eyes: ["eyeSpacing", "eyeSize"],
  muzzle: ["muzzleWidth", "muzzle"],
  ears: ["earTilt", "earSize"],
  fur: ["headFurDensity", "headFurLength"],
};

function FurComposition({ model }: { model: CreatorModel }) {
  const { gl, scene, camera, invalidate } = useThree();
  const compositor = useRef<ReturnType<typeof createCatFurCompositor> | null>(
    null,
  );
  useEffect(() => {
    const owned = createCatFurCompositor(gl);
    compositor.current = owned;
    invalidate();
    return () => {
      if (compositor.current === owned) compositor.current = null;
      owned.dispose();
    };
  }, [gl, invalidate]);
  // Positive priority takes over R3F's single render after model/camera updates.
  useFrame(() => {
    if (!compositor.current) {
      gl.render(scene, camera);
      return;
    }
    compositor.current.render(scene, camera, model.fur?.meshes ?? []);
    gl.domElement.dataset.furRenderer = compositor.current.getInfo().mode;
    gl.domElement.dataset.furGeometry =
      compositor.current.getInfo().geometryMode;
  }, 1);
  return null;
}

function Lighting({ model }: { model: CreatorModel }) {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const environment = generator.fromScene(room, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.4;
    // Keep broad studio panels on the coat, but use a small round source for
    // the optical surface so it does not wash a grey cloud over the pupil.
    const eyeStudio = new THREE.Scene();
    eyeStudio.background = new THREE.Color(0.012, 0.012, 0.012);
    const sourceGeometry = new THREE.SphereGeometry(0.6, 24, 16);
    const sourceMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(9, 8.5, 8),
      toneMapped: false,
    });
    const source = new THREE.Mesh(sourceGeometry, sourceMaterial);
    source.position.set(-2.8, 4.2, 5);
    eyeStudio.add(source);
    const eyeEnvironment = generator.fromScene(eyeStudio, 0.06);
    sourceGeometry.dispose();
    sourceMaterial.dispose();
    const optics = new Map<
      THREE.MeshStandardMaterial,
      { map: THREE.Texture | null; intensity: number }
    >();
    for (const original of model.materials.values())
      for (const material of Array.isArray(original) ? original : [original]) {
        if (
          material instanceof THREE.MeshStandardMaterial &&
          /EyeOptics/.test(material.name) &&
          !optics.has(material)
        ) {
          optics.set(material, {
            map: material.envMap,
            intensity: material.envMapIntensity,
          });
          material.envMap = eyeEnvironment.texture;
          material.envMapIntensity = 0.7;
          material.needsUpdate = true;
        }
      }
    room.dispose();
    generator.dispose();
    invalidate();
    return () => {
      scene.environment = null;
      environment.dispose();
      for (const [material, original] of optics) {
        material.envMap = original.map;
        material.envMapIntensity = original.intensity;
        material.needsUpdate = true;
      }
      eyeEnvironment.dispose();
    };
  }, [gl, scene, invalidate, model]);
  return (
    <>
      <color attach="background" args={["#dedad2"]} />
      <hemisphereLight args={["#fff7e9", "#81766d", 0.3]} />
      <directionalLight
        position={[-3, 4, 5]}
        intensity={1.8}
        color="#fff9f0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-2.4}
        shadow-camera-right={2.4}
        shadow-camera-top={2.4}
        shadow-camera-bottom={-2.4}
        shadow-camera-near={0.1}
        shadow-camera-far={12}
        shadow-bias={-0.0001}
        shadow-normalBias={0.006}
      />
      <directionalLight position={[4, 1, 2]} intensity={0.45} color="#e6efff" />
      <directionalLight position={[0, 3, -4]} intensity={1.2} color="#fff8e9" />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.012, 0]}
        receiveShadow
      >
        <planeGeometry args={[200, 200]} />
        <shadowMaterial transparent opacity={0.14} depthWrite={false} />
      </mesh>
    </>
  );
}

function Model({
  model,
  design,
  blink,
  grey,
  furOnly,
  pose,
  living,
  paused,
  group,
  direct,
  onSelect,
  onChange,
  onCommit,
  onPoseSettled,
}: {
  model: CreatorModel;
  design: CreatorDesign;
  blink: boolean;
  grey: boolean;
  furOnly: boolean;
  pose: CreatorPose;
  living: boolean;
  paused: boolean;
  group: CreatorGroup;
  direct: boolean;
  onSelect(group: CreatorGroup): void;
  onChange(values: Partial<CreatorDesign["shape"]>): void;
  onCommit(): void;
  onPoseSettled(): void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hidden, setHidden] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBlink = useRef(-1);
  const lastRefresh = useRef(-Infinity);
  const dirtyBody = useRef(false);
  const pendingPose = useRef(false);
  const previousTransition = useRef(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      setReducedMotion(preference.matches);
      invalidate();
    };
    const visibility = () => {
      setHidden(document.hidden);
      invalidate();
    };
    change();
    visibility();
    preference.addEventListener("change", change);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      preference.removeEventListener("change", change);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [invalidate]);
  useEffect(() => {
    model.motion.setPose(pose, reducedMotion);
    pendingPose.current = true;
    invalidate();
  }, [model, pose, reducedMotion, invalidate]);
  useEffect(() => {
    model.motion.setBreathing(living);
    model.motion.setIdleBlink(living);
    invalidate();
  }, [model, living, invalidate]);
  useEffect(() => {
    invalidate();
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [model, paused, hidden, invalidate]);
  useFrame(({ camera, clock }) => {
    // Preview detail follows viewing distance; export uses intended density.
    const focus = model.framing(true).getCenter(new THREE.Vector3());
    const distance = camera.position.distanceTo(focus);
    const detail = THREE.MathUtils.clamp(
      1 - (distance - 3.7) * (0.78 / 7.3),
      0.22,
      1,
    );
    model.fur?.setDetail(detail);
    if (paused || hidden) return;
    const time = clock.elapsedTime;
    const frame = model.motion.update(time, { reducedMotion });
    const closed = blink ? 1 : frame.blink;
    const eyeChanged = Math.abs(closed - lastBlink.current) > 0.0001;
    if (frame.changed || eyeChanged) {
      applyCreatorDesign(model, design, closed, { groom: false });
      dirtyBody.current ||= frame.changed;
    }
    const settled =
      (previousTransition.current && !frame.transitioning) ||
      (pendingPose.current && !frame.transitioning);
    const finish = !living && !frame.transitioning;
    if (
      dirtyBody.current &&
      (time - lastRefresh.current > 0.12 || settled || finish)
    ) {
      model.fur?.refresh();
      lastRefresh.current = time;
      dirtyBody.current = false;
    } else if (eyeChanged && time - lastRefresh.current > 0.045) {
      model.fur?.refresh({ headOnly: true });
      lastRefresh.current = time;
    }
    lastBlink.current = closed;
    previousTransition.current = frame.transitioning;
    for (const mesh of model.fur?.meshes ?? [])
      mesh.visible =
        !grey &&
        mesh.geometry.drawRange.count > 0 &&
        !(furOnly && mesh.userData.undercoat);
    if (settled) {
      pendingPose.current = false;
      onPoseSettled();
    }
    if (
      (frame.transitioning ||
        (living && !reducedMotion) ||
        dirtyBody.current) &&
      timer.current === null
    ) {
      timer.current = setTimeout(() => {
        timer.current = null;
        invalidate();
      }, 24);
    }
  });
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    side: number;
    group: CreatorGroup;
    design: CreatorDesign;
  } | null>(null);
  const skinClay = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#b5afa5",
        roughness: 0.72,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const eyeClay = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#d9d7d1",
        roughness: 0.4,
        metalness: 0,
      }),
    [],
  );
  const irisClay = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#78756e",
        roughness: 0.48,
        metalness: 0,
      }),
    [],
  );
  useEffect(() => {
    applyCreatorDesign(model, design, blink ? 1 : 0);
    invalidate();
  }, [model, design, blink, invalidate]);
  useEffect(() => {
    for (const mesh of model.meshes) {
      const name = mesh.name.toLowerCase();
      mesh.visible =
        (model.visibility.get(mesh) ?? true) &&
        !furOnly &&
        !(grey && /cornea|fur|hair|whisker/.test(name)) &&
        !(/^Fur_/.test(mesh.name) && mesh.geometry.drawRange.count === 0);
      mesh.material = grey
        ? /pupil|mouthline|nostril/.test(name)
          ? model.materials.get(mesh)!
          : /iris/.test(name)
            ? irisClay
            : /eyeball|cornea/.test(name)
              ? eyeClay
              : skinClay
        : model.materials.get(mesh)!;
    }
    for (const mesh of model.fur?.meshes ?? []) {
      mesh.visible =
        !grey &&
        mesh.geometry.drawRange.count > 0 &&
        !(furOnly && mesh.userData.undercoat);
    }
    invalidate();
    return () =>
      model.materials.forEach((material, mesh) => {
        mesh.material = material;
        mesh.visible = model.visibility.get(mesh) ?? true;
      });
  }, [model, grey, furOnly, design, skinClay, eyeClay, irisClay, invalidate]);
  useEffect(
    () => () => {
      skinClay.dispose();
      eyeClay.dispose();
      irisClay.dispose();
    },
    [skinClay, eyeClay, irisClay],
  );

  function pointerDown(event: ThreeEvent<PointerEvent>) {
    if (!direct || drag.current || group === "fur" || furOnly) return;
    event.stopPropagation();
    const picked = creatorPartFor(model, event.point);
    onSelect(picked);
    drag.current = {
      pointer: event.pointerId,
      x: event.nativeEvent.clientX,
      y: event.nativeEvent.clientY,
      side: event.point.x < 0 ? -1 : 1,
      group: picked,
      design,
    };
    (
      event.target as EventTarget & { setPointerCapture(id: number): void }
    ).setPointerCapture(event.pointerId);
  }
  function pointerMove(event: ThreeEvent<PointerEvent>) {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    event.stopPropagation();
    const [horizontal, vertical] = DRAG_KEYS[start.group];
    const clamp = (n: number) => Math.round(THREE.MathUtils.clamp(n, 0, 100));
    onChange({
      [horizontal]: clamp(
        start.design.shape[horizontal] +
          (event.nativeEvent.clientX - start.x) * 0.45 * start.side,
      ),
      [vertical]: clamp(
        start.design.shape[vertical] -
          (event.nativeEvent.clientY - start.y) * 0.45,
      ),
    });
  }
  function pointerUp(event: ThreeEvent<PointerEvent>) {
    if (!drag.current || drag.current.pointer !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    (
      event.target as EventTarget & { releasePointerCapture(id: number): void }
    ).releasePointerCapture(event.pointerId);
    onCommit();
  }
  // Click selection is available in observation mode too; a camera drag is not a click.
  function click(event: ThreeEvent<MouseEvent>) {
    if (event.delta > 5 || furOnly) return;
    event.stopPropagation();
    onSelect(creatorPartFor(model, event.point));
  }
  return (
    <group
      onPointerDown={pointerDown}
      onPointerMove={direct ? pointerMove : undefined}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onClick={click}
      userData={{ selectedPart: group }}
    >
      <primitive object={model.scene} dispose={null} />
    </group>
  );
}

function Camera({
  model,
  request,
  direct,
}: {
  model: CreatorModel;
  request: ViewRequest;
  direct: boolean;
}) {
  const { camera, size, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  useEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    const { view } = request;
    if (["left", "right", "closer", "farther"].includes(view)) {
      const spherical = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(orbit.target),
      );
      if (view === "left") spherical.theta -= Math.PI / 12;
      if (view === "right") spherical.theta += Math.PI / 12;
      if (view === "closer") spherical.radius *= 0.85;
      if (view === "farther") spherical.radius *= 1.18;
      spherical.radius = THREE.MathUtils.clamp(spherical.radius, 1, 12);
      camera.position
        .copy(orbit.target)
        .add(new THREE.Vector3().setFromSpherical(spherical));
    } else {
      const framing = model.framing(view !== "whole");
      const dimensions = framing.getSize(new THREE.Vector3());
      const center = framing.getCenter(new THREE.Vector3());
      const fov = THREE.MathUtils.degToRad(
        (camera as THREE.PerspectiveCamera).fov,
      );
      const aspect = size.width / Math.max(1, size.height);
      const width =
        view === "side"
          ? dimensions.z
          : view === "three"
            ? Math.max(dimensions.x, dimensions.z)
            : dimensions.x;
      const distance =
        Math.max(
          dimensions.y / (2 * Math.tan(fov / 2) * 0.86),
          width / (2 * Math.tan(fov / 2) * aspect * 0.77),
        ) +
        Math.max(dimensions.z, dimensions.x) * 0.4;
      const direction = new THREE.Vector3(
        view === "side" ? 1 : view === "three" ? 0.65 : 0,
        0.035,
        view === "side" ? 0 : 1,
      ).normalize();
      orbit.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance);
    }
    camera.lookAt(orbit.target);
    camera.updateProjectionMatrix();
    orbit.update();
    invalidate();
  }, [model, request, camera, size.width, size.height, invalidate]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={!direct}
      enableDamping={false}
      enablePan={false}
      minDistance={1}
      maxDistance={12}
    />
  );
}

function ContextMonitor({ onError }: { onError(): void }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      onError();
    };
    canvas.addEventListener("webglcontextlost", lost);
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [gl, onError]);
  return null;
}

class Boundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError(): void },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

export default function CatCreatorScene(props: {
  model: CreatorModel;
  design: CreatorDesign;
  blink: boolean;
  grey: boolean;
  furOnly: boolean;
  pose: CreatorPose;
  living: boolean;
  paused: boolean;
  group: CreatorGroup;
  direct: boolean;
  request: ViewRequest;
  revision: number;
  fallback: ReactNode;
  onSelect(group: CreatorGroup): void;
  onChange(values: Partial<CreatorDesign["shape"]>): void;
  onCommit(): void;
  onError(): void;
  onPoseSettled(): void;
}) {
  return (
    <Boundary
      key={props.revision}
      fallback={props.fallback}
      onError={props.onError}
    >
      <Canvas
        camera={{ position: [0, 0, 5], fov: 32, near: 0.01, far: 60 }}
        dpr={[1, 1.5]}
        frameloop="demand"
        shadows="soft"
        gl={(defaults) => {
          // r186 requests alpha:true even when its constructor receives false.
          // Create the opaque context explicitly so fractional fibre coverage
          // cannot become canvas/CSS transparency after the MSAA resolve.
          const context = (defaults.canvas as HTMLCanvasElement).getContext(
            "webgl2",
            {
              alpha: false,
              antialias: true,
              depth: true,
              stencil: false,
              powerPreference: "high-performance",
            },
          ) as WebGL2RenderingContext | null;
          if (!context) throw new Error("无法创建猫咪三维预览。");
          return new THREE.WebGLRenderer({
            ...defaults,
            context,
            alpha: false,
          });
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.AgXToneMapping;
        }}
        fallback={<p>可编辑的三维猫头预览。通过部位按钮与滑块调整外观。</p>}
      >
        <Lighting model={props.model} />
        <Model {...props} />
        <Camera
          model={props.model}
          request={props.request}
          direct={props.direct}
        />
        <ContextMonitor onError={props.onError} />
        <FurComposition model={props.model} />
      </Canvas>
    </Boundary>
  );
}
