import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

for (const base of ["norwegian", "sphynx"]) {
  test(`${base} model transfer is compressed without changing decoded geometry bytes`, async ({
    request,
  }) => {
    const manifest = JSON.parse(
      await readFile(`public/models/creator/${base}-manifest.json`, "utf8"),
    );
    const url = `/models/creator/${base}-cat.glb`;
    const zipped = await request.get(url, {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(zipped.status()).toBe(200);
    expect(zipped.headers()["content-encoding"]).toBe("gzip");
    expect(zipped.headers()["content-type"]).toContain("model/gltf-binary");
    expect(Number(zipped.headers()["content-length"])).toBe(
      manifest.storageOptimization.gzipBytes,
    );
    const decoded = await zipped.body();
    expect(createHash("sha256").update(decoded).digest("hex")).toBe(
      manifest.outputSha256,
    );
    expect(decoded.readUInt32LE(0)).toBe(0x46546c67);
    const plain = await request.get(url, {
      headers: { "Accept-Encoding": "gzip;q=0, identity" },
    });
    expect(plain.status()).toBe(200);
    expect(plain.headers()["content-encoding"]).toBeUndefined();
    expect(
      createHash("sha256")
        .update(await plain.body())
        .digest("hex"),
    ).toBe(manifest.outputSha256);
    const cached = await request.get(url, {
      headers: {
        "Accept-Encoding": "gzip",
        "If-None-Match": zipped.headers().etag,
      },
    });
    expect(cached.status()).toBe(304);
    expect((await cached.body()).length).toBe(0);
  });
}

test("model delivery accepts only the authored public foundations", async ({
  request,
}) => {
  expect((await request.get("/api/creator-assets/unknown")).status()).toBe(404);
});
