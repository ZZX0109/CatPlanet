import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

type V3 = readonly [number, number, number] | Float32Array | Float64Array;
export type CatFurBakeMesh = {
  /** V(beta,h) = sum beta_i * (P_i + R_i*h + T_i*h*h). */
  positions: Float32Array;
  radial: Float32Array;
  sweep: Float32Array;
  uv: Float32Array;
  index: Uint32Array | Uint16Array;
  mask?: Float32Array;
  sourceVertexIds?: Uint32Array;
};
export type CatFurBakeStrands = {
  points: Float32Array;
  count: number;
  pointsPerStrand: number;
  /** Either one radius per strand or one per polyline point, in scene units. */
  radii: Float32Array;
  /** Unpremultiplied linear RGB per strand, never converted from sRGB here. */
  colors: Float32Array;
  /** Bulk representation weight only. Region/user density is applied by the shader. */
  weights?: Float32Array;
  representedChildren?: number | Float32Array;
  seedFaces?: Int32Array;
};
export type CatFurVolumeLocation = {
  face: number;
  bary: [number, number, number];
  h: number;
  uv: [number, number];
  residual: number;
  iterations: number;
  crossings: number;
  seamCrossings: number;
  jacobian: number;
  uvJacobian: number;
  voxelScale: number;
};
export type CatFurVolumeMapResult =
  | { ok: true; location: CatFurVolumeLocation }
  | {
      ok: false;
      reason:
        | "no-seed"
        | "singular"
        | "fold"
        | "boundary"
        | "outside-height"
        | "nonconvergent";
      residual: number;
      face: number;
      h: number;
    };
