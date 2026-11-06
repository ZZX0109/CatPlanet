"use client";
import { useRef, useState } from "react";
import { parseCreatorDesign, type CreatorDesign } from "@/lib/cat-creator-design";
import { getCatCoatProfile } from "@/lib/cat-coat-profiles";

/** Explicit import keeps room edits independent of in-progress studio edits. */
export default function RoomAppearanceControls({ appearance, onChange }: {
  appearance?: CreatorDesign | null;
  onChange: (appearance: CreatorDesign | null) => void;
}) {
  const [error, setError] = useState("");
  const serial = useRef(0);
  return <div className="photo-editor">
    <p>{appearance ? `当前外观：${getCatCoatProfile(appearance.coatType).label}` : "当前使用基础猫外观"}</p>
    <a href="/studio/base" target="_blank" rel="noreferrer">打开猫咪造型室（新窗口）</a>
    <label className="file-label">导入造型室外观 JSON
      <input type="file" accept=".json,application/json" onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        const request = ++serial.current;
        try {
          if (file.size > 64 * 1024) throw new Error();
          const design = parseCreatorDesign(JSON.parse(await file.text()));
          if (request !== serial.current) return;
          onChange(design); setError("");
        } catch { if (request === serial.current) setError("无法导入，请选择造型室导出的外观 JSON。当前外观已保留。"); }
      }} />
    </label>
    {appearance && <button type="button" className="text-button" onClick={() => { serial.current++; onChange(null); setError(""); }}>恢复基础猫外观</button>}
    <small>在造型室导出外观 JSON 后导入，点击保存房间即可随账号恢复。定制猫当前以站姿陪伴，走路和趴卧待接入。</small>
    {error && <p role="alert">{error}</p>}
  </div>;
}
