"use client";

import Link from "next/link";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { attachFaceMorphs, type FaceDesign } from "@/lib/tabby-face";
import { useFaceDesign } from "./useFaceDesign";
import TabbyFaceControls, { downloadFaceFile } from "./TabbyFaceControls";
import styles from "./CatBaseReview.module.css";

const CATS = (
  [
    {
      id: "tabby",
      name: "虎斑猫",
      note: "完整站姿 · 棕色虎斑",
      url: "/models/review/tabby-web.glb",
      source: "https://grab3d.com/models/animals/cat/",
      author: "Grab3D",
      license: "免费可修改 · CC0",
      licenseUrl: "https://grab3d.com/dl/cat/LICENSE.txt",
      head: { min: [-0.56, 0.85, 0.2], max: [-0.05, 1.31, 0.63] },
    },
    {
      id: "ginger",
      name: "橘猫",
      note: "站立体型 · 橘色虎斑",
      url: "/api/studio-preview/ginger",
      source:
        "https://www.blendkit.com/asset-gallery-detail/6d772d59-15f2-4a57-a593-e664765448f1/",
      author: "Paweł Wałasiewicz / Blendkit",
      license: "免费 · Royalty Free",
      licenseUrl: "https://www.blendkit.com/docs/licenses/",
      head: { min: [-0.3, 1.02, 0.62], max: [0.3, 1.5, 1.26] },
    },
  ] as const
).filter((cat) => cat.id === "tabby" || process.env.NODE_ENV === "development");

type CatId = (typeof CATS)[number]["id"];
type View = "front" | "side" | "three" | "face";
type CameraAction = View | "left" | "right" | "closer" | "farther";
type CameraRequest = { action: CameraAction; serial: number };
type ModelResource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  materials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  face: ReturnType<typeof attachFaceMorphs> | null;
  dispose: () => void;
};
const VIEWS: { id: View; label: string }[] = [
  { id: "three", label: "三分之四" },
  { id: "front", label: "正面" },
  { id: "side", label: "侧面" },
  { id: "face", label: "脸部近看" },
];

// The loader owns this scene. Keep its original resources separately so switching
// to the shared grey material does not lose the textures that need disposal.
function resourceFor(scene: THREE.Group, editable: boolean): ModelResource {
  const materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const geometries = new Set<THREE.BufferGeometry>();
  const sourceMaterials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = true;
    node.receiveShadow = true;
    materials.set(node, node.material);
    geometries.add(node.geometry);
    if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      sourceMaterials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  const bounds = new THREE.Box3().setFromObject(scene);
  let face: ReturnType<typeof attachFaceMorphs> | null = null;
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    face?.dispose();
    geometries.forEach((geometry) => geometry.dispose());
    sourceMaterials.forEach((material) => material.dispose());
    skeletons.forEach((skeleton) => skeleton.dispose());
    textures.forEach((texture) => {
      const image = texture.source?.data;
      if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
        image.close();
      texture.dispose();
    });
  }
  try {
    face = editable ? attachFaceMorphs(scene) : null;
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    scene,
    bounds,
    materials,
    face,
    dispose,
  };
}

function ReviewModel({
  model,
  grey,
  design,
}: {
  model: ModelResource;
  grey: boolean;
  design: FaceDesign;
}) {
  const greyMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#bcb7af",
        roughness: 0.78,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    model.face?.apply(design);
    invalidate();
  }, [model, design, invalidate]);
  useEffect(() => {
    model.materials.forEach((original, mesh) => {
      mesh.material = grey ? greyMaterial : original;
    });
    invalidate();
    return () => {
      model.materials.forEach((original, mesh) => {
        mesh.material = original;
      });
    };
  }, [model, grey, greyMaterial, invalidate]);
  useEffect(() => () => greyMaterial.dispose(), [greyMaterial]);
  return <primitive object={model.scene} dispose={null} />;
}