export type CatFurVolumeMapperOptions = {
  tolerance?: number;
  seamTolerance?: number;
  maxIterations?: number;
  maxCrossings?: number;
  connectSeams?: boolean;
};

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: ArrayLike<number>) => Math.hypot(a[0], a[1], a[2]);
const cross = (
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  out = new Float64Array(3),
) => {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
  return out;
};
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** CPU-only mapper. MeshBVH indirect mode preserves original face numbering. */
export function createCatFurVolumeMapper(
  mesh: CatFurBakeMesh,
  options: CatFurVolumeMapperOptions = {},
) {
  const vertices = mesh.positions.length / 3,
    faces = mesh.index.length / 3;
  if (
    !Number.isInteger(vertices) ||
    !Number.isInteger(faces) ||
    mesh.radial.length !== mesh.positions.length ||
    mesh.sweep.length !== mesh.positions.length ||
    mesh.uv.length !== vertices * 2
  )
    throw new Error("Invalid polynomial volume mesh dimensions.");
  for (const array of [mesh.positions, mesh.radial, mesh.sweep, mesh.uv])
    if (!array.every(Number.isFinite))
      throw new Error("Nonfinite polynomial volume mesh.");
  if (!mesh.index.every((i) => i < vertices))
    throw new Error("Invalid polynomial volume index.");
  const tolerance = options.tolerance ?? 1e-6;
  const seamTolerance = options.seamTolerance ?? 1e-6;
  const maxIterations = options.maxIterations ?? 32,
    maxCrossings = options.maxCrossings ?? 24;
  if (!(tolerance > 0 && Number.isFinite(tolerance) && seamTolerance > 0 && Number.isFinite(seamTolerance)) ||
      !Number.isInteger(maxIterations) || maxIterations < 1 || !Number.isInteger(maxCrossings) || maxCrossings < 0)
    throw new Error("Invalid volume mapper options.");
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(mesh.positions.slice(), 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(mesh.index.slice(), 1));
  // Runtime 0.8.3 supports indirect, but its bundled declaration omits it.
  const bvhOptions = { indirect: true, maxLeafTris: 8 };
  const bvh = new MeshBVH(geometry, bvhOptions);
  const query = new THREE.Vector3(),
    hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const neighbours = new Int32Array(faces * 3).fill(-1);
  const seam = new Uint8Array(faces * 3);
  const charts = new Int32Array(faces).fill(-1);
  const stats = {
    faces,
    vertices,
    nativeConnections: 0,
    seamConnections: 0,
    nonManifoldEdges: 0,
    incompatibleSeams: 0,
    maximumSeamOffset: 0,
  };
  type Edge = { face: number; side: number; a: number; b: number };
  const native = new Map<string, Edge[]>(),
    boundary: Edge[] = [];
  for (let face = 0; face < faces; face++)
    for (let side = 0; side < 3; side++) {
      const a = mesh.index[face * 3 + ((side + 1) % 3)],
        b = mesh.index[face * 3 + ((side + 2) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!native.has(key)) native.set(key, []);
      native.get(key)!.push({ face, side, a, b });
    }
  const connect = (a: Edge, b: Edge, isSeam: boolean) => {
    neighbours[a.face * 3 + a.side] = b.face;
    neighbours[b.face * 3 + b.side] = a.face;
    if (isSeam) {
      seam[a.face * 3 + a.side] = seam[b.face * 3 + b.side] = 1;
      stats.seamConnections++;
    } else stats.nativeConnections++;
  };
  for (const list of native.values()) {
    if (list.length === 2) connect(list[0], list[1], false);
    else if (list.length === 1) boundary.push(list[0]);
    else stats.nonManifoldEdges++;
  }
  let chartCount = 0;
  for (let f = 0; f < faces; f++)
    if (charts[f] < 0) {
      const queue = [f];
      charts[f] = chartCount;
      for (let i = 0; i < queue.length; i++)
        for (let s = 0; s < 3; s++) {
          const n = neighbours[queue[i] * 3 + s];
          if (n >= 0 && charts[n] < 0) {
            charts[n] = chartCount;
            queue.push(n);
          }
        }
      chartCount++;
    }
  if (options.connectSeams !== false) {
    const positionKey = (v: number) =>
      [0, 1, 2]
        .map((a) => Math.round(mesh.positions[v * 3 + a] / seamTolerance))
        .join(",");
    const groups = new Map<string, Edge[]>();
    for (const edge of boundary) {
      const a = positionKey(edge.a),
        b = positionKey(edge.b),
        key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(edge);
    }
    for (const list of groups.values())
      if (list.length === 2) {
        const [a, b] = list;
        const da = [0, 1, 2].map(
          (axis) => mesh.radial[a.a * 3 + axis] + mesh.radial[a.b * 3 + axis],
        );
        const db = [0, 1, 2].map(
          (axis) => mesh.radial[b.a * 3 + axis] + mesh.radial[b.b * 3 + axis],
        );
        if (dot(da, db) / Math.max(1e-30, norm(da) * norm(db)) < 0.25) {
          stats.incompatibleSeams++;
          continue;
        }
        const offset = Math.min(
          norm(
            [0, 1, 2].map(
              (k) => mesh.positions[a.a * 3 + k] - mesh.positions[b.a * 3 + k],
            ),
          ),
          norm(
            [0, 1, 2].map(
              (k) => mesh.positions[a.a * 3 + k] - mesh.positions[b.b * 3 + k],
            ),
          ),
        );
        stats.maximumSeamOffset = Math.max(stats.maximumSeamOffset, offset);
        if (offset <= seamTolerance * 2) connect(a, b, true);
      }
  }

  function evaluate(face: number, beta1: number, beta2: number, h: number) {
    const q = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
    const d = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
    const uv = [0, 0],
      p = new Float64Array(3),
      dh = new Float64Array(3);
    const bary = [1 - beta1 - beta2, beta1, beta2];
    for (let i = 0; i < 3; i++) {
      const v = mesh.index[face * 3 + i];
      for (let k = 0; k < 3; k++) {
        q[i][k] =
          mesh.positions[v * 3 + k] +
          mesh.radial[v * 3 + k] * h +
          mesh.sweep[v * 3 + k] * h * h;
        d[i][k] = mesh.radial[v * 3 + k] + 2 * mesh.sweep[v * 3 + k] * h;
        p[k] += bary[i] * q[i][k];
        dh[k] += bary[i] * d[i][k];
      }
      uv[0] += bary[i] * mesh.uv[v * 2];
      uv[1] += bary[i] * mesh.uv[v * 2 + 1];
    }
    const u = q[1].map((v, k) => v - q[0][k]),
      v = q[2].map((v, k) => v - q[0][k]);
    const a = mesh.index[face * 3],
      b = mesh.index[face * 3 + 1],
      c = mesh.index[face * 3 + 2];
    const du1 = mesh.uv[b * 2] - mesh.uv[a * 2],
      dv1 = mesh.uv[b * 2 + 1] - mesh.uv[a * 2 + 1];
    const du2 = mesh.uv[c * 2] - mesh.uv[a * 2],
      dv2 = mesh.uv[c * 2 + 1] - mesh.uv[a * 2 + 1];
    const uvDet = du1 * dv2 - dv1 * du2,
      determinant = dot(u, cross(v, dh));
    return {
      p,
      u,
      v,
      dh,
      uv: uv as [number, number],
      determinant,
      uvDet,
      du1,
      dv1,
      du2,
      dv2,
    };
  }
  const orientation = new Float64Array(faces);
  for (let f = 0; f < faces; f++)
    orientation[f] = Math.sign(evaluate(f, 1 / 3, 1 / 3, 0).determinant);
  const baryAt = (face: number, point: ArrayLike<number>, h: number) => {
    const base = evaluate(face, 0, 0, h),
      delta = base.p.map((v, k) => point[k] - v);
    const uu = dot(base.u, base.u),
      uv = dot(base.u, base.v),
      vv = dot(base.v, base.v),
      denominator = uu * vv - uv * uv;
    if (Math.abs(denominator) < 1e-30) return [0.333333333, 0.333333333];
    return [
      (dot(delta, base.u) * vv - dot(delta, base.v) * uv) / denominator,
      (dot(delta, base.v) * uu - dot(delta, base.u) * uv) / denominator,
    ];
  };
  function mapPoint(
    point: V3,
    seed?: { face: number; h?: number; bary?: readonly number[] },
    resolution: readonly [number, number, number] = [256, 256, 16],
  ): CatFurVolumeMapResult {
    let face = seed?.face ?? -1,
      h = seed?.h ?? 0,
      beta1 = seed?.bary?.[1] ?? 1 / 3,
      beta2 = seed?.bary?.[2] ?? 1 / 3;
    if (face < 0 || face >= faces) {
      const result = bvh.closestPointToPoint(
        query.set(point[0], point[1], point[2]),
        hit,
      );
      if (!result)
        return {
          ok: false,
          reason: "no-seed",
          residual: Infinity,
          face: -1,
          h: 0,
        };
      face = result.faceIndex;
      [beta1, beta2] = baryAt(face, point, 0);
      const e = evaluate(face, beta1, beta2, 0),
        delta = e.p.map((v, k) => point[k] - v);
      h = clamp(
        dot(delta, e.dh) / Math.max(1e-30, dot(e.dh, e.dh)),
        -0.25,
        1.25,
      );
    }
    let crossings = 0,
      seamCrossings = 0,
      residual = Infinity;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const e = evaluate(face, beta1, beta2, h);
      const error = e.p.map((v, k) => v - point[k]);
      residual = norm(error);
      const scale = norm(e.u) * norm(e.v) * norm(e.dh);
      if (
        Math.abs(e.determinant) < Math.max(1e-30, scale * 1e-9) ||
        Math.abs(e.uvDet) < 1e-14
      )
        return { ok: false, reason: "singular", residual, face, h };
      if (!orientation[face] || e.determinant * orientation[face] <= 0)
        return { ok: false, reason: "fold", residual, face, h };
      const bary = [1 - beta1 - beta2, beta1, beta2] as [
        number,
        number,
        number,
      ];
      const minimum = Math.min(...bary);
      if (minimum < -1e-7) {
        const side = bary.indexOf(minimum),
          neighbour = neighbours[face * 3 + side];
        if (neighbour < 0 || crossings++ >= maxCrossings)
          return { ok: false, reason: "boundary", residual, face, h };
        seamCrossings += seam[face * 3 + side];
        face = neighbour;
        [beta1, beta2] = baryAt(face, point, h);
        continue;
      }
      if (residual <= tolerance) {
        if (h < -1e-6 || h > 1 + 1e-6)
          return { ok: false, reason: "outside-height", residual, face, h };
        const du = e.u.map((x, k) => (x * e.dv2 - e.v[k] * e.dv1) / e.uvDet);
        const dv = e.u.map((x, k) => (-x * e.du2 + e.v[k] * e.du1) / e.uvDet);
        return {
          ok: true,
          location: {
            face,
            bary,
            h: clamp(h, 0, 1),
            uv: e.uv,
            residual,
            iterations: iteration + 1,
            crossings,
            seamCrossings,
            jacobian: e.determinant,
            uvJacobian: e.determinant / e.uvDet,
            voxelScale: Math.min(
              norm(du) / resolution[0],
              norm(dv) / resolution[1],
              norm(e.dh) / resolution[2],
            ),
          },
        };
      }
      const db1 = dot(error, cross(e.v, e.dh)) / e.determinant;
      const db2 = dot(e.u, cross(error, e.dh)) / e.determinant;
      const dHeight = dot(e.u, cross(e.v, error)) / e.determinant;
      const damping = Math.min(1, 0.5 / Math.max(0.5, Math.abs(dHeight)));
      beta1 -= db1 * damping;
      beta2 -= db2 * damping;
      h -= dHeight * damping;
      if (![beta1, beta2, h].every(Number.isFinite)) break;
    }
    return { ok: false, reason: "nonconvergent", residual, face, h };
  }
  return {
    mapPoint,
    evaluate,
    charts,
    chartCount,
    stats,
    dispose: () => geometry.dispose(),
  };
}

