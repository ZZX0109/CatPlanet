import { currentRoomAsset, roomModelAsset } from "@/lib/room-model-assets";
import { readPetLife, visitPetLife } from "@/lib/server/pet-life";
import { parseCreatorDesign } from "@/lib/cat-creator-design";
import { randomInt, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import sharp from "sharp";
import { pool, transaction } from "@/lib/server/db";
import {
  ApiError,
  checkOrigin,
  cookieName,
  cookieOptions,
  hash,
  jsonBody,
  newToken,
  rateLimit,
  readLimited,
  requireUser,
  user,
} from "@/lib/server/security";
import { sendCode } from "@/lib/server/mail";
import { flushDeletions, getPhoto, putPhoto } from "@/lib/server/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const petSchema = z.object({
  name: z.string().trim().min(1).max(40),
  model: z.enum(["toon", "vuena"]),
  personality: z.string().max(1000),
  memories: z
    .array(
      z.object({
        id: z.string().uuid(),
        text: z.string().trim().min(1).max(3000),
      }),
    )
    .max(50),
  photoId: z.string().uuid().nullable(),
  appearanceAsset: z.string().max(100).nullable().optional(),
  appearance: z.unknown().optional().transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    try { return parseCreatorDesign(value); }
    catch { ctx.addIssue({ code: "custom", message: "无法识别猫咪外观。" }); return z.NEVER; }
  }),
  version: z.number().int().min(0),
});
async function getPet(id: string) {
  const { rows } = await pool.query(
    "SELECT name,model,appearance,appearance_asset AS \"appearanceAsset\",personality,photo_id AS \"photoId\",version,COALESCE((SELECT json_agg(json_build_object('id',id,'text',text) ORDER BY position) FROM memories WHERE user_id=pets.user_id),'[]'::json) AS memories FROM pets WHERE user_id=$1",
    [id],
  );
  if (!rows[0]) return null;
  return rows[0];
}
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const route = (await context.params).path.join("/");
  const method = request.method;
  try {
    if (method !== "GET") checkOrigin(request);
    if (route === "auth/code" && method === "POST") {
      const { email } = z
        .object({ email: emailSchema })
        .parse(await jsonBody(request, 1000));
      // Only trust the edge header when our own reverse proxy overwrites it.
      const ip =
        process.env.TRUST_PROXY === "1"
          ? request.headers.get("x-real-ip") || "unknown"
          : "local";
      await rateLimit(`send:${ip}`, 30, 3600);
      await rateLimit(`send:${email}`, 5, 3600);
      const code = String(randomInt(100000, 1000000));
      const inserted = await pool.query(
        "INSERT INTO challenges(email,code_hash,expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(email) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,sent_at=now(),attempts=0 WHERE challenges.sent_at<now()-interval '60 seconds' RETURNING email",
        [email, hash(`${email}:${code}`)],
      );
      if (!inserted.rowCount)
        throw new ApiError(429, "请等待 60 秒后重新发送。");
      try {
        await sendCode(email, code);
      } catch {
        await pool.query(
          "DELETE FROM challenges WHERE email=$1 AND code_hash=$2",
          [email, hash(`${email}:${code}`)],
        );
        throw new ApiError(503, "邮件暂时发送失败，请稍后重试。草稿仍然保留。");
      }
      return Response.json({ ok: true });
    }
    if (route === "auth/verify" && method === "POST") {
      const { email, code } = z
        .object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) })
        .parse(await jsonBody(request, 1000));
      await rateLimit(`verify:${email}`, 30, 3600);
      const token = newToken();
      const account = await transaction(async (db) => {
        const { rows } = await db.query(
          "SELECT * FROM challenges WHERE email=$1 FOR UPDATE",
          [email],
        );
        const challenge = rows[0];
        if (
          !challenge ||
          challenge.expires_at <= new Date() ||
          challenge.attempts >= 5
        )
          return null;
        await db.query(
          "UPDATE challenges SET attempts=attempts+1 WHERE email=$1",
          [email],
        );
        if (challenge.code_hash !== hash(`${email}:${code}`)) return null;
        await db.query("DELETE FROM challenges WHERE email=$1", [email]);
        const saved = await db.query(
          "INSERT INTO users(id,email) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING id,email",
          [randomUUID(), email],
        );
        await db.query(
          "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
          [hash(token), saved.rows[0].id],
        );
        return saved.rows[0];
      });
      if (!account)
        throw new ApiError(400, "验证码错误、已过期或尝试过多，请重新获取。");
      (await cookies()).set(cookieName, token, cookieOptions);
      return Response.json({ user: account, pet: await getPet(account.id) });
    }
    if (route === "session" && method === "GET") {
      const account = await user();
      return Response.json({
        user: account || null,
        pet: account ? await getPet(account.id) : null,
      });
    }
    if (route === "auth/logout" && method === "POST") {
      const jar = await cookies();
      const token = jar.get(cookieName)?.value;
      if (token)
        await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
          hash(token),
        ]);
      jar.set(cookieName, "", { ...cookieOptions, maxAge: 0 });
      return Response.json({ ok: true });
    }
    const account = await requireUser();
    if (route === "life" && method === "GET")
      return Response.json({ life: await readPetLife(account.id) });
    if (route === "life/visit" && method === "POST") {
      await rateLimit(`life:${account.id}`, 60, 3600);
      return Response.json({ life: await visitPetLife(account.id) });
    }
    if (route === "pet" && method === "GET")
      return Response.json({ pet: await getPet(account.id) });
    if (route === "pet" && method === "PUT") {
      const data = petSchema.parse(await jsonBody(request, 200_000));
      if (new Set(data.memories.map((m) => m.id)).size !== data.memories.length)
        throw new ApiError(400, "回忆编号重复。");
      const saved = await transaction(async (db) => {
        await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          account.id,
        ]);
        const current = (
          await db.query("SELECT version,photo_id,appearance_asset FROM pets WHERE user_id=$1", [
            account.id,
          ])
        ).rows[0];
        if ((current?.version || 0) !== data.version)
          throw new ApiError(
            409,
            "另一设备已更新资料。请先读取云端版本再保存；当前输入仍然保留。",
          );
        if (
          data.photoId &&
          !(
            await db.query("SELECT id FROM photos WHERE id=$1 AND user_id=$2", [
              data.photoId,
              account.id,
            ])
          ).rowCount
        )
          throw new ApiError(404, "照片不存在，请重新选择。");
        let appearanceAsset: string | null = current?.appearance_asset ?? null;
        if (data.appearance !== undefined) {
          if (data.appearance === null) appearanceAsset = null;
          else {
            let candidate = data.appearanceAsset;
            if (candidate == null) {
              try { if (appearanceAsset) roomModelAsset(appearanceAsset, data.appearance); }
              catch { appearanceAsset = null; }
              candidate = appearanceAsset ?? currentRoomAsset(data.appearance);
            }
            try { roomModelAsset(candidate, data.appearance); }
            catch { throw new ApiError(400, "猫咪模型版本与外观不匹配，请重新导入外观。"); }
            appearanceAsset = candidate;
          }
        } else if (data.appearanceAsset != null) {
          throw new ApiError(400, "更新模型版本时请同时提交完整外观。");
        }
        const nextVersion = data.version + 1;
        await db.query(
          "INSERT INTO pets(user_id,name,model,personality,photo_id,version,appearance,appearance_asset) VALUES($1,$2,$3,$4,$5,$6,$7,$9) ON CONFLICT(user_id) DO UPDATE SET name=$2,model=$3,personality=$4,photo_id=$5,version=$6,appearance=CASE WHEN $8 THEN $7::jsonb ELSE pets.appearance END,appearance_asset=CASE WHEN $8 THEN $9 ELSE pets.appearance_asset END,updated_at=now()",
          [
            account.id,
            data.name,
            data.model,
            data.personality,
            data.photoId,
            nextVersion,
            data.appearance == null ? null : JSON.stringify(data.appearance),
            data.appearance !== undefined,
            appearanceAsset,
          ],
        );
        await db.query("DELETE FROM memories WHERE user_id=$1", [account.id]);
        for (const [position, memory] of data.memories.entries())
          await db.query(
            "INSERT INTO memories(id,user_id,text,position) VALUES($1,$2,$3,$4)",
            [memory.id, account.id, memory.text, position],
          );
        if (current?.photo_id && current.photo_id !== data.photoId) {
          await db.query(
            "INSERT INTO deletion_queue(storage_key) SELECT storage_key FROM photos WHERE id=$1 AND user_id=$2 ON CONFLICT DO NOTHING",
            [current.photo_id, account.id],
          );
          await db.query("DELETE FROM photos WHERE id=$1 AND user_id=$2", [
            current.photo_id,
            account.id,
          ]);
        }
        return { version: nextVersion, appearanceAsset };
      });
      await flushDeletions();
      return Response.json(saved);
    }
    if (route === "pet" && method === "DELETE") {
      await transaction(async (db) => {
        await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          account.id,
        ]);
        await db.query(
          "INSERT INTO deletion_queue(storage_key) SELECT storage_key FROM photos WHERE user_id=$1 ON CONFLICT DO NOTHING",
          [account.id],
        );
        await db.query("DELETE FROM pets WHERE user_id=$1", [account.id]);
        await db.query("DELETE FROM photos WHERE user_id=$1", [account.id]);
      });
      await flushDeletions();
      return Response.json({ ok: true });
    }
    if (route === "photos" && method === "POST") {
      await rateLimit(`upload:${account.id}`, 30, 3600);
      const raw = await readLimited(request, 5 * 1024 * 1024);
      let image: Buffer;
      try {
        const input = sharp(raw, {
          limitInputPixels: 25_000_000,
          animated: false,
        });
        const metadata = await input.metadata();
        if (!["jpeg", "png", "webp"].includes(metadata.format || ""))
          throw new Error("format");
        image = await input
          .rotate()
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();
      } catch {
        throw new ApiError(
          400,
          "请选择有效的 JPG、PNG 或 WebP 图片（最多 2500 万像素）。",
        );
      }
      const id = randomUUID(),
        key = `${id}.webp`;
      // Queue before upload: a crash cannot leave an untracked object forever.
      await pool.query(
        "INSERT INTO deletion_queue(storage_key,created_at) VALUES($1,now()+interval '1 day')",
        [key],
      );
      await putPhoto(key, image);
      await transaction(async (db) => {
        await db.query(
          "INSERT INTO photos(id,user_id,storage_key) VALUES($1,$2,$3)",
          [id, account.id, key],
        );
        await db.query("DELETE FROM deletion_queue WHERE storage_key=$1", [
          key,
        ]);
      });
      return Response.json({ id });
    }
    const photoId = route.startsWith("photos/") ? route.slice(7) : null;
    if (photoId && z.string().uuid().safeParse(photoId).success) {
      const photo = (
        await pool.query(
          "SELECT storage_key FROM photos WHERE id=$1 AND user_id=$2",
          [photoId, account.id],
        )
      ).rows[0];
      if (!photo) throw new ApiError(404, "照片不存在。");
      if (method === "GET")
        return new Response(new Uint8Array(await getPhoto(photo.storage_key)), {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      if (method === "DELETE") {
        const { version } = z
          .object({ version: z.number().int().min(0) })
          .parse(await jsonBody(request, 1000));
        await transaction(async (db) => {
          await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
            account.id,
          ]);
          const current = (
            await db.query(
              "SELECT version,photo_id FROM pets WHERE user_id=$1",
              [account.id],
            )
          ).rows[0];
          if (current?.photo_id === photoId && current.version !== version)
            throw new ApiError(
              409,
              "另一设备已更新资料，请读取云端版本后再删除照片。",
            );
          await db.query(
            "UPDATE pets SET photo_id=NULL,version=version+1 WHERE user_id=$1 AND photo_id=$2",
            [account.id, photoId],
          );
          await db.query(
            "INSERT INTO deletion_queue(storage_key) VALUES($1) ON CONFLICT DO NOTHING",
            [photo.storage_key],
          );
          await db.query("DELETE FROM photos WHERE id=$1 AND user_id=$2", [
            photoId,
            account.id,
          ]);
        });
        await flushDeletions();
        return Response.json({ ok: true, pet: await getPet(account.id) });
      }
    }
    throw new ApiError(404, "接口不存在。");
  } catch (error) {
    const status =
      error instanceof ApiError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 503;
    if (status === 503) console.error("api_failed", { route, method });
    return Response.json(
      {
        error:
          error instanceof ApiError
            ? error.message
            : status === 400
              ? "请检查输入内容及长度。"
              : "服务暂时不可用，请稍后重试。当前输入仍然保留。",
      },
      { status },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
