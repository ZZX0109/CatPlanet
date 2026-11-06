"use client";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import {
  defaultDesign,
  designKey,
  parseDesign,
  presets,
  shapeControls,
  type CatDesign,
  type Pose,
} from "@/lib/cat-studio";
import type { BuiltCat } from "./CatStudioScene";
import "./cat-studio.css";
const Scene = dynamic(() => import("./CatStudioScene"), {
  ssr: false,
  loading: () => <div className="studio-fallback">正在雕刻基础形体…</div>,
});
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export default function CatStudio() {
  const [design, setDesign] = useState<CatDesign>(defaultDesign);
  const deferred = useDeferredValue(design);
  const [past, setPast] = useState<CatDesign[]>([]),
    [future, setFuture] = useState<CatDesign[]>([]);
  const start = useRef<CatDesign | null>(null),
    current = useRef(design);
  current.current = design;
  const [tab, setTab] = useState("脸部"),
    [pose, setPose] = useState<Pose>("stand"),
    [paused, setPaused] = useState(false),
    [reduced, setReduced] = useState(false);
  const [view, setView] = useState<"front" | "side" | "three" | "face">(
      "three",
    ),
    [wireframe, setWireframe] = useState(false);
  const [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [exporting, setExporting] = useState(false);
  const model = useRef<BuiltCat | null>(null);
  const [ready, setReady] = useState(false);
  const onReady = useCallback((cat: BuiltCat | null) => {
    model.current = cat;
    setReady(!!cat);
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    try {
      const raw = localStorage.getItem(designKey);
      if (raw) {
        setDesign(parseDesign(JSON.parse(raw)));
        setSaved(true);
        setNotice("已恢复这台设备保存的外观。");
      }
    } catch {
      setError("本地外观读取失败，可以重新设计或导入文件。");
    }
    return () => media.removeEventListener("change", update);
  }, []);
  const replace = (next: CatDesign) => {
    setPast((p) => [...p.slice(-39), design]);
    setFuture([]);
    setDesign(next);
    setSaved(false);
    setNotice("");
  };
  function commit() {
    if (
      start.current &&
      JSON.stringify(start.current) !== JSON.stringify(current.current)
    ) {
      const before = start.current;
      setPast((p) => [...p.slice(-39), before]);
      setFuture([]);
    }
    start.current = null;
  }
  async function exportModel() {
    if (!model.current || deferred !== design) return;
    setExporting(true);
    setError("");
    try {
      const { GLTFExporter } =
        await import("three/addons/exporters/GLTFExporter.js");
      const { buildCat } = await import("@/lib/cat-builder");
      const snapshot = buildCat(design);
      let buffer: ArrayBuffer | { [key: string]: unknown };
      try {
        buffer = await new GLTFExporter().parseAsync(snapshot.group, {
          binary: true,
          animations: snapshot.clips,
          onlyVisible: true,
        });
      } finally {
        snapshot.dispose();
      }
      download(
        new Blob([buffer as ArrayBuffer], { type: "model/gltf-binary" }),
        "miaoxing-cat.glb",
      );
      setNotice(
        "已导出带骨架、外形变形和动作的 GLB，可在 Blender 中继续编辑。",
      );
    } catch {
      setError("模型导出失败，请重试。外观参数仍然保留。");
    } finally {
      setExporting(false);
    }
  }
  return (
    <main className="cat-studio">
      <header className="studio-header">
        <a href="/" className="studio-brand">
          喵星 <span>/ 猫咪工作室</span>
        </a>
        <div>
          <button
            disabled={!past.length}
            onClick={() => {
              const prev = past.at(-1)!;
              setFuture((f) => [design, ...f]);
              setDesign(prev);
              setPast((p) => p.slice(0, -1));
              setSaved(false);
            }}
          >
            撤销
          </button>
          <button
            disabled={!future.length}
            onClick={() => {
              setPast((p) => [...p, design]);
              setDesign(future[0]);
              setFuture((f) => f.slice(1));
              setSaved(false);
            }}
          >
            重做
          </button>
          <button
            className="studio-primary"
            onClick={() => {
              try {
                localStorage.setItem(designKey, JSON.stringify(design));
                setSaved(true);
                setNotice("外观已保存在这台设备。");
                setError("");
              } catch {
                setError("浏览器无法保存，请下载外观文件。");
              }
            }}
          >
            保存外观
          </button>
        </div>
      </header>
      <div className="studio-layout">
        <section className="studio-viewport" aria-label="猫咪三维建模预览">
          <div className="studio-caption">
            <span>SHORTHAIR / 01</span>
            <h1>慢慢捏出，熟悉的它。</h1>
            <p>拖动旋转 · 双指或滚轮缩放</p>
            {process.env.NODE_ENV === "development" && (
              <a className="studio-base-link" href="/studio/base">
                打开结构猫头造型室 →
              </a>
            )}
          </div>
          <div
            className="studio-canvas"
            data-design={JSON.stringify(design.shape)}
            data-ready={ready}
          >
            <Scene
              design={deferred}
              pose={pose}
              paused={paused}
              reduced={reduced}
              view={view}
              wireframe={wireframe}
              ready={onReady}
            />
          </div>
          <div className="studio-views" role="group" aria-label="观察角度">
            {(
              [
                ["three", "全身"],
                ["front", "正面"],
                ["face", "近看"],
                ["side", "侧面"],
              ] as const
            ).map(([value, name]) => (
              <button
                key={value}
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                {name}
              </button>
            ))}
            <button
              aria-pressed={wireframe}
              onClick={() => setWireframe(!wireframe)}
            >
              网格
            </button>
          </div>
          <div className="studio-motion">
            <div role="group" aria-label="动作预览">
              {(
                [
                  ["stand", "站立"],
                  ["walk", "走路"],
                  ["rest", "趴卧"],
                ] as const
              ).map(([value, name]) => (
                <button
                  key={value}
                  aria-pressed={pose === value}
                  onClick={() => setPose(value)}
                >
                  {name}
                </button>
              ))}
            </div>
            <button
              disabled={reduced}
              aria-pressed={paused}
              onClick={() => setPaused(!paused)}
            >
              {paused ? "继续动作" : "暂停动作"}
            </button>
            <small>
              {reduced
                ? "已遵循系统减少动态效果设置"
                : "调整外形后，换个动作检查一下"}
            </small>
          </div>
        </section>
        <aside className="studio-panel">
          <div className="studio-panel-heading">
            <span>猫咪外观</span>
            <small>{saved ? "已保存在本机" : "尚未保存"}</small>
          </div>
          <div className="studio-tabs" role="group" aria-label="编辑部位">
            {["脸部", "体型", "毛色"].map((t) => (
              <button
                key={t}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="studio-fields">
            {tab !== "毛色" ? (
              <>
                {shapeControls
                  .filter((c) => c.group === tab)
                  .map((c) => (
                    <label className="studio-slider" key={c.key}>
                      <span>
                        {c.label}
                        <output>{design.shape[c.key]}</output>
                      </span>
                      <input
                        type="range"
                        aria-label={c.label}
                        min={0}
                        max={100}
                        value={design.shape[c.key]}
                        onPointerDown={() => {
                          start.current = design;
                        }}
                        onPointerUp={commit}
                        onPointerCancel={commit}
                        onFocus={() => {
                          start.current = current.current;
                        }}
                        onBlur={commit}
                        onKeyUp={commit}
                        onKeyDown={() => {
                          if (!start.current) start.current = current.current;
                        }}
                        onChange={(e) => {
                          if (!start.current) start.current = design;
                          setDesign((d) => ({
                            ...d,
                            shape: {
                              ...d.shape,
                              [c.key]: Number(e.target.value),
                            },
                          }));
                          setSaved(false);
                          setNotice("");
                        }}
                      />
                      <small>
                        <span>{c.low}</span>
                        <span>{c.high}</span>
                      </small>
                    </label>
                  ))}
                <p className="studio-help">
                  范围经过限制，保留短毛猫的基本比例。可从正面、侧面检查轮廓。
                </p>
              </>
            ) : (
              <>
                <label>
                  毛色样式
                  <select
                    value={design.pattern}
                    onChange={(e) =>
                      replace({
                        ...design,
                        pattern: e.target.value as CatDesign["pattern"],
                      })
                    }
                  >
                    <option value="solid">纯色</option>
                    <option value="tabby">虎斑 · 白下巴</option>
                    <option value="bicolor">白胸 · 白手套</option>
                    <option value="calico">三花</option>
                  </select>
                </label>
                {(
                  [
                    ["coat", "基础毛色"],
                    ["markings", "花纹颜色"],
                    ["eyes", "虹膜颜色"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="studio-color" key={key}>
                    {label}
                    <input
                      type="color"
                      value={design[key]}
                      onFocus={() => {
                        start.current = current.current;
                      }}
                      onBlur={commit}
                      onChange={(e) => {
                        if (!start.current) start.current = design;
                        setDesign((d) => ({ ...d, [key]: e.target.value }));
                        setSaved(false);
                      }}
                    />
                  </label>
                ))}
                <p className="studio-help">
                  短毛、胡须和眼部高光会随外形一起显示。
                </p>
              </>
            )}
          </div>
          <div className="studio-presets">
            <h2>从基础外观开始</h2>
            <div>
              {presets.map((p) => (
                <button
                  key={p.name}
                  onClick={() => replace(structuredClone(p.design))}
                >
                  <i style={{ background: p.design.coat }} />
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <details className="studio-files">
            <summary>外观文件与模型</summary>
            <p>外观文件可重新导入。GLB 用于在建模软件里继续编辑。</p>
            <button
              onClick={() =>
                download(
                  new Blob([JSON.stringify(design, null, 2)], {
                    type: "application/json",
                  }),
                  "miaoxing-cat.json",
                )
              }
            >
              下载外观文件
            </button>
            <label className="studio-file-label">
              导入外观文件
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 10_000)
                      throw new Error("文件太大，请选择外观 JSON 文件。");
                    replace(parseDesign(JSON.parse(await file.text())));
                    setError("");
                    setNotice("已导入外观。");
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "文件读取失败。",
                    );
                  }
                  e.target.value = "";
                }}
              />
            </label>
            <button
              disabled={!ready || exporting || deferred !== design}
              onClick={exportModel}
            >
              {exporting ? "正在导出…" : "导出 3D 模型（GLB）"}
            </button>
            <button onClick={() => replace(structuredClone(defaultDesign))}>
              恢复默认外观
            </button>
          </details>
          <div className="studio-status" aria-live="polite">
            {notice && <p>{notice}</p>}
            {error && (
              <p role="alert" className="studio-error">
                {error}
              </p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
