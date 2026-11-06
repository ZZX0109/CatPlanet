import * as THREE from "three";

// Keep one seed for every design: moving a slider deforms the same coat rather
// than randomly replacing the hairs, which would make the surface flicker.
function randomGenerator(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(value: number, low: number, high: number) {
  const t = THREE.MathUtils.clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Short, surface-following coat ribbons. The result has indexed triangles so
 * skinning and the seven shape targets only need five vertices per strand.
 * Normals deliberately follow the underlying skin, rather than each tiny flat
 * triangle: that gives the coat one soft light response instead of shiny spikes.
 * All positions remain in the neutral mesh space for the caller's skin/morphs.
 */
export function buildCoatSurface(
  geometry: THREE.BufferGeometry,
  colorAt: (point: THREE.Vector3) => THREE.Color,
): THREE.BufferGeometry {
  const sourcePosition = geometry.getAttribute("position");
  const sourceNormal = geometry.getAttribute("normal");
  if (!sourcePosition || !sourceNormal || sourcePosition.count < 3) {
    throw new Error("The coat requires a triangulated surface with normals.");
  }

  const sourceIndex = geometry.getIndex();
  const triangleCount = Math.floor(
    (sourceIndex ? sourceIndex.count : sourcePosition.count) / 3,
  );
  const cumulativeAreas = new Float64Array(triangleCount);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let area = 0;
  const vertexAt = (offset: number) =>
    sourceIndex ? sourceIndex.getX(offset) : offset;

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    a.fromBufferAttribute(sourcePosition, vertexAt(triangle * 3));
    b.fromBufferAttribute(sourcePosition, vertexAt(triangle * 3 + 1));
    c.fromBufferAttribute(sourcePosition, vertexAt(triangle * 3 + 2));
    area += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    cumulativeAreas[triangle] = area;
  }
  if (!Number.isFinite(area) || area <= 0) {
    throw new Error("The coat requires a surface with nonzero area.");
  }

  const strandCount = 32_000;
  const verticesPerStrand = 5;
  const vertexCount = strandCount * verticesPerStrand;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(strandCount * 9);
  const random = randomGenerator(0xc47c04);
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const na = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const nc = new THREE.Vector3();
  const groom = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const ribbonAcross = new THREE.Vector3();
  const vertex = new THREE.Vector3();

  function writeVertex(
    offset: number,
    distance: number,
    halfWidth: number,
    lift: number,
    color: THREE.Color,
    brightness: number,
  ) {
    vertex
      .copy(point)
      .addScaledVector(groom, distance)
      .addScaledVector(normal, lift)
      .addScaledVector(ribbonAcross, halfWidth);
    vertex.toArray(positions, offset * 3);
    normal.toArray(normals, offset * 3);
    colors[offset * 3] = color.r * brightness;
    colors[offset * 3 + 1] = color.g * brightness;
    colors[offset * 3 + 2] = color.b * brightness;
  }

  for (let strand = 0; strand < strandCount; strand++) {
    const sample = random() * area;
    let lo = 0;
    let hi = triangleCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cumulativeAreas[mid] < sample) lo = mid + 1;
      else hi = mid;
    }
    const ia = vertexAt(lo * 3);
    const ib = vertexAt(lo * 3 + 1);
    const ic = vertexAt(lo * 3 + 2);
    a.fromBufferAttribute(sourcePosition, ia);
    b.fromBufferAttribute(sourcePosition, ib);
    c.fromBufferAttribute(sourcePosition, ic);
    na.fromBufferAttribute(sourceNormal, ia);
    nb.fromBufferAttribute(sourceNormal, ib);
    nc.fromBufferAttribute(sourceNormal, ic);

    // Uniform triangle-area sampling, including the face interiors, avoids the
    // grid-aligned clumps made by picking marching-cubes vertices directly.
    const root = Math.sqrt(random());
    const wa = 1 - root;
    const wb = root * (1 - random());
    const wc = 1 - wa - wb;
    point
      .copy(a)
      .multiplyScalar(wa)
      .addScaledVector(b, wb)
      .addScaledVector(c, wc);
    normal
      .copy(na)
      .multiplyScalar(wa)
      .addScaledVector(nb, wb)
      .addScaledVector(nc, wc)
      .normalize();

    const face =
      smoothstep(point.y, 1.17, 1.36) * smoothstep(point.z, 0.66, 0.82);
    const limb = 1 - smoothstep(point.y, 0.48, 0.88);
    const tail = smoothstep(-point.z, 0.94, 1.16);
    const forehead = smoothstep(point.y, 1.43, 1.62);
    const side = point.x < 0 ? -1 : 1;

    // Torso hair follows the spine towards the rump, draping down the sides.
    groom.set(point.x * 0.1, -0.23, -1);
    if (face > 0) {
      tangent.set(
        side * 0.65,
        THREE.MathUtils.lerp(-0.5, 0.25, forehead),
        -0.7,
      );
      groom.lerp(tangent, face);
    }
    if (limb > 0) {
      tangent.set(0.04 * side, -1, point.y < 0.18 ? 0.65 : 0.08);
      groom.lerp(tangent, limb);
    }
    if (tail > 0) {
      const t = THREE.MathUtils.clamp((-point.z - 0.92) / 0.73, 0, 1);
      tangent.set(0.32 * Math.cos(t * 3.2), 0.67, -0.85 + 0.24 * t);
      groom.lerp(tangent, tail);
    }
    groom.addScaledVector(normal, -groom.dot(normal));
    if (groom.lengthSq() < 0.0001) {
      groom.set(1, 0, 0).addScaledVector(normal, -normal.x);
    }
    groom.normalize();
    ribbonAcross.crossVectors(normal, groom).normalize();
    groom.addScaledVector(ribbonAcross, (random() - 0.5) * 0.24).normalize();
    ribbonAcross.crossVectors(normal, groom).normalize();

    const bodyLength = 0.018 + random() * 0.012;
    const faceLength = 0.004 + forehead * 0.004 + random() * 0.004;
    const length = THREE.MathUtils.lerp(
      bodyLength,
      faceLength,
      Math.max(face, limb * 0.85),
    );
    const halfWidth = (0.0008 + random() * 0.0004) * 0.5;
    const lift = THREE.MathUtils.lerp(
      0.003 + random() * 0.003,
      0.0015 + random() * 0.001,
      face,
    );
    const color = colorAt(point);
    const brightness = 0.88 + random() * 0.19;
    const base = strand * verticesPerStrand;

    writeVertex(base, 0, -halfWidth, 0.0006, color, brightness * 0.94);
    writeVertex(base + 1, 0, halfWidth, 0.0006, color, brightness * 0.94);
    writeVertex(
      base + 2,
      length * 0.52,
      -halfWidth * 0.58,
      lift * 0.75,
      color,
      brightness,
    );
    writeVertex(
      base + 3,
      length * 0.52,
      halfWidth * 0.58,
      lift * 0.75,
      color,
      brightness,
    );
    writeVertex(base + 4, length, 0, lift, color, brightness * 1.02);
    const index = strand * 9;
    indices.set(
      [
        base,
        base + 2,
        base + 1,
        base + 1,
        base + 2,
        base + 3,
        base + 2,
        base + 4,
        base + 3,
      ],
      index,
    );
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  result.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  result.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  result.setIndex(new THREE.BufferAttribute(indices, 1));
  result.userData = {
    strands: strandCount,
    groom: "short-coat-v2",
  };
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}
