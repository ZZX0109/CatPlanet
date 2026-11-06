/**
 * Reference-space grooming, not a simulation or a reconstruction network.
 * Smooth anatomical guides and continuous multiscale styling are sampled once.
 * The resulting curve vectors are transported by the bound skin triangle.
 */
export type FurVec3 = [number, number, number];
export type FurSurfaceBinding = { u: number; v: number; length: number };
export type FurFlowAnatomy = {
  head?: number;
  limb?: number;
  tail?: number;
  /** Reference direction from the proximal bone towards the paw/tail tip. */
  axis?: FurVec3;
};
export type FurFlowSample = {
  tangent: FurVec3;
  guideTangent: FurVec3;
  gather: FurVec3;
  wave: number;
  phase: number;
  lengthScale: number;
  guardLengthScale: number;
  bodyStyling: number;
};
type Bounds = { min: FurVec3; max: FurVec3 };
type FlowLandmarks = {
  eyeCenters: FurVec3[];
  earBases: FurVec3[];
  muzzleCenter: FurVec3;
  headBounds: Bounds;
  bodyBounds: Bounds;
};
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const unit = (v: FurVec3): FurVec3 => {
  const d = Math.hypot(...v) || 1;
  return [v[0] / d, v[1] / d, v[2] / d];
};
function project(v: FurVec3, normal: FurVec3): FurVec3 {
  const d = v[0] * normal[0] + v[1] * normal[1] + v[2] * normal[2];
  return [v[0] - d * normal[0], v[1] - d * normal[1], v[2] - d * normal[2]];
}
function hash(x: number, y: number, z: number, seed: number) {
  let h =
    Math.imul(x, 73856093) ^
    Math.imul(y, 19349663) ^
    Math.imul(z, 83492791) ^
    seed;
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A compact, smooth partition of unity around jittered guide seeds. Unlike
 * assigning a root to a grid cell, crossing a cell boundary changes no guide
 * membership abruptly: support and its first two derivatives vanish together.
 * The lattice is only an acceleration structure, never a visible part line.
 */
function guides(p: FurVec3, scale: number, seed: number) {
  const q = [p[0] / scale, p[1] / scale, p[2] / scale];
  const cell = q.map(Math.floor);
  let total = 0,
    dx = 0,
    dy = 0,
    dz = 0,
    phase = 0,
    length = 0;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (let c = -1; c <= 1; c++) {
        const i = cell[0] + a,
          j = cell[1] + b,
          k = cell[2] + c;
        const x = i + 0.5 + (hash(i, j, k, seed) - 0.5) * 0.66 - q[0];
        const y = j + 0.5 + (hash(i, j, k, seed + 19) - 0.5) * 0.66 - q[1];
        const z = k + 0.5 + (hash(i, j, k, seed + 41) - 0.5) * 0.66 - q[2];
        const support = Math.max(0, 1 - (x * x + y * y + z * z) / 1.21);
        const w = support ** 4;
        total += w;
        dx += x * w;
        dy += y * w;
        dz += z * w;
        phase += (hash(i, j, k, seed + 73) * 2 - 1) * w;
        length += (hash(i, j, k, seed + 113) * 2 - 1) * w;
      }
  const inv = 1 / Math.max(total, 1e-12);
  return {
    offset: [dx * inv * scale, dy * inv * scale, dz * inv * scale] as FurVec3,
    phase: phase * inv,
    length: length * inv,
  };
}

export function createCatFurFlow(landmarks: FlowLandmarks) {
  const ex = (landmarks.eyeCenters[0][0] + landmarks.eyeCenters[1][0]) * 0.5;
  const ey = (landmarks.eyeCenters[0][1] + landmarks.eyeCenters[1][1]) * 0.5;
  const ez = (landmarks.eyeCenters[0][2] + landmarks.eyeCenters[1][2]) * 0.5;
  const eyeSpan = Math.abs(
    landmarks.eyeCenters[0][0] - landmarks.eyeCenters[1][0],
  );
  const muzzleY = landmarks.muzzleCenter[1];
  const headBottom = landmarks.headBounds.min[1];
  const height = landmarks.bodyBounds.max[1] - landmarks.bodyBounds.min[1];
  function anatomical(
    point: FurVec3,
    normal: FurVec3,
    weights: FurFlowAnatomy,
  ): FurVec3 {
    const [x, y, z] = point;
    const side = Math.tanh((x - ex) / 0.16);
    const geometricHead =
      smooth(headBottom - 0.18, headBottom + 0.22, y) *
      smooth(ez - 0.86, ez - 0.5, z);
    const head = clamp(
      weights.head === undefined
        ? geometricHead
        : weights.head * 0.88 + geometricHead * 0.12,
    );
    // Broad guides overlap across the forehead, cheek, neck and shoulder. The
    // midline fans continuously instead of flipping at sign(x) or a Y cutoff.
    const forehead = smooth(ey - 0.015, ey + 0.18, y);
    const front = smooth(ez - 0.2, ez + 0.12, z);
    let face: FurVec3 = [
      side * (0.9 - 0.61 * forehead),
      (forehead * 1.36 - 0.47) * front - 0.44 * (1 - front),
      -0.7 - 0.26 * (1 - front),
    ];
    // The broad comb is insufficient on the face. Keep the same planted roots
    // and smoothly redirect their surface tangents through the nose bridge,
    // inner eye corners and whisker pads. These are authored reference-space
    // zones, not a flow map recovered from the linked photographs.
    const facing = head * smooth(ez - 0.24, ez - 0.02, z);
    if (facing > 1e-6) {
      const lateral = Math.abs(x - ex) / Math.max(eyeSpan, 1e-6);
      const mixFace = (target: FurVec3, weight: number) => {
        const w = clamp(weight);
        face = face.map((v, i) => v * (1 - w) + target[i] * w) as FurVec3;
      };
      const bridgeHeight = (y - muzzleY) / Math.max(ey - muzzleY, 0.08);
      const split = smooth(0.43, 0.68, bridgeHeight);
      const bridge =
        facing *
        (1 - smooth(0.11, 0.43, lateral)) *
        smooth(muzzleY - 0.055, muzzleY + 0.035, y) *
        (1 - smooth(ey + 0.015, ey + 0.11, y));
      mixFace([side * 0.22, -0.83 + 1.91 * split, -0.48], bridge * 0.84);
      // On either side of the ridge, hairs rise from above the nose and fan out.
      const bridgeWing =
        facing *
        smooth(0.08, 0.21, lateral) *
        (1 - smooth(0.34, 0.57, lateral)) *
        smooth(muzzleY - 0.005, muzzleY + 0.09, y) *
        (1 - smooth(ey - 0.045, ey + 0.045, y));
      mixFace([side * 0.96, 0.76, -0.44], bridgeWing * 0.88);
      // Eyelid roots are excluded by the planting mask. The surviving short
      // hairs around the rim curve laterally instead of crossing the eye.
      const eyeArc =
        facing *
        Math.exp(
          -1.65 *
            (((lateral - 0.5) / 0.43) ** 2 +
              ((y - ey) / 0.23) ** 2 +
              ((z - ez) / 0.3) ** 2),
        );
      mixFace(
        [side * 0.95, -0.25 + 0.66 * smooth(ey - 0.04, ey + 0.12, y), -0.58],
        eyeArc * 0.72,
      );
      const innerCorner =
        facing *
        smooth(0.1, 0.22, lateral) *
        Math.exp(
          -1.7 *
            (((lateral - 0.26) / 0.23) ** 2 +
              ((y - ey + 0.025) / 0.09) ** 2 +
              ((z - ez - 0.015) / 0.19) ** 2),
        );
      mixFace([side, 0.08, -0.42], innerCorner * 0.82);
      const whiskerPad =
        facing *
        smooth(0.1, 0.32, lateral) *
        (1 - smooth(0.7, 1.05, lateral)) *
        smooth(muzzleY - 0.085, muzzleY + 0.005, y) *
        (1 - smooth(muzzleY + 0.13, muzzleY + 0.24, y)) *
        smooth(ez - 0.07, ez + 0.13, z);
      mixFace([side * 0.99, -0.36, -0.45], whiskerPad * 0.67);
    }
    const chest = smooth(ez - 1.02, ez - 0.4, z) * (1 - 0.78 * head);
    const flank = 1 - smooth(0.35, 0.88, normal[1]);
    const body: FurVec3 = [
      side * 0.11,
      -(0.08 + 0.34 * flank + chest * 0.8),
      -0.98 + 0.28 * chest,
    ];
    let direction: FurVec3 = [
      body[0] * (1 - head) + face[0] * head,
      body[1] * (1 - head) + face[1] * head,
      body[2] * (1 - head) + face[2] * head,
    ];
    const appendage = clamp(Math.max(weights.limb ?? 0, weights.tail ?? 0));
    if (appendage > 0 && weights.axis) {
      const blend = smooth(0.05, 0.93, appendage);
      direction = direction.map(
        (v, i) => v * (1 - blend) + weights.axis![i] * blend,
      ) as FurVec3;
    }
    const tangent = project(direction, normal);
    if (Math.hypot(...tangent) < 0.02) {
      // Continuous preferred rearward direction; only a true tangent-field
      // singularity needs this fallback, not ordinary forehead/neck boundaries.
      const fallback = project([side * 0.13, -0.18, -1], normal);
      return unit(
        Math.hypot(...fallback) > 0.02 ? fallback : project([0, 1, 0], normal),
      );
    }
    return unit(tangent);
  }
  return {
    sample(
      point: FurVec3,
      sourceNormal: FurVec3,
      weights: FurFlowAnatomy = {},
    ): FurFlowSample {
      const normal = unit(sourceNormal);
      const tangent = anatomical(point, normal, weights);
      const head =
        smooth(headBottom - 0.1, headBottom + 0.38, point[1]) *
        smooth(ez - 0.9, ez - 0.42, point[2]);
      // Blend fixed-scale fields, never rescale a lattice as y changes. A
      // varying p/scale would compress many locks into the neck transition.
      const blendGuides = (
        bodyScale: number,
        headScale: number,
        seed: number,
      ) => {
        const body = head < 0.9999 ? guides(point, bodyScale, seed) : null;
        const face =
          head > 0.0001 ? guides(point, headScale, seed + 997) : null;
        if (!body) return face!;
        if (!face) return body;
        return {
          offset: body.offset.map(
            (v, i) => v * (1 - head) + face.offset[i] * head,
          ) as FurVec3,
          phase: body.phase * (1 - head) + face.phase * head,
          length: body.length * (1 - head) + face.length * head,
        };
      };
      const macro = blendGuides(0.14, 0.065, 0x7135a);
      const micro = blendGuides(0.052, 0.027, 0xa231c);
      const gather = project(
        macro.offset.map((v, i) => v * 0.78 + micro.offset[i] * 0.3) as FurVec3,
        normal,
      );
      const across: FurVec3 = [
        normal[1] * tangent[2] - normal[2] * tangent[1],
        normal[2] * tangent[0] - normal[0] * tangent[2],
        normal[0] * tangent[1] - normal[1] * tangent[0],
      ];
      // Neighbouring hairs share a curved guide, phase and length distribution.
      // Small high-frequency variation is added later, not used as the groom.
      const turn = macro.phase * 0.26 + micro.phase * 0.075;
      const guidePoint = point.map(
        (v, i) => v + gather[i] + tangent[i] * 0.045,
      ) as FurVec3;
      const downstream = anatomical(guidePoint, normal, weights);
      const guideTangent = unit(
        downstream.map((v, i) => v + across[i] * turn) as FurVec3,
      );
      return {
        tangent,
        guideTangent,
        gather,
        wave: macro.phase * 0.75 + micro.phase * 0.25,
        phase: macro.phase * Math.PI * 2 + micro.phase * 0.4,
        lengthScale:
          1 +
          macro.length * 0.22 +
          micro.length * 0.06 * clamp(height / 3, 0.5, 1.5),
        guardLengthScale: 1 + macro.length * 0.35 + micro.length * 0.06,
        bodyStyling: 1 - Math.max(head, clamp(weights.head ?? 0)),
      };
    },
  };
}

/** Express a tangent vector in the reference triangle's two edge derivatives. */
export function bindSurfaceVector(
  vector: FurVec3,
  ab: FurVec3,
  ac: FurVec3,
): FurSurfaceBinding {
  const aa = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const cc = ac[0] ** 2 + ac[1] ** 2 + ac[2] ** 2;
  const d = ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2];
  const va = vector[0] * ab[0] + vector[1] * ab[1] + vector[2] * ab[2];
  const vc = vector[0] * ac[0] + vector[1] * ac[1] + vector[2] * ac[2];
  const determinant = aa * cc - d * d;
  if (determinant <= aa * cc * 1e-10) return { u: 0, v: 0, length: 0 };
  return {
    u: (va * cc - vc * d) / determinant,
    v: (vc * aa - va * d) / determinant,
    length: Math.hypot(...vector),
  };
}

/** Rotate with the deformed skin; preserve groom length rather than skin strain. */
export function transportSurfaceVector(
  binding: FurSurfaceBinding,
  ab: FurVec3,
  ac: FurVec3,
  normal: FurVec3,
  out: FurVec3 = [0, 0, 0],
): FurVec3 {
  let x = ab[0] * binding.u + ac[0] * binding.v;
  let y = ab[1] * binding.u + ac[1] * binding.v;
  let z = ab[2] * binding.u + ac[2] * binding.v;
  const d = x * normal[0] + y * normal[1] + z * normal[2];
  x -= normal[0] * d;
  y -= normal[1] * d;
  z -= normal[2] * d;
  const scale = binding.length / Math.max(Math.hypot(x, y, z), 1e-12);
  out[0] = x * scale;
  out[1] = y * scale;
  out[2] = z * scale;
  return out;
}
