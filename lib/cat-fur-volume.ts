import * as THREE from "three";
import type { CatCoatType } from "./cat-coat-profiles";
import {
  createCatFurVolumeMaterial,
  configureCatFurVolumeMaterial,
} from "./cat-fur-volume-material";

type RegionName = "body" | "ruff";
type RegionFields = Record<RegionName, Float32Array>;
type RegionValues = Record<RegionName, number>;
type VolumeIndex = THREE.BufferAttribute | ArrayLike<number>;

export type CatFurVolumeInput = {
  /** Immutable reference skin in model coordinates; copied for density seeds. */
  positions: Float32Array;
  normals: Float32Array;
  uv: THREE.BufferAttribute;
  index: VolumeIndex;
  regionWeights: RegionFields;
  directions: Float32Array;
  /** Local normal extent per unit regional base length, supplied by the groom. */
  envelope: RegionFields;
  /** Optional tangent travel per unit base length. Default: .25 * envelope. */
  sweep?: RegionFields;
  baseMaterial: THREE.MeshStandardMaterial;
  layerCount?: number;
  finSegments?: number;
};

export type CatFurVolumeUpdate = {
  positions: Float32Array;
  normals: Float32Array;
  directions: Float32Array;
  lengths: RegionValues;
  densities: RegionValues;
  coatType: CatCoatType;
  /** Changes integration resolution, never the user's optical density. */
  detail?: number;
  layerCount?: number;
  finSegments?: number;
  enabledRegions?: Partial<Record<RegionName, boolean>>;
};

export type CatFurVolumeGeometryScales = {
  envelopeScale?: number;
  sweepScale?: number;
};

type FinEdge = { a: number; b: number; opposites: number[] };
type Region = {
  name: RegionName;
  vertices: Uint32Array;
  indices: Uint32Array;
  canonical: Float32Array;
  uv: Float32Array;
  weights: Float32Array;
  height: Float32Array;
  sweep: Float32Array;
  layers: number;
  edges: FinEdge[];
  finSegments: number;
  posedPositions: Float64Array;
  posedNormals: Float64Array;
  posedTangents: Float64Array;
  posedHeight: Float64Array;
  posedSweep: Float64Array;
  /** Optical fibre direction is independent of the integration container. */
  posedShadingHeight: Float64Array;
  posedShadingSweep: Float64Array;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  finMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
};

const names: RegionName[] = ["body", "ruff"];
const clamp = (value: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, value));
const finite = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;
const layersFor = (value: number) =>
  clamp(Math.round(finite(value, 16)), 1, 32);
const finSegmentsFor = (value: number) =>
  clamp(Math.round(finite(value, 6)), 1, 8);

function sourceEdges(
  indices: readonly number[],
  sourceVertices: readonly number[],
  weights: Float32Array,
  height: Float32Array,
  sweep: Float32Array,
) {
  const edges = new Map<string, FinEdge>();
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = indices.slice(i, i + 3);
    for (let side = 0; side < 3; side++) {
      let a = triangle[side],
        b = triangle[(side + 1) % 3];
      const opposite = triangle[(side + 2) % 3];
      if (sourceVertices[a] > sourceVertices[b]) [a, b] = [b, a];
      if (
        a === b ||
        Math.max(weights[a], weights[b]) <= 0.000001 ||
        height[a] + height[b] + Math.abs(sweep[a]) + Math.abs(sweep[b]) <= 0
      )
        continue;
      // Identity comes from source vertex IDs. Coincident UV seam vertices and
      // unrelated surfaces are deliberately never welded in this prototype.
      const key = `${sourceVertices[a]},${sourceVertices[b]}`;
      let edge = edges.get(key);
      if (!edge) {
        edge = { a, b, opposites: [] };
        edges.set(key, edge);
      }
      if (!edge.opposites.includes(opposite)) edge.opposites.push(opposite);
    }
  }
  return [...edges.values()];
}

function geometryBytes(geometry: THREE.BufferGeometry) {
  return (
    Object.values(geometry.attributes).reduce(
      (sum, attribute) => sum + attribute.array.byteLength,
      0,
    ) + (geometry.index?.array.byteLength ?? 0)
  );
}

/**
 * Preview-only, surface-bound translucent volume shells. This first
 * representation can borrow a caller-owned actual-curve density atlas. Without
 * one it uses coherent procedural density, which is not a swept-curve bake.
 * All buffers/materials here are owned; source geometry/textures are borrowed.
 */
