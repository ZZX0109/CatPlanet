"use client";

import Link from "next/link";
import { SkinnedMesh } from "three";
import { useCallback, useEffect, useRef, useState } from "react";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  creatorControls,
  creatorPresets,
  type CreatorGroup,
} from "@/lib/cat-creator-design";
import {
  cloneCreatorForExport,
  disposeCreatorExport,
  ownCreatorModel,
  type CreatorModel,
} from "@/lib/cat-creator-model";
import { useCatCreatorDesign } from "./useCatCreatorDesign";
import { downloadFaceFile } from "./TabbyFaceControls";
import CatCreatorScene, {
  type CreatorView,
  type ViewRequest,
} from "./CatCreatorScene";
import styles from "./CatCreator.module.css";
import { createNorwegianFur } from "@/lib/norwegian-fur";
import { catCoatProfiles, getCatCoatProfile } from "@/lib/cat-coat-profiles";
import type { CreatorPose } from "@/lib/cat-creator-motion";

const PARTS: { id: CreatorGroup; label: string; detail: string }[] = [
  { id: "head", label: "头型", detail: "轮廓 · 额颊 · 下颌" },
  { id: "eyes", label: "眼睛", detail: "大小 · 间距 · 倾角" },
  { id: "muzzle", label: "鼻口", detail: "鼻梁 · 胡须垫 · 凸度" },
  { id: "ears", label: "耳朵", detail: "耳廓 · 大小 · 外张" },
  { id: "fur", label: "毛发", detail: "头部 · 胸颈 · 身体" },
];
const VIEWS: { id: CreatorView; label: string }[] = [
  { id: "front", label: "正面" },
  { id: "three", label: "三分之四" },
  { id: "side", label: "侧面" },
  { id: "whole", label: "全身" },
];
const DRAG_HINTS: Record<CreatorGroup, string> = {
  head: "左右调头宽，上下调头深",
  eyes: "左右调间距，上下调大小",
  muzzle: "左右调口鼻宽度，上下调凸度",
  ears: "左右调耳廓倾角，上下调大小",
  fur: "通过滑块分别调整各部位的毛量和毛长",
};

