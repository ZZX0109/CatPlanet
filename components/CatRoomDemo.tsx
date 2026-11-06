"use client";

import { useState } from "react";
import CatRoomCanvas, { type CatMode } from "@/components/CatRoomCanvas";
import BrandMark from "@/components/BrandMark";

function MoonIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 15.1A8 8 0 0 1 8.9 4.6 8.2 8.2 0 1 0 19.4 15Z" /></svg>;
}

function WalkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.1 14.2c-1.7 1.1-2.7 2.5-2.7 3.7 0 1.1.9 1.8 2.1 1.8 1.5 0 2.2-1.3 3.8-1.3s2.3 1.3 3.8 1.3c1.2 0 2.1-.7 2.1-1.8 0-1.2-1-2.6-2.7-3.7-1-.7-2.1-1-3.2-1s-2.2.3-3.2 1Z" /><ellipse cx="5.7" cy="9" rx="1.8" ry="2.4" transform="rotate(-26 5.7 9)" /><ellipse cx="10.1" cy="6.8" rx="1.8" ry="2.4" transform="rotate(-8 10.1 6.8)" /><ellipse cx="14.2" cy="7" rx="1.8" ry="2.4" transform="rotate(8 14.2 7)" /><ellipse cx="18.2" cy="9.2" rx="1.8" ry="2.4" transform="rotate(26 18.2 9.2)" /></svg>;
}

export default function CatRoomDemo() {
  const [mode, setMode] = useState<CatMode>("sleep");
  const sleeping = mode === "sleep";

  return (
    <section className="room-card" aria-label="3D 猫咪房间">
      <div className="room-topline">
        <div className="room-title">
          <span className="room-avatar"><BrandMark /></span>
          <div><strong>小橘</strong><span>我的小猫 · 居家中</span></div>
        </div>
        <div className="day-pill"><span aria-hidden="true">☼</span> 晴 · 22°</div>
      </div>

      <div className={`scene-wrap ${sleeping ? "is-sleeping" : "is-walking"}`}>
        <div className="scene-caption">
          <span className="caption-dot" />
          <span>{sleeping ? "午后小憩" : "房间散步"}</span>
          <small>{sleeping ? "安安静静地做个好梦" : "慢悠悠地四处看看"}</small>
        </div>
        <div className="canvas-frame" aria-label={`3D 猫咪当前正在${sleeping ? "睡觉" : "走路"}`}>
          <CatRoomCanvas mode={mode} />
        </div>
        {sleeping && <div className="sleep-z" aria-hidden="true"><span>Z</span><span>Z</span><span>Z</span></div>}
        <div className="room-note"><span className="note-sparkle">✦</span> 一个属于它的小小空间</div>
        <div className="corner-plant plant-one" aria-hidden="true"><i /><i /><i /><b /></div>
        <div className="corner-plant plant-two" aria-hidden="true"><i /><i /><i /><b /></div>
      </div>

      <div className="room-controls">
        <div className="state-copy">
          <span className="state-label">现在</span>
          <strong>{sleeping ? "正在睡觉" : "正在走路"}</strong>
          <span className="state-subtext">{sleeping ? "呼吸轻轻的，梦也甜甜的" : "在房间里散散步"}</span>
        </div>
        <div className="mode-controls" role="group" aria-label="切换猫咪状态">
          <button type="button" className={`mode-button ${sleeping ? "selected" : ""}`} aria-pressed={sleeping} onClick={() => setMode("sleep")}>
            <MoonIcon /> <span>睡觉</span>
          </button>
          <button type="button" className={`mode-button ${!sleeping ? "selected" : ""}`} aria-pressed={!sleeping} onClick={() => setMode("walk")}>
            <WalkIcon /> <span>走路</span>
          </button>
        </div>
      </div>
    </section>
  );
}
