import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

async function serve(
  request: Request,
  context: { params: Promise<{ base: string }> },
  head = false,
) {
  const { base } = await context.params;
  if (base !== "norwegian" && base !== "sphynx")
    return new Response(null, { status: 404 });
  const folder = path.join(process.cwd(), "public/models/creator");
  const filename = path.join(folder, `${base}-cat.glb`);
  try {
    const [sourceStat, rawManifest] = await Promise.all([
      stat(filename),
      readFile(path.join(folder, `${base}-manifest.json`), "utf8"),
    ]);
    const manifest = JSON.parse(rawManifest);
    const packed = manifest.storageOptimization;
    const acceptsGzip = (request.headers.get("accept-encoding") || "")
      .split(",")
      .some((entry) => {
        const [coding, ...options] = entry.trim().toLowerCase().split(";");
        if (coding !== "gzip") return false;
        return !options.some((option) =>
          /^q\s*=\s*0(?:\.0*)?$/.test(option.trim()),
        );
      });
    const compressedStat =
      acceptsGzip &&
      packed?.outputSha256 === manifest.outputSha256 &&
      packed.afterBytes === sourceStat.size
        ? await stat(`${filename}.gz`).catch(() => null)
        : null;
    // A generator publishes its manifest without storageOptimization. Until the
    // matching compressed derivative is ready, safely serve the fresh raw model.
    const gzip =
      !!compressedStat &&
      compressedStat.size === packed.gzipBytes &&
      compressedStat.mtimeMs >= sourceStat.mtimeMs;
    const size = gzip ? compressedStat!.size : sourceStat.size;
    const etag = `"${gzip ? packed.gzipSha256 : manifest.outputSha256}"`;
    const headers: Record<string, string> = {
      "Content-Type": "model/gltf-binary",
      "Content-Length": String(size),
      "Cache-Control": "public, max-age=0, must-revalidate",
      Vary: "Accept-Encoding",
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
    };
    if (gzip) headers["Content-Encoding"] = "gzip";
    if (
      (request.headers.get("if-none-match") || "")
        .split(",")
        .some((tag) => tag.trim().replace(/^W\//, "") === etag)
    )
      return new Response(null, { status: 304, headers });
    const bytes = head
      ? null
      : new Uint8Array(await readFile(gzip ? `${filename}.gz` : filename));
    return new Response(bytes, { headers });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return new Response(null, { status: 404 });
    throw error;
  }
}

export const GET = (
  request: Request,
  context: { params: Promise<{ base: string }> },
) => serve(request, context);
export const HEAD = (
  request: Request,
  context: { params: Promise<{ base: string }> },
) => serve(request, context, true);