export default function CatCreator() {
  const editor = useCatCreatorDesign();
  const [group, setGroup] = useState<CreatorGroup>("head");
  const [revision, setRevision] = useState(0);
  const [model, setModel] = useState<CreatorModel | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [graphicsFailed, setGraphicsFailed] = useState(false);
  const [grey, setGrey] = useState(false);
  const [furOnly, setFurOnly] = useState(false);
  const [blink, setBlink] = useState(false);
  const [pose, setPose] = useState<CreatorPose>("stand");
  const [living, setLiving] = useState(false);
  const [direct, setDirect] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [request, setRequest] = useState<ViewRequest>({
    view: "whole",
    serial: 0,
  });
  const [exporting, setExporting] = useState(false);
  const [fileError, setFileError] = useState("");
  const exportingRef = useRef(false);
  const viewerRef = useRef<HTMLElement>(null);
  const displayedDesign = comparing ? editor.comparison : editor.design;
  const activePreset = creatorPresets.find((preset) =>
    creatorControls.every(
      ({ key, group: controlGroup }) =>
        controlGroup === "fur" ||
        displayedDesign.shape[key] === preset.design.shape[key],
    ),
  );
  const displayedCoat = getCatCoatProfile(displayedDesign.coatType);
  const baseId = displayedCoat.baseModel;
  const displayedCoatMode = displayedDesign.coatMode ?? "groom";
  const showingGroom = baseId !== "sphynx" && displayedCoatMode === "groom";
  const showingFurOnly = furOnly && showingGroom;
  const failed = loadState === "error" || graphicsFailed;
  const ready =
    loadState === "ready" &&
    !!model &&
    model.baseId === baseId &&
    (baseId === "sphynx" || model.fur?.preparedGroom === showingGroom) &&
    !failed;
  const currentPart = PARTS.find((part) => part.id === group)!;
  const setView = useCallback(
    (view: ViewRequest["view"]) =>
      setRequest((old) => ({ view, serial: old.serial + 1 })),
    [],
  );
  const graphicsError = useCallback(() => setGraphicsFailed(true), []);
  const poseSettled = useCallback(
    () => setRequest((old) => ({ ...old, serial: old.serial + 1 })),
    [],
  );
  const selectPart = useCallback(
    (part: CreatorGroup) => {
      if (!showingFurOnly) setGroup(part);
    },
    [showingFurOnly],
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let owned: CreatorModel | null = null;
    setLoadState("loading");
    setModel(null);
    setGraphicsFailed(false);
    (async () => {
      try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2");
        if (!gl) {
          if (active) setGraphicsFailed(true);
          throw new Error("WebGL unavailable");
        }
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        const url =
          baseId === "sphynx"
            ? "/models/creator/sphynx-cat.glb"
            : "/models/creator/norwegian-cat.glb";
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Model unavailable");
        const bytes = await response.arrayBuffer();
        if (!active) return;
        const gltf = await new GLTFLoader().parseAsync(
          bytes,
          new URL("/models/creator/", window.location.href).href,
        );
        owned = ownCreatorModel(gltf.scene, gltf.animations, baseId);
        if (baseId !== "sphynx") {
          const surface = owned.meshes
            .filter((mesh) => mesh instanceof SkinnedMesh)
            .sort(
              (a, b) =>
                b.geometry.attributes.position.count -
                a.geometry.attributes.position.count,
            )[0];
          if (!surface) throw new Error("Missing cat surface");
          const fur = await createNorwegianFur(owned.scene, surface, {
            includeGroom: showingGroom,
          });
          if (!active) {
            fur.dispose();
            owned.dispose();
            owned = null;
            return;
          }
          owned.fur = fur;
          owned.scene.add(...fur.meshes);
        }
        if (!active) {
          owned.dispose();
          owned = null;
          return;
        }
        setModel(owned);
        setLoadState("ready");
      } catch {
        owned?.dispose();
        owned = null;
        if (active) setLoadState("error");
      }
    })();
    return () => {
      active = false;
      controller.abort();
      owned?.dispose();
    };
  }, [revision, baseId, showingGroom]);

  async function exportModel() {
    if (!ready || !model || exportingRef.current || comparing) return;
    exportingRef.current = true;
    setExporting(true);
    setFileError("");
    editor.commit();
    let snapshot: ReturnType<typeof cloneCreatorForExport> | undefined;
    try {
      const actualBlink = Math.max(
        blink ? 1 : 0,
        ...model.meshes.map((mesh) => {
          const index = mesh.morphTargetDictionary?.Blink;
          return index === undefined
            ? 0
            : (mesh.morphTargetInfluences?.[index] ?? 0);
        }),
      );
      snapshot = cloneCreatorForExport(model, editor.design, actualBlink);
      const { GLTFExporter } =
        await import("three/addons/exporters/GLTFExporter.js");
      const bytes = await new GLTFExporter().parseAsync(snapshot, {
        binary: true,
        onlyVisible: true,
        animations: snapshot.animations,
      });
      if (!(bytes instanceof ArrayBuffer)) throw new Error("Invalid output");
      downloadFaceFile(
        new Blob([bytes], { type: "model/gltf-binary" }),
        `miaoxing-${editor.design.coatType}-cat.glb`,
      );
    } catch {
      setFileError(
        "3D 模型未能导出，当前调整仍保留。请重试，或先导出外观 JSON 备份。",
      );
    } finally {
      disposeCreatorExport(snapshot);
      exportingRef.current = false;
      setExporting(false);
    }
  }

  const errorPanel = (
    <div className={styles.overlay} role="alert">
      <h2>{graphicsFailed ? "3D 预览暂不可用" : "猫头暂未加载成功"}</h2>
      <p>
        {graphicsFailed
          ? "请检查浏览器图形加速，或换一个支持 WebGL 的浏览器。"
          : "当前外观仍然保留，重新加载后可以继续。"}
      </p>
      <button onClick={() => setRevision((value) => value + 1)}>
        重新加载
      </button>
    </div>
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/">← 返回房间</Link>
        <span className={styles.brand}>
          喵星 <span>/ 猫咪造型室</span>
        </span>
        <div className={styles.headerActions}>
          <button
            disabled={!editor.canUndo || comparing || exporting}
            onClick={editor.undo}
          >
            撤销
          </button>
          <button
            disabled={!editor.canRedo || comparing || exporting}
            onClick={editor.redo}
          >
            重做
          </button>
          <button
            className={styles.primary}
            disabled={!editor.hydrated || comparing || exporting}
            onClick={editor.save}
          >
            保存外观
          </button>
        </div>
      </header>
      <div className={styles.heading}>
        <div>
          <p>CAT FOUNDATION</p>
          <h1>从轮廓，捏出它的模样。</h1>
        </div>
        <span className={styles.saved}>
          {editor.isSaved ? "已保存到本机" : "尚未保存"}
        </span>
      </div>
      <section className={styles.coatPicker} aria-label="基础类型">
        {catCoatProfiles.map((coat) => (
          <button
            key={coat.id}
            disabled={!editor.hydrated || comparing || exporting}
            aria-label={coat.label}
            aria-pressed={editor.design.coatType === coat.id}
            onClick={() => {
              editor.commit();
              editor.coat(coat.id);
              setFurOnly(false);
              setGrey(false);
              setDirect(false);
              setBlink(false);
              setPose("stand");
              setLiving(false);
            }}
          >
            <strong>{coat.label}</strong>
            <small>
              {coat.id === "hairless" || displayedCoatMode === "groom"
                ? coat.description
                : coat.id === "short"
                  ? "使用原素材预览，独立短毛造型仍在精修。"
                  : "保留挪威森林猫原有毛感，继续精修毛面与轮廓。"}
            </small>
          </button>
        ))}
      </section>
      <div className={styles.workspace}>
        <nav className={styles.parts} aria-label="编辑部位">
          {PARTS.map((part, index) => (
            <button
              key={part.id}
              aria-label={part.label}
              aria-pressed={group === part.id}
              onClick={() => {
                editor.commit();
                setGroup(part.id);
                setFurOnly(false);
                if (part.id === "fur") {
                  setGrey(false);
                  setDirect(false);
                }
              }}
            >
              <span className={styles.partNumber}>0{index + 1}</span>
              <span>
                <strong>{part.label}</strong>
                <small>{part.detail}</small>
              </span>
            </button>
          ))}
          <p>双侧对称编辑。可以直接点击猫头，选择想调整的部位。</p>
        </nav>
        <section
          ref={viewerRef}
          className={styles.viewer}
          aria-label="猫头塑形与观察"
        >
          <div className={styles.viewerCaption}>
            <span>
              {comparing
                ? "对照预览"
                : `${currentPart.label} · ${direct ? "拖动塑形" : "点击选择"}`}
            </span>
            <span>
              {showingFurOnly
                ? "毛发检查 · 仅看毛丝"
                : grey
                  ? "灰模 · 观察形体"
                  : `${displayedCoat.label} · ${baseId === "sphynx" ? "皮肤与褶皱" : showingGroom ? "完整被毛" : "仅看原模型"}`}
            </span>
          </div>
          <div
            className={styles.canvas}
            data-creator-ready={ready}
            data-creator-base={ready ? model.baseId : undefined}
            data-creator-coat={displayedDesign.coatType}
            data-creator-coat-mode={displayedCoatMode}
            data-creator-part={group}
            data-creator-pose={pose}
            role="region"
            tabIndex={0}
            aria-label="结构猫头三维预览"
            onKeyDown={(event) => {
              const action =
                event.key === "ArrowLeft"
                  ? "left"
                  : event.key === "ArrowRight"
                    ? "right"
                    : ["+", "="].includes(event.key)
                      ? "closer"
                      : event.key === "-"
                        ? "farther"
                        : event.key === "Home"
                          ? "front"
                          : null;
              if (action) {
                event.preventDefault();
                setView(action);
              }
            }}
          >
            {failed ? (
              errorPanel
            ) : !ready || !model ? (
              <div className={styles.overlay} role="status">
                <span className={styles.loadingDot} />
                <h2>正在准备基础猫…</h2>
                <p>
                  {baseId === "sphynx"
                    ? "正在加载皮肤、褶皱和无毛猫形体。"
                    : showingGroom
                      ? "正在加载猫咪，并准备完整被毛。"
                      : "正在加载猫咪，保留素材本身的被毛与材质。"}
                </p>
              </div>
            ) : (
              <CatCreatorScene
                model={model}
                design={displayedDesign}
                blink={blink}
                pose={pose}
                living={living && !comparing}
                paused={exporting}
                grey={grey}
                furOnly={showingFurOnly}
                group={group}
                direct={direct && !comparing && !exporting}
                request={request}
                revision={revision}
                onSelect={selectPart}
                onChange={editor.changeMany}
                onCommit={editor.commit}
                onError={graphicsError}
                onPoseSettled={poseSettled}
                fallback={errorPanel}
              />
            )}
          </div>
          <div className={styles.viewerTools}>
            <div
              className={styles.buttonGroup}
              role="group"
              aria-label="观察角度"
            >
              {VIEWS.map((view) => (
                <button
                  key={view.id}
                  aria-pressed={request.view === view.id}
                  onClick={() => setView(view.id)}
                >
                  {view.label}
                </button>
              ))}
            </div>
            {model?.supportsBlink && (
              <button
                aria-pressed={blink}
                disabled={!ready || exporting || comparing}
                onClick={() => setBlink((old) => !old)}
              >
                闭眼预览
              </button>
            )}
          </div>
          <div className={styles.motionTools}>
            <div
              className={styles.buttonGroup}
              role="group"
              aria-label="猫咪姿态"
            >
              {(
                [
                  ["stand", "站立"],
                  ["rest", "趴卧"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={pose === value}
                  disabled={!ready || comparing || exporting}
                  onClick={() => {
                    editor.commit();
                    setPose(value);
                    setDirect(false);
                    setView("whole");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              aria-pressed={living}
              disabled={!ready || comparing || exporting}
              onClick={() => setLiving((value) => !value)}
            >
              {model?.supportsBlink ? "呼吸与眨眼" : "自然呼吸"}
            </button>
          </div>
          <div className={styles.modeTools}>
            <div
              className={styles.buttonGroup}
              role="group"
              aria-label="编辑方式"
            >
              <button aria-pressed={!direct} onClick={() => setDirect(false)}>
                转动观察
              </button>
              <button
                aria-pressed={direct}
                disabled={comparing || exporting || group === "fur"}
                onClick={() => setDirect(true)}
              >
                拖动塑形
              </button>
            </div>
            <div
              className={styles.buttonGroup}
              role="group"
              aria-label="材质显示"
            >
              <button
                aria-pressed={grey}
                onClick={() => {
                  setGrey(true);
                  setFurOnly(false);
                }}
              >
                灰模
              </button>
              <button
                aria-pressed={!grey && !showingFurOnly}
                onClick={() => {
                  setGrey(false);
                  setFurOnly(false);
                }}
              >
                材质预览
              </button>
            </div>
          </div>
          <p className={styles.viewerHint}>
            {comparing
              ? "正在查看对照版本；当前编辑已保留。"
              : direct
                ? `在猫头部位上拖动：${DRAG_HINTS[group]}。也可使用右侧滑块。`
                : group === "fur"
                  ? baseId === "sphynx"
                    ? "无毛猫使用独立皮肤底模。可在头型、眼睛、鼻口和耳朵继续调整。"
                    : showingGroom
                      ? "分区调整毛量和毛长，放大或转到侧面观察毛束与轮廓。"
                      : "当前仅看原模型。切换完整被毛可恢复可调节的全身毛发。"
                  : "拖动旋转，双指或滚轮缩放。点选猫头部位，再进行精细调整。"}
          </p>
          <details className={styles.accessTools}>
            <summary>旋转与缩放按钮</summary>
            <div>
              {(
                [
                  ["left", "向左转"],
                  ["right", "向右转"],
                  ["closer", "放大"],
                  ["farther", "缩小"],
                ] as const
              ).map(([view, label]) => (
                <button key={view} onClick={() => setView(view)}>
                  {label}
                </button>
              ))}
            </div>
          </details>
        </section>
        <aside
          className={styles.panel}
          aria-label="猫头精细调整"
          onFocusCapture={(event) => {
            if (
              !window.matchMedia(
                "(max-width: 760px) and (orientation: portrait)",
              ).matches
            )
              return;
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const edge =
              (viewerRef.current?.getBoundingClientRect().bottom ?? 0) + 16;
            const box = target.getBoundingClientRect();
            if (box.top < edge || box.bottom > window.innerHeight - 16)
              target.scrollIntoView({ block: "end", behavior: "auto" });
          }}
        >
          <section className={styles.presets}>
            <h2>从一种头型开始</h2>
            <div>
              {creatorPresets.map((preset) => (
                <button
                  key={preset.id}
                  disabled={!editor.hydrated || comparing || exporting}
                  aria-label={preset.label}
                  aria-describedby={`creator-preset-${preset.id}`}
                  aria-pressed={activePreset?.id === preset.id}
                  onClick={() => {
                    editor.preset(preset.id);
                    if (request.view === "whole") setView("front");
                  }}
                >
                  <span
                    className={`${styles.presetShape} ${styles[preset.id]}`}
                    aria-hidden="true"
                  />
                  <span className={styles.presetText}>
                    <span>{preset.label}</span>
                    <span
                      id={`creator-preset-${preset.id}`}
                      className={styles.presetDetail}
                    >
                      {preset.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p>
              可切换正面与侧面观察轮廓。选择脸型保留毛量、毛长；自然脸恢复底模比例。
            </p>
          </section>
          <section className={styles.adjustments}>
            <div className={styles.sectionTitle}>
              <h2>{currentPart.label}精调</h2>
              <button
                disabled={
                  comparing ||
                  !editor.hydrated ||
                  exporting ||
                  (group === "fur" && !showingGroom)
                }
                onClick={() => editor.reset(group)}
              >
                重置部位
              </button>
            </div>
            <fieldset disabled={!editor.hydrated || comparing || exporting}>
              <legend className={styles.srOnly}>{currentPart.label}参数</legend>
              {group === "fur" && baseId === "sphynx" ? (
                <div className={styles.furIntro}>
                  <p>
                    无毛猫使用斯芬克斯猫的独立形体与皮肤褶皱，当前不植毛。切换短毛或长毛后，可选择完整被毛或仅看原模型。
                  </p>
                </div>
              ) : (
                group === "fur" && (
                  <div className={styles.furIntro}>
                    <div
                      className={styles.coatModes}
                      role="group"
                      aria-label="被毛显示"
                      aria-describedby="creator-coat-mode-description"
                    >
                      {(
                        [
                          ["groom", "完整被毛"],
                          ["source", "仅看原模型"],
                        ] as const
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={displayedCoatMode === mode}
                          onClick={() => {
                            editor.coatMode(mode);
                            setFurOnly(false);
                            setGrey(false);
                            setDirect(false);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p id="creator-coat-mode-description">
                      {showingGroom
                        ? "显示完整的程序毛层，可分区调整毛量和毛长；毛量设为 0 可隐藏对应部位的毛发。"
                        : "仅显示原模型的毛纹和局部毛束，不显示程序毛层。切回完整被毛可调整各部位毛量和毛长。"}
                    </p>
                    {!showingGroom && displayedDesign.coatType === "short" && (
                      <p>
                        当前使用挪威森林猫原素材预览，独立短毛造型仍在精修。
                      </p>
                    )}
                    {showingGroom && (
                      <button
                        type="button"
                        disabled={!ready}
                        aria-pressed={showingFurOnly}
                        onClick={() => {
                          setGrey(false);
                          setFurOnly((old) => !old);
                        }}
                      >
                        单独看毛发
                      </button>
                    )}
                  </div>
                )
              )}
              {creatorControls
                .filter(
                  (control) =>
                    control.group === group &&
                    !(group === "fur" && !showingGroom),
                )
                .map((control) => (
                  <div className={styles.control} key={control.key}>
                    <div>
                      <label htmlFor={`creator-${control.key}`}>
                        {control.label}
                      </label>
                      <output
                        htmlFor={`creator-${control.key}`}
                        aria-hidden="true"
                      >
                        {editor.design.shape[control.key]}
                        {control.group === "fur" ? "%" : ""}
                      </output>
                    </div>
                    <input
                      id={`creator-${control.key}`}
                      type="range"
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={editor.design.shape[control.key]}
                      aria-describedby={`hint-${control.key}`}
                      onChange={(event) => {
                        if (control.group === "fur") setGrey(false);
                        editor.change(control.key, Number(event.target.value));
                      }}
                      onPointerUp={editor.commit}
                      onPointerCancel={editor.commit}
                      onKeyUp={editor.commit}
                      onBlur={editor.commit}
                    />
                    <div className={styles.ends} aria-hidden="true">
                      <span>{control.low}</span>
                      <span>{control.high}</span>
                    </div>
                    <span className={styles.srOnly} id={`hint-${control.key}`}>
                      {control.description}方向键微调，Home/End 到两端。
                    </span>
                  </div>
                ))}
            </fieldset>
          </section>
          <section className={styles.comparison}>
            <h2>看看调整前后</h2>
            <div>
              <button
                disabled={!editor.hydrated || exporting}
                onClick={() => {
                  editor.captureComparison();
                  setComparing(false);
                }}
              >
                设为对照
              </button>
              <button
                disabled={exporting}
                aria-pressed={comparing}
                onClick={() => {
                  editor.commit();
                  setComparing((old) => !old);
                }}
              >
                {comparing ? "返回编辑" : "查看对照"}
              </button>
            </div>
          </section>
          <section className={styles.files}>
            <details>
              <summary>备份与导出</summary>
              <p>
                外观仅保存在当前浏览器。JSON 用于恢复编辑；GLB
                包含猫咪、毛色、骨架、脸部形变和当前姿态的毛发，导出当前静态姿态。JSON
                可恢复分区调整。
              </p>
              <div>
                <button
                  disabled={!editor.hydrated || comparing || exporting}
                  onClick={() =>
                    downloadFaceFile(
                      new Blob([JSON.stringify(editor.design, null, 2)], {
                        type: "application/json",
                      }),
                      "miaoxing-cat-foundation-v1.json",
                    )
                  }
                >
                  导出外观 JSON
                </button>
                <label>
                  导入外观 JSON
                  <input
                    type="file"
                    accept="application/json,.json"
                    aria-label="导入外观 JSON"
                    disabled={!editor.hydrated || comparing || exporting}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void editor.importFile(file);
                    }}
                  />
                </label>
              </div>
              <button
                className={styles.exportGlb}
                disabled={!ready || exporting || comparing}
                aria-busy={exporting}
                onClick={() => void exportModel()}
              >
                {exporting ? "正在打包模型…" : "导出 3D 模型（GLB）"}
              </button>
            </details>
          </section>
          <p className={styles.message} role="status">
            {editor.message}
          </p>
          {(editor.error || fileError) && (
            <p className={styles.error} role="alert">
              {editor.error || fileError}
            </p>
          )}
        </aside>
      </div>
      <footer className={styles.footer}>
        <span>
          无毛、短毛、长毛三种基础类型。默认正面站姿，可切换趴卧，或开启自然呼吸与眨眼。
        </span>
        <details>
          <summary>模型来源与制作文件</summary>
          <p>
            基于你提供的挪威森林猫和斯芬克斯猫素材，在 Blender
            副本中制作脸部形变，保留原始猫咪的材质。
            保存仅限当前浏览器；可导出外观备份。原文件、制作副本与脚本保留在本地项目中。
          </p>
        </details>
      </footer>
    </main>
  );
}