export function createCatFurVolume(input: CatFurVolumeInput) {
  const vertexCount = input.positions.length / 3;
  if (
    !Number.isInteger(vertexCount) ||
    input.normals.length !== input.positions.length ||
    input.directions.length !== input.positions.length ||
    input.uv.count < vertexCount ||
    names.some(
      (name) =>
        input.regionWeights[name].length < vertexCount ||
        input.envelope[name].length < vertexCount ||
        (input.sweep && input.sweep[name].length < vertexCount),
    )
  )
    throw new Error(
      "Fur volume fields must match the reference skin vertices.",
    );

  const sourceIndex = input.index;
  const isAttribute = (value: VolumeIndex): value is THREE.BufferAttribute =>
    typeof (value as THREE.BufferAttribute).getX === "function";
  const indexCount = isAttribute(sourceIndex)
    ? sourceIndex.count
    : sourceIndex.length;
  const indexAt = (i: number) =>
    isAttribute(sourceIndex) ? sourceIndex.getX(i) : sourceIndex[i];
  if (indexCount % 3 !== 0)
    throw new Error("Fur volume requires complete source skin triangles.");
  const sourceTriangles: number[][] = [];
  for (let i = 0; i < indexCount; i += 3) {
    const triangle = [indexAt(i), indexAt(i + 1), indexAt(i + 2)];
    if (triangle.some((v) => !Number.isInteger(v) || v < 0 || v >= vertexCount))
      throw new Error("Fur volume contains an invalid source vertex index.");
    sourceTriangles.push(triangle);
  }

  const regions: Region[] = names.map((name) => {
    const lookup = new Int32Array(vertexCount).fill(-1);
    const sourceVertices: number[] = [];
    const indices: number[] = [];
    for (const triangle of sourceTriangles) {
      // Keep source topology and UV seams. Never bridge nearby but unrelated
      // surfaces such as a foreleg and the chest with a spatial triangulation.
      if (
        !triangle.some((v) => finite(input.regionWeights[name][v]) > 0.000001)
      )
        continue;
      for (const source of triangle) {
        if (lookup[source] === -1) {
          lookup[source] = sourceVertices.length;
          sourceVertices.push(source);
        }
        indices.push(lookup[source]);
      }
    }
    const count = sourceVertices.length;
    const canonical = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const weights = new Float32Array(count);
    const height = new Float32Array(count);
    const sweep = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const source = sourceVertices[i];
      canonical.set(
        input.positions.subarray(source * 3, source * 3 + 3),
        i * 3,
      );
      uv[i * 2] = input.uv.getX(source);
      uv[i * 2 + 1] = input.uv.getY(source);
      weights[i] = clamp(finite(input.regionWeights[name][source]), 0, 1);
      height[i] = Math.max(0, finite(input.envelope[name][source]));
      sweep[i] = input.sweep
        ? finite(input.sweep[name][source])
        : height[i] * 0.25;
    }
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      createCatFurVolumeMaterial(input.baseMaterial),
    );
    mesh.name = `FurVolume_${name}`;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.raycast = () => {};
    mesh.userData = {
      norwegianFur: true,
      furVolumeRegion: name,
      volumePreviewOnly: true,
      densityRepresentation: "coherent-procedural-medium-not-swept-curve-atlas",
      envelopeRepresentation: "caller-supplied-reference-skin-groom-field",
      volumeGeometryScales: { envelopeScale: 1, sweepScale: 1 },
    };
    const finMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      createCatFurVolumeMaterial(input.baseMaterial, { fins: true }),
    );
    finMesh.name = `FurVolumeFin_${name}`;
    finMesh.visible = false;
    finMesh.frustumCulled = false;
    finMesh.castShadow = false;
    finMesh.receiveShadow = true;
    finMesh.raycast = () => {};
    finMesh.userData = {
      ...mesh.userData,
      volumeFins: true,
      volumeIntegration: "transverse-source-edge-cell-spacing",
    };
    return {
      name,
      vertices: new Uint32Array(sourceVertices),
      indices: new Uint32Array(indices),
      canonical,
      uv,
      weights,
      height,
      sweep,
      layers: 0,
      edges: sourceEdges(indices, sourceVertices, weights, height, sweep),
      finSegments: 0,
      posedPositions: new Float64Array(count * 3),
      posedNormals: new Float64Array(count * 3),
      posedTangents: new Float64Array(count * 3),
      posedHeight: new Float64Array(count),
      posedSweep: new Float64Array(count),
      posedShadingHeight: new Float64Array(count),
      posedShadingSweep: new Float64Array(count),
      mesh,
      finMesh,
    };
  });
  const defaultLayers = layersFor(input.layerCount ?? 16);
  const defaultFinSegments = finSegmentsFor(input.finSegments ?? 6);
  let currentLayers = defaultLayers;
  const enabled: Record<RegionName, boolean> = { body: true, ruff: false };
  let disposed = false;
  let envelopeScale = 1,
    sweepScale = 1;
  let lastUpdate: CatFurVolumeUpdate | undefined;

  function allocate(region: Region, layers: number) {
    const count = region.vertices.length;
    const total = count * layers;
    const geometry = new THREE.BufferGeometry();
    const dynamic = (name: string, size: number) => {
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(
          new Float32Array(total * size),
          size,
        ).setUsage(THREE.DynamicDrawUsage),
      );
    };
    dynamic("position", 3);
    dynamic("normal", 3);
    dynamic("furVolumeTangent", 3);
    dynamic("furVolumeStep", 3);
    dynamic("furVolumeThickness", 1);
    dynamic("furVolumeDensity", 1);
    dynamic("furVolumeEnvelope", 1);
    const uv = new Float32Array(total * 2);
    const bind = new Float32Array(total * 3);
    const depths = new Float32Array(total);
    const indices =
      total > 65535
        ? new Uint32Array(region.indices.length * layers)
        : new Uint16Array(region.indices.length * layers);
    for (let layer = 0; layer < layers; layer++) {
      uv.set(region.uv, layer * count * 2);
      bind.set(region.canonical, layer * count * 3);
      depths.fill((layer + 0.5) / layers, layer * count, (layer + 1) * count);
      for (let i = 0; i < region.indices.length; i++)
        indices[layer * region.indices.length + i] =
          region.indices[i] + layer * count;
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute(
      "furBindPosition",
      new THREE.BufferAttribute(bind, 3),
    );
    geometry.setAttribute(
      "furVolumeDepth",
      new THREE.BufferAttribute(depths, 1),
    );
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const previous = region.mesh.geometry;
    region.mesh.geometry = geometry;
    region.layers = layers;
    region.mesh.userData.volumeLayerCount = layers;
    region.mesh.userData.volumeSourceVertices = count;
    region.mesh.userData.volumeSourceTriangles = region.indices.length / 3;
    previous.dispose();
  }

  function allocateFins(region: Region, segments: number) {
    const perEdge = (segments + 1) * 2;
    const total = region.edges.length * perEdge;
    const geometry = new THREE.BufferGeometry();
    for (const [name, size] of [
      ["position", 3],
      ["normal", 3],
      ["furVolumeTangent", 3],
      ["furVolumeStep", 3],
      ["furVolumeViewNormal", 3],
      ["furVolumeThickness", 1],
      ["furVolumeDensity", 1],
      ["furVolumeEnvelope", 1],
    ] as const)
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(
          new Float32Array(total * size),
          size,
        ).setUsage(THREE.DynamicDrawUsage),
      );
    const uv = new Float32Array(total * 2);
    const bind = new Float32Array(total * 3);
    const depth = new Float32Array(total);
    const indices =
      total > 65535
        ? new Uint32Array(region.edges.length * segments * 6)
        : new Uint16Array(region.edges.length * segments * 6);
    for (let i = 0; i < region.edges.length; i++) {
      const edge = region.edges[i];
      for (let node = 0; node <= segments; node++) {
        for (let side = 0; side < 2; side++) {
          const source = side === 0 ? edge.a : edge.b;
          const vertex = i * perEdge + node * 2 + side;
          uv.set(region.uv.subarray(source * 2, source * 2 + 2), vertex * 2);
          bind.set(
            region.canonical.subarray(source * 3, source * 3 + 3),
            vertex * 3,
          );
          depth[vertex] = node / segments;
        }
      }
      for (let node = 0; node < segments; node++) {
        const a = i * perEdge + node * 2;
        // One winding only. The independent fin material is DoubleSide.
        indices.set(
          [a, a + 1, a + 2, a + 1, a + 3, a + 2],
          (i * segments + node) * 6,
        );
      }
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute(
      "furBindPosition",
      new THREE.BufferAttribute(bind, 3),
    );
    geometry.setAttribute(
      "furVolumeDepth",
      new THREE.BufferAttribute(depth, 1),
    );
    geometry.setAttribute(
      "furVolumeFin",
      new THREE.BufferAttribute(new Float32Array(total).fill(1), 1),
    );
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const previous = region.finMesh.geometry;
    region.finMesh.geometry = geometry;
    region.finSegments = segments;
    region.finMesh.userData.volumeFinSegments = segments;
    region.finMesh.userData.volumeSourceEdges = region.edges.length;
    region.finMesh.userData.volumeBoundaryEdges = region.edges.filter(
      (e) => e.opposites.length === 1,
    ).length;
    previous.dispose();
  }

  function updateFins(region: Region, density: number, segments: number) {
    if (region.finSegments !== segments) allocateFins(region, segments);
    const geometry = region.finMesh.geometry;
    const attributes = geometry.attributes;
    const output = Object.fromEntries(
      [
        "position",
        "normal",
        "furVolumeTangent",
        "furVolumeStep",
        "furVolumeViewNormal",
        "furVolumeThickness",
        "furVolumeDensity",
        "furVolumeEnvelope",
      ].map((name) => [name, attributes[name].array]),
    ) as Record<string, Float32Array>;
    const qa = new Float64Array(3),
      qb = new Float64Array(3),
      qc = new Float64Array(3);
    const da = new Float64Array(3),
      db = new Float64Array(3);
    const edgeVector = new Float64Array(3),
      referenceNormal = new Float64Array(3);
    const viewNormal = new Float64Array(3),
      endpointNormal = new Float64Array(3);
    const distances: number[] = [];
    const evaluate = (
      vertex: number,
      h: number,
      point: Float64Array,
      derivative?: Float64Array,
    ) => {
      const o = vertex * 3,
        height = region.posedHeight[vertex],
        sweep = region.posedSweep[vertex];
      for (let axis = 0; axis < 3; axis++) {
        point[axis] =
          region.posedPositions[o + axis] +
          region.posedNormals[o + axis] * height * h +
          region.posedTangents[o + axis] * sweep * h * h;
        if (derivative)
          derivative[axis] =
            region.posedNormals[o + axis] * height +
            region.posedTangents[o + axis] * 2 * sweep * h;
      }
    };
    const unit = (v: Float64Array, fallback?: Float64Array) => {
      const length = Math.hypot(v[0], v[1], v[2]);
      if (length > 1e-12)
        for (let axis = 0; axis < 3; axis++) v[axis] /= length;
      else if (fallback) v.set(fallback);
      else {
        v[0] = 0;
        v[1] = 1;
        v[2] = 0;
      }
    };
    const cross = (a: Float64Array, b: Float64Array, out: Float64Array) => {
      out[0] = a[1] * b[2] - a[2] * b[1];
      out[1] = a[2] * b[0] - a[0] * b[2];
      out[2] = a[0] * b[1] - a[1] * b[0];
    };
    const align = (v: Float64Array, reference: Float64Array) => {
      if (v[0] * reference[0] + v[1] * reference[1] + v[2] * reference[2] < 0)
        for (let axis = 0; axis < 3; axis++) v[axis] = -v[axis];
    };
    const perEdge = (segments + 1) * 2;
    for (let i = 0; i < region.edges.length; i++) {
      const edge = region.edges[i];
      for (let axis = 0; axis < 3; axis++) {
        edgeVector[axis] =
          region.posedPositions[edge.b * 3 + axis] -
          region.posedPositions[edge.a * 3 + axis];
        qc[axis] =
          region.posedNormals[edge.a * 3 + axis] +
          region.posedNormals[edge.b * 3 + axis];
      }
      cross(edgeVector, qc, referenceNormal);
      unit(referenceNormal);
      for (let node = 0; node <= segments; node++) {
        const h = node / segments;
        evaluate(edge.a, h, qa, da);
        evaluate(edge.b, h, qb, db);
        for (let axis = 0; axis < 3; axis++) {
          edgeVector[axis] = qb[axis] - qa[axis];
          qc[axis] = da[axis] + db[axis];
        }
        cross(edgeVector, qc, viewNormal);
        unit(viewNormal, referenceNormal);
        align(viewNormal, referenceNormal);
        distances.length = 0;
        for (const opposite of edge.opposites) {
          evaluate(opposite, h, qc);
          const distance = Math.abs(
            (qc[0] - qa[0]) * viewNormal[0] +
              (qc[1] - qa[1]) * viewNormal[1] +
              (qc[2] - qa[2]) * viewNormal[2],
          );
          if (Number.isFinite(distance)) distances.push(distance);
        }
        // The neighbouring cell's transverse altitude is a physical integration
        // width. A boundary has half a cell; two adjacent cells supply a median.
        // It does not depend on either shell count or fin segment subdivision.
        let spacing = 0;
        if (distances.length === 1) spacing = distances[0] * 0.5;
        else if (distances.length === 2)
          spacing = (distances[0] + distances[1]) * 0.5;
        else if (distances.length) {
          distances.sort((a, b) => a - b);
          const middle = distances.length >> 1;
          spacing =
            distances.length % 2
              ? distances[middle]
              : (distances[middle - 1] + distances[middle]) * 0.5;
        }
        for (let side = 0; side < 2; side++) {
          const source = side === 0 ? edge.a : edge.b;
          const point = side === 0 ? qa : qb;
          const derivative = side === 0 ? da : db;
          const vertex = i * perEdge + node * 2 + side,
            o = vertex * 3;
          cross(edgeVector, derivative, endpointNormal);
          unit(endpointNormal, viewNormal);
          align(endpointNormal, viewNormal);
          const shadingHeight = region.posedShadingHeight[source];
          const shadingSweep = region.posedShadingSweep[source];
          const sx =
            region.posedNormals[source * 3] * shadingHeight +
            region.posedTangents[source * 3] * 2 * shadingSweep * h;
          const sy =
            region.posedNormals[source * 3 + 1] * shadingHeight +
            region.posedTangents[source * 3 + 1] * 2 * shadingSweep * h;
          const sz =
            region.posedNormals[source * 3 + 2] * shadingHeight +
            region.posedTangents[source * 3 + 2] * 2 * shadingSweep * h;
          const tangentLength = Math.hypot(sx, sy, sz);
          for (let axis = 0; axis < 3; axis++) {
            output.position[o + axis] = point[axis];
            output.normal[o + axis] = region.posedNormals[source * 3 + axis];
            output.furVolumeViewNormal[o + axis] = endpointNormal[axis];
            output.furVolumeTangent[o + axis] =
              tangentLength > 1e-12
                ? (axis === 0 ? sx : axis === 1 ? sy : sz) / tangentLength
                : region.posedNormals[source * 3 + axis];
            // Fins integrate across neighbouring cells, not along this step.
            // Retain it as a geometric diagnostic; their shader ignores it.
            output.furVolumeStep[o + axis] = derivative[axis] / segments;
          }
          output.furVolumeThickness[vertex] = spacing;
          output.furVolumeDensity[vertex] = density * region.weights[source];
          output.furVolumeEnvelope[vertex] = region.posedHeight[source];
        }
      }
    }
    for (const name of Object.keys(output)) {
      const attribute = attributes[name] as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, attribute.array.length);
      attribute.needsUpdate = true;
    }
    geometry.setDrawRange(0, region.edges.length * segments * 6);
    region.finMesh.userData.volumeDensity = density;
  }

  function update(settings: CatFurVolumeUpdate) {
    if (disposed) return;
    if (
      settings.positions.length !== vertexCount * 3 ||
      settings.normals.length !== vertexCount * 3 ||
      settings.directions.length !== vertexCount * 3
    )
      throw new Error("A changed skin topology requires a new fur volume.");
    lastUpdate = settings;
    Object.assign(enabled, settings.enabledRegions);
    if (settings.layerCount !== undefined)
      currentLayers = layersFor(settings.layerCount);
    else if (settings.detail !== undefined) {
      // Hysteresis avoids allocation churn while orbiting near an LOD threshold.
      if (settings.detail < 0.4) currentLayers = Math.min(8, defaultLayers);
      else if (settings.detail > 0.6) currentLayers = defaultLayers;
    }
    for (const region of regions) {
      const density = clamp(finite(settings.densities[region.name]), 0, 1);
      const length = Math.max(0, finite(settings.lengths[region.name]));
      const active =
        settings.coatType === "long" &&
        enabled[region.name] &&
        density > 0 &&
        length > 0 &&
        region.indices.length > 0;
      region.mesh.visible = active;
      region.finMesh.visible = active && region.edges.length > 0;
      if (!active) {
        region.mesh.geometry.setDrawRange(0, 0);
        region.finMesh.geometry.setDrawRange(0, 0);
        continue;
      }
      if (region.layers !== currentLayers) allocate(region, currentLayers);
      const geometry = region.mesh.geometry;
      const attributes = geometry.attributes;
      const p = attributes.position.array as Float32Array;
      const n = attributes.normal.array as Float32Array;
      const tangent = attributes.furVolumeTangent.array as Float32Array;
      const step = attributes.furVolumeStep.array as Float32Array;
      const thickness = attributes.furVolumeThickness.array as Float32Array;
      const densities = attributes.furVolumeDensity.array as Float32Array;
      const envelope = attributes.furVolumeEnvelope.array as Float32Array;
      const count = region.vertices.length;
      for (let i = 0; i < count; i++) {
        const source = region.vertices[i] * 3;
        let nx = finite(settings.normals[source]);
        let ny = finite(settings.normals[source + 1], 1);
        let nz = finite(settings.normals[source + 2]);
        const nl = Math.hypot(nx, ny, nz);
        if (nl > 1e-8) {
          nx /= nl;
          ny /= nl;
          nz /= nl;
        } else {
          nx = 0;
          ny = 1;
          nz = 0;
        }
        let tx = finite(settings.directions[source]);
        let ty = finite(settings.directions[source + 1]);
        let tz = finite(settings.directions[source + 2]);
        const dot = tx * nx + ty * ny + tz * nz;
        tx -= nx * dot;
        ty -= ny * dot;
        tz -= nz * dot;
        let tl = Math.hypot(tx, ty, tz);
        if (tl < 1e-8) {
          if (Math.abs(ny) < 0.9) {
            tx = nz;
            ty = 0;
            tz = -nx;
          } else {
            tx = 0;
            ty = -nz;
            tz = ny;
          }
          tl = Math.hypot(tx, ty, tz) || 1;
        }
        tx /= tl;
        ty /= tl;
        tz /= tl;
        const shadingHeight = region.height[i] * length;
        const shadingSweep = region.sweep[i] * length;
        const height = shadingHeight * envelopeScale;
        const sweep = shadingSweep * sweepScale;
        region.posedPositions[i * 3] = finite(settings.positions[source]);
        region.posedPositions[i * 3 + 1] = finite(
          settings.positions[source + 1],
        );
        region.posedPositions[i * 3 + 2] = finite(
          settings.positions[source + 2],
        );
        region.posedNormals.set([nx, ny, nz], i * 3);
        region.posedTangents.set([tx, ty, tz], i * 3);
        region.posedHeight[i] = height;
        region.posedSweep[i] = sweep;
        region.posedShadingHeight[i] = shadingHeight;
        region.posedShadingSweep[i] = shadingSweep;
        for (let layer = 0; layer < currentLayers; layer++) {
          const vertex = layer * count + i;
          const offset = vertex * 3;
          const h = (layer + 0.5) / currentLayers;
          const radial = height * h;
          const travel = sweep * h * h;
          p[offset] =
            finite(settings.positions[source]) + nx * radial + tx * travel;
          p[offset + 1] =
            finite(settings.positions[source + 1]) + ny * radial + ty * travel;
          p[offset + 2] =
            finite(settings.positions[source + 2]) + nz * radial + tz * travel;
          n[offset] = nx;
          n[offset + 1] = ny;
          n[offset + 2] = nz;
          const vx = nx * shadingHeight + tx * 2 * shadingSweep * h;
          const vy = ny * shadingHeight + ty * 2 * shadingSweep * h;
          const vz = nz * shadingHeight + tz * 2 * shadingSweep * h;
          const vl = Math.hypot(vx, vy, vz) || 1;
          tangent[offset] = vx / vl;
          tangent[offset + 1] = vy / vl;
          tangent[offset + 2] = vz / vl;
          step[offset] = (nx * height + tx * 2 * sweep * h) / currentLayers;
          step[offset + 1] = (ny * height + ty * 2 * sweep * h) / currentLayers;
          step[offset + 2] = (nz * height + tz * 2 * sweep * h) / currentLayers;
          // weights partition regional contributions, never the user's height.
          // Multiplying both height and density by them would thin seams twice.
          densities[vertex] = density * region.weights[i];
          envelope[vertex] = height;
          thickness[vertex] = height / currentLayers;
        }
      }
      for (const name of [
        "position",
        "normal",
        "furVolumeTangent",
        "furVolumeStep",
        "furVolumeThickness",
        "furVolumeDensity",
        "furVolumeEnvelope",
      ]) {
        const attribute = attributes[name] as THREE.BufferAttribute;
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, attribute.array.length);
        attribute.needsUpdate = true;
      }
      geometry.setDrawRange(0, region.indices.length * currentLayers);
      region.mesh.userData.volumeDensity = density;
      region.mesh.userData.volumeBaseLength = length;
      if (region.finMesh.visible) {
        const segments =
          settings.finSegments !== undefined
            ? finSegmentsFor(settings.finSegments)
            : currentLayers <= 8
              ? Math.min(4, defaultFinSegments)
              : defaultFinSegments;
        updateFins(region, density, segments);
      }
    }
  }

  return {
    meshes: regions.flatMap((region) => [region.mesh, region.finMesh]),
    update,
    /** Coordinate-domain change; the density atlas must be baked for these scales. */
    setGeometryScales(settings: CatFurVolumeGeometryScales = {}) {
      if (disposed) return;
      const nextEnvelope = settings.envelopeScale ?? 1;
      const nextSweep = settings.sweepScale ?? 1;
      if (
        !Number.isFinite(nextEnvelope) ||
        nextEnvelope <= 0 ||
        !Number.isFinite(nextSweep) ||
        nextSweep < 0
      )
        throw new Error(
          "Fur volume geometry scales require a positive envelope and nonnegative sweep.",
        );
      if (nextEnvelope === envelopeScale && nextSweep === sweepScale) return;
      envelopeScale = nextEnvelope;
      sweepScale = nextSweep;
      for (const region of regions)
        for (const mesh of [region.mesh, region.finMesh])
          mesh.userData.volumeGeometryScales = { envelopeScale, sweepScale };
      // The runtime may otherwise skip update when only the atlas/domain changes.
      if (lastUpdate) update(lastUpdate);
    },
    /** Volumetric preview is not baked into a misleading opaque PBR surface. */
    snapshotMeshes(): THREE.Mesh[] {
      return [];
    },
    /** Caller owns the optional sampled density; geometry disposal never closes it. */
    setDensityTextureForRegion(
      name: RegionName,
      texture: THREE.Data3DTexture | null,
      scale = 1,
      uvTransform = new THREE.Vector4(1, 1, 0, 0),
    ) {
      if (disposed) return;
      const region = regions.find((region) => region.name === name);
      if (!region) return;
      for (const material of [region.mesh.material, region.finMesh.material])
        configureCatFurVolumeMaterial(material, {
          densityTexture: texture,
          densityScale: scale,
          densityUvTransform: uvTransform,
        });
    },
    getInfo() {
      return regions.map((region) => {
        const shellVertices = region.vertices.length * region.layers;
        const shellTriangles = (region.indices.length / 3) * region.layers;
        const shellBytes = geometryBytes(region.mesh.geometry);
        const finVertices = region.edges.length * (region.finSegments + 1) * 2;
        const finTriangles = region.edges.length * region.finSegments * 2;
        const finBytes = geometryBytes(region.finMesh.geometry);
        return {
          region: region.name,
          active: region.mesh.visible,
          sampleMode:
            region.mesh.material.userData.catFurVolume?.sampleMode ??
            "procedural",
          geometryScales: { envelopeScale, sweepScale },
          layers: region.layers,
          vertices: shellVertices + (region.finSegments ? finVertices : 0),
          triangles: shellTriangles + finTriangles,
          bytes: shellBytes + finBytes,
          shellVertices,
          shellTriangles,
          shellBytes,
          finEdges: region.edges.length,
          finSegments: region.finSegments,
          finVertices: region.finSegments ? finVertices : 0,
          finTriangles,
          finBytes,
        };
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const region of regions) {
        for (const mesh of [region.mesh, region.finMesh]) {
          mesh.removeFromParent();
          mesh.geometry.dispose();
          // Shader state is owned; maps still belong to the live source skin.
          mesh.material.dispose();
        }
      }
    },
  };
}
