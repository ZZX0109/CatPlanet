import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { pool } from "./db";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function hash(value: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  return createHmac("sha256", secret).update(value).digest("hex");
}
export const cookieName = "miaoxing_session";
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};
export async function user() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const { rows } = await pool.query(
    "SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [hash(token)],
  );
  return rows[0] as { id: string; email: string } | undefined;
}
export async function requireUser() {
  const account = await user();
  if (!account) throw new ApiError(401, "请先登录，当前输入仍然保留。");
  return account;
}
export function checkOrigin(request: Request) {
  if (
    request.headers.get("origin") !==
    (process.env.APP_ORIGIN || "http://localhost:3000")
  )
    throw new ApiError(403, "请求来源不正确，请刷新网页后重试。");
}
export async function rateLimit(key: string, limit: number, seconds: number) {
  const { rows } = await pool.query(
    "INSERT INTO rate_limits(key,count,resets_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.resets_at<now() THEN 1 ELSE rate_limits.count+1 END,resets_at=CASE WHEN rate_limits.resets_at<now() THEN EXCLUDED.resets_at ELSE rate_limits.resets_at END RETURNING count",
    [hash(key), seconds],
  );
  if (rows[0].count > limit)
    throw new ApiError(429, "操作太频繁，请稍后再试。");
}
export function newToken() {
  return randomBytes(32).toString("base64url");
}
export async function jsonBody(request: Request, max = 100_000) {
  const buffer = await readLimited(request, max);
  try {
    return JSON.parse(buffer.toString());
  } catch {
    throw new ApiError(400, "请求内容格式不正确。");
  }
}
export async function readLimited(request: Request, max: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "缺少请求内容。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new ApiError(413, "内容太大，请选择 5 MB 以内的照片。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
