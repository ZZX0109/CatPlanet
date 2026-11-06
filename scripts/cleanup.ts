import { pool, transaction } from "../lib/server/db";
import { flushDeletions } from "../lib/server/storage";
async function main() {
  await transaction(async (db) => {
    await db.query(
      "INSERT INTO deletion_queue(storage_key) SELECT storage_key FROM photos p WHERE created_at<now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM pets WHERE photo_id=p.id) ON CONFLICT DO NOTHING",
    );
    await db.query(
      "DELETE FROM photos p WHERE created_at<now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM pets WHERE photo_id=p.id)",
    );
    await db.query("DELETE FROM pet_life_events WHERE occurred_at<now()-interval '30 days'");
    await db.query("DELETE FROM sessions WHERE expires_at<now()");
    await db.query(
      "DELETE FROM challenges WHERE expires_at<now()-interval '1 day'",
    );
    await db.query("DELETE FROM rate_limits WHERE resets_at<now()");
  });
  await flushDeletions();
}
main().finally(() => pool.end());