/** Clip a UV triangle to one texel, retaining its exact covered area/centroid. */
function clippedCell(
  triangle: number[][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  let polygon = triangle;
  for (let edge = 0; edge < 4; edge++) {
    const distance = (p: number[]) =>
      edge === 0
        ? p[0] - x0
        : edge === 1
          ? x1 - p[0]
          : edge === 2
            ? p[1] - y0
            : y1 - p[1];
    const next: number[][] = [];
    if (!polygon.length) return null;
    let previous = polygon[polygon.length - 1],
      pd = distance(previous);
    for (const current of polygon) {
      const cd = distance(current);
      if (pd >= 0 !== cd >= 0) {
        const t = pd / (pd - cd);
        next.push([
          previous[0] + t * (current[0] - previous[0]),
          previous[1] + t * (current[1] - previous[1]),
        ]);
      }
      if (cd >= 0) next.push(current);
      previous = current;
      pd = cd;
    }
    polygon = next;
  }
  let area2 = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      c = a[0] * b[1] - b[0] * a[1];
    area2 += c;
    cx += (a[0] + b[0]) * c;
    cy += (a[1] + b[1]) * c;
  }
  return Math.abs(area2) > 1e-20
    ? { area: Math.abs(area2) * 0.5, uv: [cx / (3 * area2), cy / (3 * area2)] }
    : null;
}

