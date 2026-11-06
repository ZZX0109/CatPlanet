import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

// The royalty-free source is for local asset evaluation. It is deliberately
// excluded from public/ and production images; this is not a model download API.
export async function GET() {
  if (process.env.NODE_ENV !== "development")
    return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(
      path.join(process.cwd(), "assets/processed/ginger-cat/preview.glb"),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return new Response(null, { status: 404 });
    throw error;
  }
}
