"use client";

import { faceControls, type FaceKey } from "@/lib/tabby-face";
import { useFaceDesign } from "./useFaceDesign";
import styles from "./CatBaseReview.module.css";

export function downloadFaceFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const GROUPS: { title: string; keys: FaceKey[] }[] = [
  {
    title: "脸型与口鼻",
    keys: ["faceWidth", "cheeks", "muzzleLength", "noseWidth"],
  },
  { title: "眼睛", keys: ["eyeSize", "eyeSpacing"] },
  { title: "耳朵", keys: ["earSize", "earSpacing"] },
];
const ENDS: Record<FaceKey, [string, string]> = {
  faceWidth: ["窄一些", "宽一些"],
  cheeks: ["清瘦", "饱满"],
  muzzleLength: ["短一些", "长一些"],
  noseWidth: ["窄一些", "宽一些"],
  eyeSize: ["小一些", "大一些"],
  eyeSpacing: ["靠近", "分开"],
  earSize: ["小一些", "大一些"],
  earSpacing: ["靠近", "分开"],
};

export default function TabbyFaceControls({
  editor,
  exporting,
  canExport,
  onExport,
}: {
  editor: ReturnType<typeof useFaceDesign>;
  exporting: boolean;
  canExport: boolean;
  onExport: () => void;
}) {
  return (
    <>
      <div className={styles.editorIntro}>
        <div className={styles.panelTitle}>
          <h2>捏出它的模样</h2>
          <span className={styles.saveBadge}>
            {editor.isSaved ? "已保存到本机" : "尚未保存"}
          </span>
        </div>
        <p>从这只虎斑猫开始，慢慢调整熟悉的轮廓。</p>
        <div className={styles.historyButtons}>
          <button
            disabled={!editor.canUndo || !editor.hydrated}
            onClick={editor.undo}
          >
            撤销
          </button>
          <button
            disabled={!editor.canRedo || !editor.hydrated}
            onClick={editor.redo}
          >
            重做
          </button>
          <button disabled={!editor.hydrated} onClick={editor.reset}>
            重置捏脸
          </button>
        </div>
      </div>
      <fieldset className={styles.faceFields} disabled={!editor.hydrated}>
        <legend className={styles.srOnly}>猫咪脸部参数</legend>
        {GROUPS.map((group, index) => (
          <section
            className={styles.faceGroup}
            key={group.title}
            aria-label={group.title}
          >
            <h3>
              <span>0{index + 1}</span>
              {group.title}
            </h3>
            {group.keys.map((key) => {
              const control = faceControls.find((item) => item.key === key)!;
              const value = editor.design.shape[key];
              return (
                <div className={styles.faceControl} key={key}>
                  <div className={styles.sliderHeading}>
                    <label htmlFor={`face-${key}`}>{control.label}</label>
                    <output htmlFor={`face-${key}`} aria-hidden="true">
                      {value}
                    </output>
                  </div>
                  <input
                    id={`face-${key}`}
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={value}
                    aria-describedby={`face-${key}-hint`}
                    onChange={(event) =>
                      editor.change(key, Number(event.target.value))
                    }
                    onPointerUp={editor.commit}
                    onPointerCancel={editor.commit}
                    onKeyUp={editor.commit}
                    onBlur={editor.commit}
                  />
                  <div className={styles.sliderEnds} aria-hidden="true">
                    <span>{ENDS[key][0]}</span>
                    <span>{ENDS[key][1]}</span>
                  </div>
                  <span id={`face-${key}-hint`} className={styles.srOnly}>
                    {control.description}50 为基础形状；使用方向键微调，Home 和
                    End 跳至两端。
                  </span>
                </div>
              );
            })}
          </section>
        ))}
      </fieldset>
      <section className={styles.saveSection} aria-label="保存与导入导出">
        <button
          className={styles.primaryButton}
          disabled={!editor.hydrated}
          onClick={editor.save}
        >
          保存外观
        </button>
        <p className={styles.storageHint}>
          保存在当前浏览器，无需登录，也不会上传。换浏览器前请导出 JSON 备份。
        </p>
        <div className={styles.fileButtons}>
          <button
            disabled={!editor.hydrated}
            onClick={() => {
              editor.commit();
              downloadFaceFile(
                new Blob([JSON.stringify(editor.design, null, 2)], {
                  type: "application/json",
                }),
                "miaoxing-tabby-face.json",
              );
            }}
          >
            导出外观 JSON
          </button>
          <label className={styles.importButton}>
            导入外观 JSON
            <input
              type="file"
              accept="application/json,.json"
              aria-label="导入外观 JSON"
              disabled={!editor.hydrated}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void editor.importFile(file);
              }}
            />
          </label>
        </div>
        <button
          className={styles.exportModel}
          disabled={!canExport || exporting}
          aria-busy={exporting}
          onClick={onExport}
        >
          {exporting ? "正在打包模型…" : "导出 3D 模型（GLB）"}
        </button>
        <p className={styles.editorMessage} role="status">
          {editor.message}
        </p>
        {editor.error && (
          <p className={styles.editorError} role="alert">
            {editor.error}
          </p>
        )}
      </section>
    </>
  );
}
