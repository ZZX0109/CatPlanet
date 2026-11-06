/** Virtual activities never enter the owner's real memories. All times are UTC ISO. */
export const lifeActions = ["sleep", "walk", "groom", "play", "window"] as const;
export type LifeAction = (typeof lifeActions)[number];
export const lifeDescriptions: Record<LifeAction, string> = {
  sleep: "在柔软的垫子上休息了一会儿。",
  walk: "绕着房间慢慢走了一圈。",
  groom: "安静地梳理了身上的毛。",
  play: "追着小玩具玩了一会儿。",
  window: "坐在窗边，看了一会儿外面的光影。",
};
export type LifeEvent = { slot: number; action: LifeAction; occurredAt: string; source: "WORLD_STORY" };
export type LifeDay = { date: string; summary: string; events: LifeEvent[]; source: "WORLD_STORY" };
export type PetLife = {
  petName: string;
  startedAt: string;
  updatedAt: string;
  current: LifeEvent | null;
  days: LifeDay[];
  catchUpLimited: boolean;
};
export const lifeHour = 60 * 60 * 1000;
export const lifeCatchUpSlots = 7 * 24;
export function storyDate(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * lifeHour).toISOString().slice(0, 10);
}
export function summarizeLife(events: LifeEvent[]): LifeDay[] {
  const groups = new Map<string, LifeEvent[]>();
  for (const event of events) {
    const date = storyDate(event.occurredAt);
    groups.set(date, [...(groups.get(date) ?? []), event]);
  }
  const names: Record<LifeAction, string> = { sleep: "休息", walk: "散步", groom: "梳毛", play: "玩耍", window: "看窗外" };
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 7).map(([date, items]) => {
    const ordered = [...items].sort((a, b) => a.slot - b.slot);
    const activities = [...new Set(ordered.map(e => names[e.action]))];
    return { date, summary: `这一天的小活动：${activities.join("、")}。`, events: ordered.reverse(), source: "WORLD_STORY" };
  });
}
