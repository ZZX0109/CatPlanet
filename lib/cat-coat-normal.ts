import * as THREE from "three";

let sharedNormal: THREE.CanvasTexture | null = null;

function deterministicRandom() {
  let state = 0x5c47f123;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shared, seamless tangent-space micro-groom texture. The strands run mostly in
 * the V direction; broad coat colors remain entirely in the albedo layer.
 * Treat this texture as immutable and do not dispose it with an individual cat.
 */
export function createCoatNormal(): THREE.Texture {
  if (sharedNormal) return sharedNormal;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create the coat detail texture.");

  const height = new Float32Array(size * size);
  const tau = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const drift = Math.sin(v * tau * 2) * 0.1 + Math.sin(v * tau * 5) * 0.035;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Low-amplitude underfur gives continuity without making the entire coat
      // into long parallel embossed grooves or a high-frequency stamped comb.
      height[y * size + x] =
        Math.sin(tau * (u * 37 + drift)) * 0.035 +
        Math.sin(tau * (u * 67 - drift * 0.65 + 0.23)) * 0.018;
    }
  }

  // Short, overlapping fibres taper at both ends. Each fibre has its own width,
  // length, slight sweep and height, so the normal pattern reads as groomed hair
  // rather than a periodic corrugated material. Toroidal writes preserve seams.
  const random = deterministicRandom();
  const wrap = (coordinate: number) => ((coordinate % size) + size) % size;
  for (let strand = 0; strand < 2_400; strand++) {
    const centerX = random() * size;
    const startY = random() * size;
    const length = 9 + random() * 27;
    const width = 0.55 + random() * 0.55;
    const sweep = (random() - 0.5) * 0.075;
    const bend = (random() - 0.5) * 0.7;
    const strength = 0.07 + random() * 0.13;
    const lastRow = Math.ceil(startY + length);
    for (let y = Math.floor(startY); y <= lastRow; y++) {
      const t = (y - startY) / length;
      if (t <= 0 || t >= 1) continue;
      const envelope = Math.sin(t * Math.PI) ** 0.8;
      const xCenter =
        centerX + sweep * length * t + Math.sin(t * Math.PI) * bend;
      const halfSpan = Math.ceil(width * 2.3);
      for (
        let x = Math.floor(xCenter) - halfSpan;
        x <= Math.ceil(xCenter) + halfSpan;
        x++
      ) {
        const crossSection = Math.exp(-(((x - xCenter) / width) ** 2));
        const index = wrap(y) * size + wrap(x);
        height[index] += strength * envelope * crossSection;
      }
    }
  }

  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = height[y * size + ((x + size - 1) % size)];
      const right = height[y * size + ((x + 1) % size)];
      const above = height[((y + size - 1) % size) * size + x];
      const below = height[((y + 1) % size) * size + x];
      // The neutral blue component dominates. Hair varies across its width,
      // while the much smaller V derivative only adds a gentle natural bend.
      // Clamp rare fibre overlaps to prevent isolated pinprick glints. Keep the
      // lengthwise derivative softer: it should suggest the taper, not bumps.
      const nx = THREE.MathUtils.clamp((left - right) * 0.32, -0.15, 0.15);
      const ny = THREE.MathUtils.clamp((above - below) * 0.22, -0.08, 0.08);
      const inverseLength = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const offset = (y * size + x) * 4;
      image.data[offset] = Math.round((nx * inverseLength * 0.5 + 0.5) * 255);
      image.data[offset + 1] = Math.round(
        (ny * inverseLength * 0.5 + 0.5) * 255,
      );
      image.data[offset + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  sharedNormal = new THREE.CanvasTexture(canvas);
  sharedNormal.name = "MiaoxingFineCoatNormalV2";
  sharedNormal.colorSpace = THREE.NoColorSpace;
  sharedNormal.wrapS = THREE.RepeatWrapping;
  sharedNormal.wrapT = THREE.RepeatWrapping;
  sharedNormal.repeat.set(12, 8);
  sharedNormal.magFilter = THREE.LinearFilter;
  sharedNormal.minFilter = THREE.LinearMipmapLinearFilter;
  sharedNormal.anisotropy = 4;
  sharedNormal.needsUpdate = true;
  return sharedNormal;
}