function ReviewEnvironment() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const environment = generator.fromScene(room, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.65;
    room.dispose();
    generator.dispose();
    invalidate();
    return () => {
      scene.environment = null;
      environment.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}

function CameraControls({
  bounds,
  request,
  onManual,
  reduced,
  head,
}: {
  bounds: THREE.Box3;
  request: CameraRequest;
  onManual: () => void;
  reduced: boolean;
  head: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
}) {
  const { camera, size, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const sizeOfCat = useMemo(
    () => bounds.getSize(new THREE.Vector3()),
    [bounds],
  );
  const headBounds = useMemo(
    () =>
      new THREE.Box3(
        new THREE.Vector3(...head.min),
        new THREE.Vector3(...head.max),
      ),
    [head],
  );
  useEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(sizeOfCat.x, sizeOfCat.y, sizeOfCat.z);
    const { action } = request;
    if (
      action === "left" ||
      action === "right" ||
      action === "closer" ||
      action === "farther"
    ) {
      const offset = camera.position.clone().sub(orbit.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (action === "left") spherical.theta -= Math.PI / 12;
      if (action === "right") spherical.theta += Math.PI / 12;
      if (action === "closer") spherical.radius *= 0.8;
      if (action === "farther") spherical.radius *= 1.25;
      spherical.radius = THREE.MathUtils.clamp(
        spherical.radius,
        maxDimension * 0.22,
        maxDimension * 5,
      );
      camera.position
        .copy(orbit.target)
        .add(offset.setFromSpherical(spherical));
    } else {
      const aspect = size.width / Math.max(size.height, 1);
      const fov =
        camera instanceof THREE.PerspectiveCamera
          ? THREE.MathUtils.degToRad(camera.fov)
          : Math.PI / 6;
      const direction = new THREE.Vector3(
        action === "side"
          ? 1
          : action === "three"
            ? 0.85
            : action === "face"
              ? 0.293
              : 0,
        action === "face" ? 0.015 : 0.12,
        action === "side" ? 0 : action === "face" ? 0.956 : 1,
      ).normalize();
      const target = center.clone();
      let distance: number;
      if (action === "face") {
        // A raised tail and an off-centre head make whole-body bounds unsuitable
        // for a close-up. Fit the measured head, in both portrait and landscape.
        headBounds.getCenter(target);
        const headSize = headBounds.getSize(new THREE.Vector3());
        distance =
          headSize.z / 2 +
          Math.max(
            headSize.x / (2 * Math.tan(fov / 2) * aspect * 0.8),
            headSize.y / (2 * Math.tan(fov / 2) * 0.76),
          );
      } else {
        target.y = bounds.min.y + sizeOfCat.y * 0.48;
        const projectedWidth =
          Math.abs(direction.x) * sizeOfCat.z +
          Math.abs(direction.z) * sizeOfCat.x;
        const projectedDepth =
          Math.abs(direction.x) * sizeOfCat.x +
          Math.abs(direction.z) * sizeOfCat.z;
        distance =
          (Math.max(sizeOfCat.y, projectedWidth / aspect) * 0.6) /
            Math.tan(fov / 2) +
          projectedDepth * 0.5;
      }
      orbit.target.copy(target);
      camera.position.copy(target).addScaledVector(direction, distance);
    }
    camera.lookAt(orbit.target);
    camera.updateProjectionMatrix();
    orbit.update();
    invalidate();
  }, [
    bounds,
    camera,
    size.width,
    size.height,
    sizeOfCat,
    request,
    invalidate,
    headBounds,
  ]);
  const maxDimension = Math.max(sizeOfCat.x, sizeOfCat.y, sizeOfCat.z);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      enableDamping={!reduced}
      dampingFactor={0.08}
      minDistance={maxDimension * 0.22}
      maxDistance={maxDimension * 5}
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI / 2 + 0.08}
      target={[0, 0.75, 0]}
      onStart={onManual}
    />
  );
}

function ContextEvents({ onLost }: { onLost: () => void }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const lost = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => gl.domElement.removeEventListener("webglcontextlost", lost);
  }, [gl, onLost]);
  return null;
}

class ViewerBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function CatBaseReview({
  showComparison = false,
}: {
  showComparison?: boolean;
}) {
  const candidates = useMemo(
    () => CATS.filter((cat) => cat.id === "tabby" || showComparison),
    [showComparison],
  );
  const [catId, setCatId] = useState<CatId>("tabby");
  const [revision, setRevision] = useState(0);
  const [model, setModel] = useState<ModelResource | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [webgl, setWebgl] = useState<"checking" | "ready" | "error">(
    "checking",
  );
  const [contextLost, setContextLost] = useState(false);
  const [grey, setGrey] = useState(false);
  const editor = useFaceDesign();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [reduced, setReduced] = useState(false);
  const [view, setView] = useState<View | null>("face");
  const [request, setRequest] = useState<CameraRequest>({
    action: "face",
    serial: 0,
  });
  const selected = CATS.find((cat) => cat.id === catId)!;
  const selectView = useCallback((action: CameraAction) => {
    setView(
      action === "left" ||
        action === "right" ||
        action === "closer" ||
        action === "farther"
        ? null
        : action,
    );
    setRequest((old) => ({ action, serial: old.serial + 1 }));
  }, []);
  const manual = useCallback(() => setView(null), []);
  const lost = useCallback(() => setContextLost(true), []);
  const retry = useCallback(() => {
    setContextLost(false);
    setLoadState("loading");
    setModel(null);
    setWebgl("checking");
    setRevision((old) => old + 1);
  }, []);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    try {
      const context = canvas.getContext("webgl2");
      setWebgl(context ? "ready" : "error");
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      setWebgl("error");
    }
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let loaded: ModelResource | null = null;
    setModel(null);
    setLoadState("loading");
    setView("face");
    setRequest((old) => ({ action: "face", serial: old.serial + 1 }));
    (async () => {
      try {
        const response = await fetch(selected.url, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Model unavailable");
        const bytes = await response.arrayBuffer();
        if (!active) return;
        const path = new URL(".", new URL(selected.url, window.location.href))
          .href;
        const gltf = await new GLTFLoader().parseAsync(bytes, path);
        loaded = resourceFor(gltf.scene, selected.id === "tabby");
        if (!active) {
          loaded.dispose();
          loaded = null;
          return;
        }
        const extent = loaded.bounds.getSize(new THREE.Vector3());
        if (
          loaded.bounds.isEmpty() ||
          ![extent.x, extent.y, extent.z].every(Number.isFinite)
        )
          throw new Error("Invalid model bounds");
        setModel(loaded);
        setLoadState("ready");
      } catch {
        loaded?.dispose();
        loaded = null;
        if (active) setLoadState("error");
      }
    })();
    return () => {
      active = false;
      controller.abort();
      loaded?.dispose();
    };
  }, [selected.url, selected.id, revision]);

  async function exportModel() {
    if (!model?.face || exporting) return;
    editor.commit();
    setExporting(true);
    setExportError("");
    try {
      // Mesh.copy copies target weights, while geometry and textures remain shared.
      // Export the snapshot with original materials even when the viewer is grey.
      model.face.apply(editor.design);
      const snapshot = model.scene.clone(true);
      const originals = [...model.materials.values()];
      let meshIndex = 0;
      snapshot.traverse((node) => {
        if (node instanceof THREE.Mesh) node.material = originals[meshIndex++];
      });
      snapshot.userData = {
        ...snapshot.userData,
        miaoxingFaceDesign: editor.design,
        license: "CC0-1.0",
        source: "https://grab3d.com/models/animals/cat/",
      };
      const { GLTFExporter } =
        await import("three/addons/exporters/GLTFExporter.js");
      const bytes = await new GLTFExporter().parseAsync(snapshot, {
        binary: true,
      });
      if (!(bytes instanceof ArrayBuffer))
        throw new Error("Invalid GLB output");
      downloadFaceFile(
        new Blob([bytes], { type: "model/gltf-binary" }),
        "miaoxing-tabby-face.glb",
      );
    } catch {
      setExportError(
        "模型导出失败，当前调整已保留。请重试，也可以先导出外观 JSON。 ",
      );
    } finally {
      setExporting(false);
    }
  }

  const failed = loadState === "error" || webgl === "error" || contextLost;
  const loading = !failed && (loadState === "loading" || webgl === "checking");
  const errorPanel = (
    <div className={styles.overlay} role="alert">
      <span className={styles.overlayMark} aria-hidden="true">
        ↻
      </span>
      <h2>
        {webgl === "error"
          ? "当前浏览器暂时无法显示 3D"
          : contextLost
            ? "3D 预览已暂停"
            : "这只猫暂时没有加载成功"}
      </h2>
      <p>
        {webgl === "error"
          ? "请开启浏览器的图形加速，或换一个支持 3D 的浏览器再试。"
          : "你的捏脸调整仍保留，可以重新加载后继续。"}
      </p>
      <button className={styles.primaryButton} onClick={retry}>
        重新加载
      </button>
    </div>
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>
          <span aria-hidden="true">←</span> 返回房间
        </Link>
        <span className={styles.wordmark}>
          喵星<span> / </span>猫咪工作室
        </span>
      </header>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>虎斑猫 · 外观编辑</p>
          <h1>一点点，靠近它的模样。</h1>
        </div>
        <p className={styles.scope}>
          先从熟悉的脸开始<span>自由调整，随时撤销，保存属于你的版本。</span>
        </p>
      </div>
      <div className={styles.layout}>
        <section className={styles.viewer} aria-label="基础猫三维预览">
          <div className={styles.viewerCaption}>
            <span>{selected.name}</span>
            <span>
              {grey
                ? "灰模轮廓"
                : catId === "tabby"
                  ? "实时捏脸预览"
                  : "仅供对照"}
            </span>
          </div>
          <div
            className={styles.canvasArea}
            data-review-ready={!failed && !loading}
            data-review-cat={catId}
            tabIndex={0}
            role="region"
            aria-label="旋转与缩放猫咪。左右方向键旋转，加减键缩放，Home 键重置。"
            onKeyDown={(event) => {
              const action =
                event.key === "ArrowLeft"
                  ? "left"
                  : event.key === "ArrowRight"
                    ? "right"
                    : event.key === "+" || event.key === "="
                      ? "closer"
                      : event.key === "-"
                        ? "farther"
                        : event.key === "Home"
                          ? "three"
                          : null;
              if (action) {
                event.preventDefault();
                selectView(action);
              }
            }}
          >
            {failed ? (
              errorPanel
            ) : loading ? (
              <div className={styles.overlay} role="status">
                <span className={styles.loadingDot} aria-hidden="true" />
                <h2>正在加载{selected.name}…</h2>
                <p>保留原有细节，请稍等片刻。</p>
              </div>
            ) : (
              model && (
                <ViewerBoundary
                  key={`${catId}-${revision}`}
                  fallback={errorPanel}
                >
                  <Canvas
                    key={`${catId}-${revision}`}
                    camera={{
                      position: [4, 2, 5],
                      fov: 34,
                      near: 0.02,
                      far: 80,
                    }}
                    dpr={[1, 1.5]}
                    frameloop="demand"
                    shadows="percentage"
                    gl={{
                      antialias: true,
                      powerPreference: "high-performance",
                      toneMapping: THREE.ACESFilmicToneMapping,
                    }}
                    fallback={<p>猫咪三维预览，可使用角度与缩放按钮观察。</p>}
                  >
                    <color attach="background" args={["#e8e4dd"]} />
                    <ReviewEnvironment />
                    <hemisphereLight args={["#fffaf1", "#a59a8e", 0.75]} />
                    <directionalLight
                      position={[-3, 5, 4]}
                      color="#fff9f1"
                      intensity={2.2}
                      castShadow
                      shadow-mapSize={[1024, 1024]}
                      shadow-camera-left={-4}
                      shadow-camera-right={4}
                      shadow-camera-top={4}
                      shadow-camera-bottom={-4}
                      shadow-normalBias={0.015}
                    />
                    <directionalLight
                      position={[4, 3, -2]}
                      intensity={0.8}
                      color="#edf2ff"
                    />
                    <ReviewModel
                      model={model}
                      grey={grey}
                      design={editor.design}
                    />
                    <mesh
                      rotation={[-Math.PI / 2, 0, 0]}
                      position={[0, -0.008, 0]}
                      receiveShadow
                    >
                      <planeGeometry args={[200, 200]} />
                      <meshStandardMaterial color="#e8e4dd" roughness={1} />
                    </mesh>
                    <CameraControls
                      bounds={model.bounds}
                      head={selected.head}
                      request={request}
                      onManual={manual}
                      reduced={reduced}
                    />
                    <ContextEvents onLost={lost} />
                  </Canvas>
                </ViewerBoundary>
              )
            )}
          </div>
          <div className={styles.viewerFooter}>
            <div className={styles.views} role="group" aria-label="观察角度">
              {VIEWS.map((item) => (
                <button
                  key={item.id}
                  aria-pressed={view === item.id}
                  onClick={() => selectView(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p>拖动旋转 · 滚轮或双指缩放</p>
          </div>
        </section>
        <aside className={styles.panel} aria-label="捏脸与外观保存">
          {showComparison && (
            <section className={styles.panelSection}>
              <h2>{showComparison ? "母模对照" : "当前基础猫"}</h2>
              <div
                className={styles.candidates}
                role="group"
                aria-label="基础猫候选"
              >
                {candidates.map((cat, index) => (
                  <button
                    key={cat.id}
                    className={styles.candidate}
                    aria-pressed={catId === cat.id}
                    onClick={() => {
                      if (catId === cat.id) return;
                      setContextLost(false);
                      setLoadState("loading");
                      setModel(null);
                      setCatId(cat.id);
                    }}
                  >
                    <span className={styles.candidateNumber}>0{index + 1}</span>
                    <span>
                      <strong>{cat.name}</strong>
                      <small>{cat.note}</small>
                    </span>
                    <span className={styles.selectionMark} aria-hidden="true">
                      {catId === cat.id ? "✓" : "+"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {catId === "tabby" ? (
            <TabbyFaceControls
              editor={editor}
              exporting={exporting}
              canExport={!!model?.face && !failed && editor.hydrated}
              onExport={() => void exportModel()}
            />
          ) : (
            <div className={styles.checkpoints}>
              <h2>只读对照</h2>
              <p>
                这只橘猫用于本地观察。切回虎斑猫可继续捏脸，之前的调整会保留。
              </p>
            </div>
          )}
          {exportError && (
            <p className={styles.editorError} role="alert">
              {exportError}
            </p>
          )}
          <details className={styles.observation}>
            <summary>观察工具</summary>
            <label className={styles.greyToggle}>
              <span>
                <strong>灰材质</strong>
                <small>去掉毛色，检查真实轮廓</small>
              </span>
              <input
                type="checkbox"
                checked={grey}
                onChange={(event) => setGrey(event.target.checked)}
              />
              <span className={styles.toggleTrack} aria-hidden="true" />
            </label>
            <div
              className={styles.cameraButtons}
              role="group"
              aria-label="旋转与缩放"
            >
              <button onClick={() => selectView("left")}>
                <span aria-hidden="true">↶</span> 向左转
              </button>
              <button onClick={() => selectView("right")}>
                <span aria-hidden="true">↷</span> 向右转
              </button>
              <button onClick={() => selectView("closer")}>
                <span aria-hidden="true">＋</span> 放大
              </button>
              <button onClick={() => selectView("farther")}>
                <span aria-hidden="true">−</span> 缩小
              </button>
            </div>
            <button
              className={styles.resetButton}
              onClick={() => selectView("three")}
            >
              重置观察角度
            </button>
          </details>
          <section className={styles.checkpoints}>
            <h2>关于这次捏脸</h2>
            <p>
              本轮调整脸部轮廓、眼睛区域和耳朵的形状。眼睛细节与毛色来自原贴图，暂不支持眨眼、改毛色或走路；这只猫也尚未接入纪念房间。
            </p>
          </section>
          <section className={styles.source}>
            <h2>模型来源与许可</h2>
            <a href={selected.source} target="_blank" rel="noreferrer">
              {selected.author}
              <span aria-hidden="true"> ↗</span>
            </a>
            <a href={selected.licenseUrl} target="_blank" rel="noreferrer">
              {selected.license}
            </a>
            <p>
              {catId === "tabby"
                ? "基于免费 CC0 素材修改，可导出带形变的静态模型。"
                : "仅用于本地母模对照。"}
              {catId === "tabby" ? "来源标注为 AI 辅助制作。" : ""}
            </p>
          </section>
        </aside>
      </div>
      <p className={styles.status} role="status">
        {failed
          ? "预览暂不可用，捏脸调整已保留，可以重试。"
          : loading
            ? "正在准备模型。"
            : `正在查看${selected.name}，${grey ? "灰材质" : "原始外观"}，${view ? VIEWS.find((item) => item.id === view)?.label : "自由视角"}。`}
      </p>
    </main>
  );
}
