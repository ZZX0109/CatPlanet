"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { lifeDescriptions, type PetLife } from "@/lib/pet-life";

export default function PetLifePanel({ accountId, savedVersion, onSave }: {
  accountId: string | null; savedVersion: number; onSave: () => void;
}) {
  const [life, setLife] = useState<PetLife | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const serial = useRef(0);
  const load = useCallback(async () => {
    if (!accountId || !savedVersion) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const id = ++serial.current;
    const timer = setTimeout(() => controller.abort(), 25000);
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/life/visit", { method: "POST", cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "日记暂时无法读取。");
      if (id === serial.current) setLife(data.life);
    } catch (e) {
      if (id === serial.current) setError(controller.signal.aborted ? "连接超时，请重新读取日记。" : e instanceof Error ? e.message : "日记暂时无法读取，请重试。");
    } finally {
      clearTimeout(timer);
      if (id === serial.current) setLoading(false);
    }
  }, [accountId, savedVersion]);
  useEffect(() => {
    setLife(null);
    void load();
    return () => { serial.current++; request.current?.abort(); };
  }, [load]);
  if (!accountId || !savedVersion) return <section className="life-panel" aria-label="生活日记">
    <span className="record-tag story-tag">喵星虚拟故事</span>
    <h2>留下一点生活的足迹</h2>
    <p>登录并保存房间后，可以开启生活日记，下次探望时看看它的小活动。</p>
    <button type="button" onClick={onSave}>保存房间，开启日记</button>
    <p className="help">日记属于虚拟世界，不代表宠物生前的真实经历。</p>
  </section>;
  return <section className="life-panel" aria-label="生活日记" aria-busy={loading}>
    <span className="record-tag story-tag">喵星虚拟故事</span>
    <h2>{life ? `${life.petName}的生活日记` : "生活日记"}</h2>
    <p className="help">记录它在喵星的小活动，与主人填写的真实回忆分开保存。活动时间按北京时间显示。</p>
    <button type="button" disabled={loading} onClick={() => void load()}>{loading ? "正在读取日记…" : "更新生活日记"}</button>
    {error && <p className="error" role="alert">{error}</p>}
    {life?.current && <p className="life-current" role="status">最近的小活动：{lifeDescriptions[life.current.action]}</p>}
    {life?.catchUpLimited && <p className="help">离开了一段时间，这次补记最近 7 天的小活动。</p>}
    {life?.days.map(day => <article className="memory-card life-day" key={day.date}>
      <span className="record-tag story-tag">喵星虚拟故事</span>
      <h3><time dateTime={day.date}>{day.date}</time></h3>
      <p>{day.summary}</p>
      <details>
        <summary>查看这天的活动（{day.events.length}）</summary>
        <ul>{day.events.map(event => <li key={event.slot}>
          <time dateTime={event.occurredAt}>{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.occurredAt))}</time>
          <span>{lifeDescriptions[event.action]}</span>
        </li>)}</ul>
      </details>
    </article>)}
    {life && <p className="help">首次开启后开始记录；离开期间的小活动会在再次打开日记时补记。展示最近 7 天，每次最多补记 7 天。</p>}
  </section>;
}
