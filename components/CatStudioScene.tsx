"use client";
import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as T from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildCat } from "@/lib/cat-builder";
import { type CatDesign, type Pose } from "@/lib/cat-studio";
export type BuiltCat = ReturnType<typeof buildCat>;
function Model({
  design,
  pose,
  paused,
  reduced,
  ready,
  wireframe,
}: {
  design: CatDesign;
  pose: Pose;
  paused: boolean;
  reduced: boolean;
  ready: (cat: BuiltCat | null) => void;
  wireframe: boolean;
}) {
  const cat = useMemo(() => buildCat(design), [design]);
  const t = useRef(0);
  const motion = useRef({ rest: 0, walk: 0 });
  useEffect(() => {
    cat.group.traverse((o) => {
      if (o instanceof T.Mesh && o.name === "CatBody")
        (o.material as T.MeshPhysicalMaterial).wireframe = wireframe;
      if (o.name === "ShortCoat") o.visible = !wireframe;
    });
  }, [cat, wireframe]);
  useEffect(() => {
    ready(cat);
    return () => {
      ready(null);
      cat.dispose();
    };
  }, [cat, ready]);
  useFrame((_, delta) => {
    if (!paused && !reduced) t.current += Math.min(delta, 0.05);
    motion.current.rest = reduced
      ? pose === "rest"
        ? 1
        : 0
      : T.MathUtils.damp(
          motion.current.rest,
          pose === "rest" ? 1 : 0,
          5,
          Math.min(delta, 0.05),
        );
    motion.current.walk = reduced
      ? pose === "walk"
        ? 1
        : 0
      : T.MathUtils.damp(
          motion.current.walk,
          pose === "walk" ? 1 : 0,
          5,
          Math.min(delta, 0.05),
        );
    cat.pose(t.current, pose, reduced, motion.current);
  });
  return <primitive object={cat.group} dispose={null} />;
}
class Boundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="studio-fallback">
        <h2>3D 预览暂时不可用</h2>
        <p>外观参数仍然保留。请使用支持 WebGL 的浏览器。</p>
        <button onClick={() => this.setState({ error: false })}>
          重试预览
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function CameraRig({ view }: { view: "front" | "side" | "three" | "face" }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const position =
      view === "face"
        ? [0.7, 1.65, 2.75]
        : view === "front"
          ? [0, 1.8, 5.5]
          : view === "side"
            ? [6.8, 1.8, -0.3]
            : [3.5, 2.25, 4.5];
    const fit = size.width / size.height < 0.9 ? 1.5 : 1;
    camera.position.set(
      position[0] * fit,
      1 + (position[1] - 1) * fit,
      position[2] * fit,
    );
    camera.lookAt(
      0,
      view === "face" ? 1.35 : 1,
      view === "face" ? 0.75 : view === "side" ? -0.3 : 0,
    );
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, view]);
  return null;
}
function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const generator = new T.PMREMGenerator(gl),
      room = new RoomEnvironment();
    const windowLight = new T.Mesh(
      new T.PlaneGeometry(2, 3),
      new T.MeshBasicMaterial({ color: new T.Color(5, 4.9, 4.7) }),
    );
    windowLight.position.set(-3, 3.2, 4);
    windowLight.lookAt(0, 1.4, 0.8);
    room.add(windowLight);
    const target = generator.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.38;
    room.dispose();
    generator.dispose();
    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [gl, scene]);
  return null;
}
export default function CatStudioScene(props: {
  design: CatDesign;
  pose: Pose;
  paused: boolean;
  reduced: boolean;
  view: "front" | "side" | "three" | "face";
  wireframe: boolean;
  ready: (cat: BuiltCat | null) => void;
}) {
  const camera: [number, number, number] =
    props.view === "front"
      ? [0, 1.6, 4.7]
      : props.view === "side"
        ? [6.8, 1.8, -0.3]
        : [3.5, 2.25, 4.5];
  return (
    <Boundary>
      <Canvas
        camera={{ position: camera, fov: 34, near: 0.1, far: 30 }}
        dpr={[1, 1.6]}
        shadows="percentage"
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <color attach="background" args={["#e9e5df"]} />
        <CameraRig view={props.view} />
        <StudioEnvironment />
        <ambientLight intensity={0.06} />
        <hemisphereLight args={["#f6f7f6", "#8b8275", 0.4]} />
        <directionalLight
          position={[-3, 5, 4]}
          intensity={2.4}
          color="#fff5e8"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-3}
          shadow-camera-right={3}
          shadow-camera-top={3}
          shadow-camera-bottom={-3}
          shadow-bias={-0.0005}
          shadow-normalBias={0.008}
          shadow-radius={4}
        />
        <directionalLight
          position={[3, 2, -2]}
          intensity={0.4}
          color="#dce7ec"
        />
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -0.012, 0]}
          receiveShadow
        >
          <planeGeometry args={[200, 200]} />
          <meshStandardMaterial color="#ddd7cf" roughness={1} />
        </mesh>
        <Model {...props} />
        <OrbitControls
          makeDefault
          target={
            props.view === "face"
              ? [0, 1.35, 0.75]
              : props.view === "side"
                ? [0, 1, -0.3]
                : [0, 1, 0]
          }
          minDistance={props.view === "face" ? 1.1 : 2.4}
          maxDistance={12}
          maxPolarAngle={Math.PI * 0.49}
          enablePan={false}
        />
        {props.wireframe && (
          <Grid
            args={[6, 6]}
            cellSize={0.25}
            cellColor="#b4aaa0"
            sectionColor="#998e80"
            position={[0, 0.002, 0]}
          />
        )}
      </Canvas>
    </Boundary>
  );
}
