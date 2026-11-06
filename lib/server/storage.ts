import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import COS from "cos-nodejs-sdk-v5";
import { pool } from "./db";

// Runtime private data must never be traced into a Next.js build artifact.
const localRoot = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.PHOTO_DIR || ".data/photos",
  );
function cos() {
  return new COS({
    SecretId: process.env.TENCENT_SECRET_ID!,
    SecretKey: process.env.TENCENT_SECRET_KEY!,
  });
}
const remote = () => {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.STORAGE_DRIVER !== "cos"
  )
    throw new Error("production_requires_private_cos");
  return process.env.STORAGE_DRIVER === "cos";
};
function params(key: string) {
  return {
    Bucket: process.env.COS_BUCKET!,
    Region: process.env.COS_REGION!,
    Key: key,
  };
}
export async function putPhoto(key: string, body: Buffer) {
  if (remote()) {
    await cos().putObject({
      ...params(key),
      Body: body,
      ContentType: "image/webp",
      ACL: "private",
    });
  } else {
    await mkdir(/* turbopackIgnore: true */ localRoot(), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      /* turbopackIgnore: true */ path.join(
        /* turbopackIgnore: true */ localRoot(),
        key,
      ),
      body,
      { mode: 0o600 },
    );
  }
}
export async function getPhoto(key: string): Promise<Buffer> {
  if (remote()) {
    const result = await cos().getObject(params(key));
    return Buffer.from(result.Body as Buffer);
  }
  return readFile(
    /* turbopackIgnore: true */ path.join(
      /* turbopackIgnore: true */ localRoot(),
      key,
    ),
  );
}
export async function deleteObject(key: string) {
  if (remote()) await cos().deleteObject(params(key));
  else
    await unlink(
      /* turbopackIgnore: true */ path.join(
        /* turbopackIgnore: true */ localRoot(),
        key,
      ),
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
}
// A durable queue keeps object deletion recoverable if COS is temporarily unavailable.
export async function flushDeletions() {
  const { rows } = await pool.query(
    "SELECT storage_key FROM deletion_queue WHERE created_at<=now() LIMIT 100",
  );
  for (const row of rows) {
    try {
      await deleteObject(row.storage_key);
      await pool.query("DELETE FROM deletion_queue WHERE storage_key=$1", [
        row.storage_key,
      ]);
    } catch {
      console.error("storage_delete_failed");
    }
  }
}
