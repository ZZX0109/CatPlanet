import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, transaction } from "./db";
import { ApiError } from "./security";
import { lifeCatchUpSlots, lifeHour, summarizeLife, type LifeAction, type LifeEvent, type PetLife } from "../pet-life";

function activity(userId: string, slot: number): LifeAction {
  const hour = ((slot + 8) % 24 + 24) % 24;
  if (hour >= 22 || hour < 7) return "sleep";
  const seed = createHash("sha256").update(`miaoxing-life-v1:${userId}:${slot}`).digest()[0];
  if (hour >= 7 && hour < 10 || hour >= 16 && hour < 19) return seed % 2 ? "walk" : "window";
  return (["groom", "play", "window", "sleep"] as const)[seed % 4];
}
async function snapshot(userId: string, db: Pick<PoolClient, "query"> = pool, limited = false): Promise<PetLife> {
  const { rows } = await db.query(
    "SELECT p.name,l.started_at,l.updated_at FROM pets p JOIN pet_life l ON l.user_id=p.user_id WHERE p.user_id=$1", [userId]);
  if (!rows[0]) throw new ApiError(404, "请先保存纪念房间，再开启生活日记。");
  const records = await db.query(
    "SELECT slot,action,occurred_at FROM pet_life_events WHERE user_id=$1 ORDER BY slot DESC LIMIT 192", [userId]);
  const events: LifeEvent[] = records.rows.map(row => ({ slot: Number(row.slot), action: row.action, occurredAt: row.occurred_at.toISOString(), source: "WORLD_STORY" }));
  return {
    petName: rows[0].name, startedAt: rows[0].started_at.toISOString(), updatedAt: rows[0].updated_at.toISOString(),
    current: events[0] ?? null, days: summarizeLife(events), catchUpLimited: limited,
  };
}
export async function visitPetLife(userId: string) {
  return transaction(async db => {
    // The same lock used by pet saves/deletes serializes account changes with visits.
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const pet = await db.query("SELECT user_id FROM pets WHERE user_id=$1", [userId]);
    if (!pet.rowCount) throw new ApiError(404, "请先保存纪念房间，再开启生活日记。");
    const now = (await db.query("SELECT now() AS now")).rows[0].now as Date;
    const slot = Math.floor(now.getTime() / lifeHour);
    await db.query("INSERT INTO pet_life(user_id,last_slot,started_at,updated_at) VALUES($1,$2,$3,$3) ON CONFLICT DO NOTHING", [userId, slot - 1, now]);
    const row = (await db.query("SELECT last_slot,started_at FROM pet_life WHERE user_id=$1", [userId])).rows[0];
    const last = Number(row.last_slot);
    const start = Math.max(last + 1, slot - lifeCatchUpSlots + 1);
    for (let next = start; next <= slot; next++) {
      const occurred = new Date(Math.max(next * lifeHour, row.started_at.getTime()));
      await db.query("INSERT INTO pet_life_events(user_id,slot,action,occurred_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [userId, next, activity(userId, next), occurred]);
    }
    // Clock regressions must not rewind or duplicate already recorded activities.
    await db.query("UPDATE pet_life SET last_slot=GREATEST(last_slot,$2),updated_at=GREATEST(updated_at,$3) WHERE user_id=$1", [userId, slot, now]);
    await db.query("DELETE FROM pet_life_events WHERE user_id=$1 AND occurred_at<$2::timestamptz-interval '30 days'", [userId, now]);
    return snapshot(userId, db, slot - last > lifeCatchUpSlots);
  });
}
export const readPetLife = (userId: string) => snapshot(userId);