export function bakeCatFurVolume(input: {
  mesh: CatFurBakeMesh;
  strands: CatFurBakeStrands;
  resolution: readonly [number, number, number];
  mapperOptions?: CatFurVolumeMapperOptions;
  /** Maximum physical sample interval; local voxel scale can reduce it. */
  maxSampleStep?: number;
  samplesPerVoxel?: number;
}) {
  const { mesh, strands, resolution } = input,
    [width, height, depth] = resolution;
  if (!resolution.every((n) => Number.isInteger(n) && n > 0))
    throw new Error("Invalid volume resolution.");
  if (
    !Number.isInteger(strands.count) || strands.count < 0 ||
    !Number.isInteger(strands.pointsPerStrand) || strands.pointsPerStrand < 2 ||
    strands.points.length !== strands.count * strands.pointsPerStrand * 3 ||
    strands.colors.length !== strands.count * 3 ||
    (strands.radii.length !== strands.count &&
      strands.radii.length !== strands.count * strands.pointsPerStrand)
  )
    throw new Error("Invalid strand dimensions.");
  for (const array of [strands.points, strands.colors, strands.radii])
    if (!array.every(Number.isFinite)) throw new Error("Nonfinite strand data.");
  for (const array of [strands.weights, typeof strands.representedChildren === "number" ? undefined : strands.representedChildren])
    if (array && (array.length !== strands.count || !array.every((value) => Number.isFinite(value) && value >= 0)))
      throw new Error("Invalid strand representation weights.");
  if (typeof strands.representedChildren === "number" && !(Number.isFinite(strands.representedChildren) && strands.representedChildren >= 0))
    throw new Error("Invalid represented child count.");
  if (strands.seedFaces && strands.seedFaces.length !== strands.count) throw new Error("Invalid strand seed count.");
  if (input.samplesPerVoxel !== undefined && !(Number.isFinite(input.samplesPerVoxel) && input.samplesPerVoxel > 0))
    throw new Error("Invalid voxel sampling rate.");
  const mapper = createCatFurVolumeMapper(mesh, input.mapperOptions);
  const voxels = width * height * depth,
    volume = new Float64Array(voxels),
    mass = new Float64Array(voxels),
    color = new Float64Array(voxels * 3);
  const chart = new Int32Array(voxels).fill(-1),
    coverage = new Float64Array(width * height);
  const stats = {
    inputMass: 0,
    mappedMass: 0,
    storedMass: 0,
    uncoveredMass: 0,
    boundaryDiscardedMass: 0,
    invalidVoxelMass: 0,
    samples: 0,
    mappedSamples: 0,
    crossings: 0,
    seamCrossings: 0,
    maximumResidual: 0,
    foldCells: 0,
    singularCells: 0,
    multiChartVoxels: 0,
    coveredVoxels: 0,
    occupiedVoxels: 0,
    failureReasons: {} as Record<string, number>,
    mapper: mapper.stats,
  };
  try {
    // Conservative physical cell volume. UV-edge texels use clipped area, not
    // the whole texel; quadrature is polygon-centroid times h-slab midpoint.
    for (let face = 0; face < mesh.index.length / 3; face++) {
      const ids = [0, 1, 2].map((i) => mesh.index[face * 3 + i]);
      if (mesh.mask && ids.every((v) => mesh.mask![v] <= 0)) continue;
      const triangle = ids.map((v) => [mesh.uv[v * 2], mesh.uv[v * 2 + 1]]);
      const du1 = triangle[1][0] - triangle[0][0],
        dv1 = triangle[1][1] - triangle[0][1],
        du2 = triangle[2][0] - triangle[0][0],
        dv2 = triangle[2][1] - triangle[0][1],
        det = du1 * dv2 - dv1 * du2;
      if (Math.abs(det) < 1e-14) {
        stats.singularCells++;
        continue;
      }
      const minX = clamp(
          Math.floor(Math.min(...triangle.map((p) => p[0])) * width),
          0,
          width - 1,
        ),
        maxX = clamp(
          Math.floor(Math.max(...triangle.map((p) => p[0])) * width),
          0,
          width - 1,
        );
      const minY = clamp(
          Math.floor(Math.min(...triangle.map((p) => p[1])) * height),
          0,
          height - 1,
        ),
        maxY = clamp(
          Math.floor(Math.max(...triangle.map((p) => p[1])) * height),
          0,
          height - 1,
        );
      const sign = Math.sign(
        mapper.evaluate(face, 1 / 3, 1 / 3, 0).determinant,
      );
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const cell = clippedCell(
            triangle,
            x / width,
            y / height,
            (x + 1) / width,
            (y + 1) / height,
          );
          if (!cell) continue;
          coverage[y * width + x] += cell.area * width * height;
          const u = cell.uv[0] - triangle[0][0],
            v = cell.uv[1] - triangle[0][1];
          const b1 = (u * dv2 - v * du2) / det,
            b2 = (v * du1 - u * dv1) / det;
          for (let z = 0; z < depth; z++) {
            const e = mapper.evaluate(face, b1, b2, (z + 0.5) / depth),
              index = (z * height + y) * width + x;
            if (
              !Number.isFinite(e.determinant) ||
              Math.abs(e.determinant) < 1e-20
            ) {
              stats.singularCells++;
              continue;
            }
            if (!sign || e.determinant * sign <= 0) {
              stats.foldCells++;
              continue;
            }
            volume[index] +=
              (Math.abs(e.determinant / det) * cell.area) / depth;
            if (chart[index] === -1) chart[index] = mapper.charts[face];
            else if (
              chart[index] !== mapper.charts[face] &&
              chart[index] !== -2
            ) {
              chart[index] = -2;
              stats.multiChartVoxels++;
            }
          }
        }
    }
    const validVolumes = Array.from(volume)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const fallbackStep =
      input.maxSampleStep ??
      (validVolumes.length
        ? Math.cbrt(validVolumes[validVolumes.length >> 1]) /
          (input.samplesPerVoxel ?? 2)
        : 0.001);
    if (!(fallbackStep > 0)) throw new Error("Invalid physical sampling step.");
    const point = new Float64Array(3);
    for (let strand = 0; strand < strands.count; strand++) {
      const weight = strands.weights?.[strand] ?? 1;
      const children =
        typeof strands.representedChildren === "number"
          ? strands.representedChildren
          : (strands.representedChildren?.[strand] ?? 1);
      if (!(weight > 0 && children > 0)) continue;
      let seed:
        { face: number; h?: number; bary?: readonly number[] } | undefined =
        strands.seedFaces && strands.seedFaces[strand] >= 0
          ? { face: strands.seedFaces[strand] }
          : undefined;
      for (let segment = 0; segment < strands.pointsPerStrand - 1; segment++) {
        const node = strand * strands.pointsPerStrand + segment,
          a = node * 3,
          b = a + 3;
        const length = Math.hypot(
          strands.points[b] - strands.points[a],
          strands.points[b + 1] - strands.points[a + 1],
          strands.points[b + 2] - strands.points[a + 2],
        );
        if (!(length > 0)) continue;
        let t = 0,
          localStep = fallbackStep;
        while (t < 1 - 1e-12) {
          const dt = Math.min(
              1 - t,
              Math.max(1e-9, Math.min(fallbackStep, localStep) / length),
            ),
            middle = t + dt * 0.5;
          for (let k = 0; k < 3; k++)
            point[k] =
              strands.points[a + k] +
              (strands.points[b + k] - strands.points[a + k]) * middle;
          const radius =
            strands.radii.length === strands.count
              ? strands.radii[strand]
              : strands.radii[node] * (1 - middle) +
                strands.radii[node + 1] * middle;
          const contribution = Math.max(
            0,
            2 * radius * length * dt * children * weight,
          );
          stats.inputMass += contribution;
          stats.samples++;
          const mapped = mapper.mapPoint(point, seed, resolution);
          if (!mapped.ok) {
            stats.uncoveredMass += contribution;
            stats.failureReasons[mapped.reason] =
              (stats.failureReasons[mapped.reason] ?? 0) + 1;
            seed = undefined;
            t += dt;
            continue;
          }
          const p = mapped.location;
          seed = { face: p.face, h: p.h, bary: p.bary };
          localStep = Math.max(
            1e-9,
            p.voxelScale / (input.samplesPerVoxel ?? 2),
          );
          stats.mappedMass += contribution;
          stats.mappedSamples++;
          stats.crossings += p.crossings;
          stats.seamCrossings += p.seamCrossings;
          stats.maximumResidual = Math.max(stats.maximumResidual, p.residual);
          const coordinates = [
            p.uv[0] * width - 0.5,
            p.uv[1] * height - 0.5,
            p.h * depth - 0.5,
          ];
          const lower = coordinates.map(Math.floor),
            fraction = coordinates.map((v, k) => v - lower[k]);
          const targets: [number, number][] = [];
          let totalWeight = 0;
          for (let dz = 0; dz < 2; dz++)
            for (let dy = 0; dy < 2; dy++)
              for (let dx = 0; dx < 2; dx++) {
                const x = clamp(lower[0] + dx, 0, width - 1),
                  y = clamp(lower[1] + dy, 0, height - 1),
                  z = clamp(lower[2] + dz, 0, depth - 1),
                  index = (z * height + y) * width + x;
                const w =
                  (dx ? fraction[0] : 1 - fraction[0]) *
                  (dy ? fraction[1] : 1 - fraction[1]) *
                  (dz ? fraction[2] : 1 - fraction[2]);
                if (
                  volume[index] > 0 &&
                  chart[index] === mapper.charts[p.face]
                ) {
                  targets.push([index, w]);
                  totalWeight += w;
                }
              }
          const discarded = contribution * Math.max(0, 1 - totalWeight);
          stats.invalidVoxelMass += discarded;
          stats.boundaryDiscardedMass += discarded;
          if (!(totalWeight > 0)) { /* All of this sample is explicitly lost. */ }
          else {
            stats.storedMass += contribution * totalWeight;
            for (const [index, w] of targets) {
              const m = contribution * w;
              mass[index] += m;
              for (let k = 0; k < 3; k++)
                color[index * 3 + k] += m * strands.colors[strand * 3 + k];
            }
          }
          t += dt;
        }
      }
    }
    const rgba = new Float32Array(voxels * 4);
    let maximumKappa = 0,
      reconstructedMass = 0;
    for (let i = 0; i < voxels; i++) {
      if (volume[i] > 0) stats.coveredVoxels++;
      if (!(mass[i] > 0 && volume[i] > 0)) continue;
      stats.occupiedVoxels++;
      for (let k = 0; k < 3; k++) rgba[i * 4 + k] = color[i * 3 + k] / mass[i];
      rgba[i * 4 + 3] = mass[i] / volume[i];
      maximumKappa = Math.max(maximumKappa, rgba[i * 4 + 3]);
      reconstructedMass += rgba[i * 4 + 3] * volume[i];
    }
    return {
      rgba,
      resolution,
      voxelVolumes: volume,
      stats: {
        ...stats,
        maximumKappa,
        reconstructedMass,
        massReconstructionError: reconstructedMass - stats.storedMass,
        accountingError:
          stats.inputMass -
          stats.uncoveredMass -
          stats.invalidVoxelMass -
          stats.storedMass,
        maximumUVCellCoverage: coverage.reduce((maximum, value) => Math.max(maximum, value), 0),
        volumeQuadrature: "clipped-UV-cell centroid times slab midpoint",
        rgbaOrder: "linearRGB,kappa",
        boundaryPolicy:
          "clamp outer texture-boundary indices; discard/report mass in zero-volume or different-chart voxels without renormalization",
      },
    };
  } finally {
    mapper.dispose();
  }
}
