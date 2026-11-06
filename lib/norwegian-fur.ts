import * as THREE from "three";
import {
  getCatCoatProfile,
  type CatCoatType,
  type CoatGroom,
} from "./cat-coat-profiles";
import { createCatGroomDetails } from "./cat-groom-details";
import {
  createCatCoatAnatomy,
  coatHairProfile,
  type CoatHairProfile,
} from "./cat-coat-anatomy";
import {
  bindSurfaceVector,
  createCatFurFlow,
  transportSurfaceVector,
  type FurSurfaceBinding,
} from "./cat-fur-flow";
import {
  createCatGroomGuides,
  CAT_GROOM_CURVE_STRIDE,
} from "./cat-groom-guides";
import {
  createCatFurMaterial,
  configureCatFurMaterial,
  createCatFurExportMaterial,
} from "./cat-fur-material";
import { createCatFurVolume } from "./cat-fur-volume";
import { buildCatFurVolumeFields } from "./cat-fur-volume-fields";
import { createCatNativeCoatDetails } from "./cat-native-coat-details";
import { createCatGroomPatchOrder } from "./cat-groom-patch-order";

/** A surface-bound groom. Every visible fibre is an actual tapered 3D ribbon. */
export type FurRegion = "head" | "ruff" | "body";
type FurShape = Record<string, number>;
type FurDesign = {
  shape: FurShape;
  coatType?: CatCoatType;
  coatMode?: "source" | "groom";
};
type RegionStats = {
  strands: number;
  capacity: number;
  length: number;
  previewStrands: number;
  detailLevel: number;
  strandSegments: number;
  strandVertices: number;
  strandIndices: number;
};
export type NorwegianFur = {
  readonly preparedGroom: boolean;
  meshes: THREE.Mesh[];
  update(design: FurDesign): void;
  refresh(options?: { headOnly?: boolean; full?: boolean }): void;
  setDetail(level: number): void;
  /** Internal controlled A/B; the volume remains preview-only. */
  setVolume(enabled: boolean): void;
  setVolumeGeometry(scales: {
    envelopeScale?: number;
    sweepScale?: number;
  }): void;
  setVolumeDensity(
    texture: THREE.Data3DTexture | null,
    scale?: number,
    uvTransform?: THREE.Vector4,
  ): void;
  volumeInfo(): ReturnType<ReturnType<typeof createCatFurVolume>["getInfo"]>;
  snapshotMeshes(): THREE.Mesh[];
  stats(): Record<FurRegion, RegionStats>;
  dispose(): void;
};

type V3 = [number, number, number];
type Landmarks = { eyeCenters: V3[]; earBases: V3[]; muzzleCenter: V3 };
type Root = {
  a: number;
  b: number;
  c: number;
  u: number;
  v: number;
  w: number;
  /** Shared patch centre on the same triangle; original individual roots stay. */
  patchU: number;
  patchV: number;
  patchW: number;
  variation: number;
  roll: number;
  layer: number;
  hairKind: CoatHairProfile["kind"];
  shortLength: number;
  longLength: number;
  hairWidth: number;
  hairLift: number;
  hairCrimp: number;
  /** Stable 0..1 position within its representative hair class. */
  downDepth: number;
  kind: number;
  breeches: number;
  color: V3;
  flow: FurSurfaceBinding;
  gather: FurSurfaceBinding;
  phase: number;
  curl: number;
  flowLength: number;
  guardLength: number;
  bodyStyling: number;
  /** Neutral-surface back-to-flank blend; never reclassified by an animation. */
  backLay: number;
  /** Smooth exclusion of head, legs and tail, independent of surface direction. */
  trunkWeight: number;
  /** Neutral-space relaxed limb/tail loft; a modelling choice, not measured angles. */
  appendageLay: number;
  /** Neutral skin weight used for smooth tail-only coat layering. */
  tailWeight: number;
};
type Triangle = { a: number; b: number; c: number; area: number; end: number };
type Region = {
  name: FurRegion;
  capacity: number;
  roots: Root[];
  /** Four explicit non-root guide knots in canonical root [N,T,B] coordinates. */
  groomCurve: Float32Array;
  longGroomCurve: Float32Array;
  /** Authored local outer-coat length and width, both one for unaffected roots. */
  longStyle: Float32Array;
  strandSegments: number;
  strandVertices: number;
  strandIndices: number;
  samples: ReturnType<typeof curveSamples>;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  length: number;
  density: number;
  coat: CatCoatType | null;
  pendingFull: boolean;
  pendingMotion: boolean;
};

function curveSamples(segments: number) {
  return Array.from({ length: segments + 1 }, (_, sample) => {
    const t = sample / segments;
    const interval = Math.min(3, Math.floor(t * 4));
    const u = t * 4 - interval,
      u2 = u * u,
      u3 = u2 * u;
    const value = [0, 0, 0, 0, 0],
      derivative = [0, 0, 0, 0, 0];
    const add = (node: number, v: number, d: number) => {
      value[node] += v;
      derivative[node] += d * 4;
    };
    const h00 = 2 * u3 - 3 * u2 + 1,
      h10 = u3 - 2 * u2 + u,
      h01 = -2 * u3 + 3 * u2,
      h11 = u3 - u2;
    const d00 = 6 * u2 - 6 * u,
      d10 = 3 * u2 - 4 * u + 1,
      d01 = -d00,
      d11 = 3 * u2 - 2 * u;
    add(interval, h00, d00);
    add(interval + 1, h01, d01);
    // A Catmull-Rom/Hermite interpolant preserves every authored guide knot
    // and shares the same tangent on both sides of each interior knot.
    if (interval === 0) add(1, h10, d10);
    else {
      add(interval + 1, h10 * 0.5, d10 * 0.5);
      add(interval - 1, -h10 * 0.5, -d10 * 0.5);
    }
    if (interval === 3) {
      add(4, h11, d11);
      add(3, -h11, -d11);
    } else {
      add(interval + 2, h11 * 0.5, d11 * 0.5);
      add(interval, -h11 * 0.5, -d11 * 0.5);
    }
    return {
      t,
      t2: t * t,
      sinPi: Math.sin(Math.PI * t),
      cosPi: Math.cos(Math.PI * t),
      sinBend: Math.sin(t * 2.4),
      cosBend: Math.cos(t * 2.4),
      // One broad down curl resolves across eight segments; the previous
      // 2.1 cycles produced 40-degree segment corners instead of soft crimp.
      sinCrimp: Math.sin(t * Math.PI * 2),
      cosCrimp: Math.cos(t * Math.PI * 2),
      taper: Math.max(0.018, Math.pow(1 - t, 0.65)),
      value,
      derivative,
    };
  });
}
const SHORT_SAMPLES = curveSamples(4);
const LONG_SAMPLES = curveSamples(8);
// Two opposite windings with front-face culling keep the authored outward
// cylinder-lighting normal on either visible side. DoubleSide would flip that
// normal on half the random ribbons, making white fur look like black stubble.
const CAPACITIES: Record<FurRegion, number> = {
  head: 36_000,
  ruff: 24_000,
  body: 70_000,
};
const REPRESENTATIVE_GROUP_SIZE = 6;
const DEFAULT_LENGTHS: Record<FurRegion, number> = {
  head: 40,
  ruff: 55,
  body: 45,
};
const FUR_NAMES: Record<FurRegion, string> = {
  head: "Fur_Head",
  ruff: "Fur_Ruff",
  body: "Fur_Body",
};
const clamp = THREE.MathUtils.clamp;

function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function metadata(scene: THREE.Group) {
  let data: Record<string, unknown> | undefined;
  scene.traverse((node) => {
    if (!data && node.userData.creatorTemplateId === "norwegian-cat-v1")
      data = node.userData;
  });
  if (!data?.creatorLandmarks || !data.creatorHeadBounds)
    throw new Error("毛发缺少猫咪解剖定位。");
  return {
    landmarks: data.creatorLandmarks as Landmarks,
    headBounds: data.creatorHeadBounds as { min: V3; max: V3 },
  };
}

/** Read the already-loaded original albedo; no network or replacement texture. */
function colorSampler(surface: THREE.Mesh) {
  const material = (
    Array.isArray(surface.material) ? surface.material[0] : surface.material
  ) as THREE.MeshStandardMaterial;
  const texture = material.map;
  if (!texture?.image) throw new Error("毛发需要原猫的毛色贴图。");
  const image = texture.image as CanvasImageSource & {
    width: number;
    height: number;
  };
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法读取猫咪毛色。");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  texture.updateMatrix();
  const uv = new THREE.Vector2();
  const color = new THREE.Color();
  return (u: number, v: number): V3 => {
    uv.set(u, v).applyMatrix3(texture.matrix);
    if (texture.flipY) uv.y = 1 - uv.y;
    const x = clamp(Math.round(uv.x * (canvas.width - 1)), 0, canvas.width - 1);
    const y = clamp(
      Math.round(uv.y * (canvas.height - 1)),
      0,
      canvas.height - 1,
    );
    const offset = (y * canvas.width + x) * 4;
    color.setRGB(
      pixels[offset] / 255,
      pixels[offset + 1] / 255,
      pixels[offset + 2] / 255,
      THREE.SRGBColorSpace,
    );
    color.multiply(material.color);
    return [color.r, color.g, color.b];
  };
}

function skinMembership(surface: THREE.Mesh) {
  const count = surface.geometry.attributes.position.count;
  const head = new Float32Array(count),
    limb = new Float32Array(count),
    hind = new Float32Array(count),
    tail = new Float32Array(count);
  if (!(surface instanceof THREE.SkinnedMesh))
    return { head, limb, hind, tail };
  const indices = surface.geometry.getAttribute("skinIndex"),
    weights = surface.geometry.getAttribute("skinWeight");
  if (!indices || !weights) return { head, limb, hind, tail };
  const names = surface.skeleton.bones.map((bone) => bone.name);
  for (let vertex = 0; vertex < count; vertex++) {
    for (let channel = 0; channel < 4; channel++) {
      const name = names[indices.getComponent(vertex, channel)] || "";
      const weight = weights.getComponent(vertex, channel);
      if (/^head$|^jaw$|_eye|Bone008|Bone009/.test(name))
        head[vertex] += weight;
      if (/Leg|Palm|Digit/.test(name)) limb[vertex] += weight;
      if (/Leg(?:1|2|Palm|Digit)/.test(name) && !name.includes("(1)"))
        hind[vertex] += weight;
      if (/Tail/.test(name)) tail[vertex] += weight;
    }
  }
  return { head, limb, hind, tail };
}

/** UV seams are welded for classification only; the original mesh stays intact. */
function principalSurfaceVertices(surface: THREE.Mesh) {
  const position = surface.geometry.getAttribute("position"),
    index = surface.geometry.index;
  const parent = Int32Array.from({ length: position.count }, (_, i) => i);
  const find = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root];
    while (parent[start] !== start) {
      const next = parent[start];
      parent[start] = root;
      start = next;
    }
    return root;
  };
  const merge = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const welded = new Map<string, number>();
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.round(position.getX(i) * 1e6)},${Math.round(position.getY(i) * 1e6)},${Math.round(position.getZ(i) * 1e6)}`;
    const other = welded.get(key);
    if (other !== undefined) merge(i, other);
    else welded.set(key, i);
  }
  const triangles = index ? index.count / 3 : position.count / 3;
  for (let i = 0; i < triangles; i++) {
    const a = index ? index.getX(i * 3) : i * 3;
    const b = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const c = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    merge(a, b);
    merge(a, c);
  }
  const sizes = new Map<number, number>();
  for (let i = 0; i < position.count; i++)
    sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1);
  let largest = -1,
    max = 0;
  for (const [root, size] of sizes)
    if (size > max) {
      max = size;
      largest = root;
    }
  return Uint8Array.from({ length: position.count }, (_, i) =>
    Number(find(i) === largest),
  );
}

function createFurGeometry(roots: Root[], strandSegments: number) {
  const capacity = roots.length;
  const strandVertices = (strandSegments + 1) * 2,
    strandIndices = strandSegments * 12;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array(capacity * strandVertices * 3),
      3,
    ).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(
      new Float32Array(capacity * strandVertices * 3),
      3,
    ).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    "furWidth",
    new THREE.BufferAttribute(
      new Float32Array(capacity * strandVertices * 3),
      3,
    ).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    "furFilterAxis",
    new THREE.Int8BufferAttribute(
      new Int8Array(capacity * strandVertices),
      1,
    ).setUsage(THREE.DynamicDrawUsage),
  );
  // Quantized analytic root-to-tip directions are used only by live lighting.
  // Snapshot export below deliberately keeps its ordinary PBR attributes.
  geometry.setAttribute(
    "furTangent",
    new THREE.Int16BufferAttribute(
      new Int16Array(capacity * strandVertices * 3), 3, true,
    ).setUsage(THREE.DynamicDrawUsage),
  );
  const coordinates = new Uint16Array(capacity * strandVertices * 2);
  const colors = new Float32Array(capacity * strandVertices * 3);
  const volumeWeights = new Uint8Array(capacity * strandVertices);
  const indices = new Uint32Array(capacity * strandIndices);
  for (let strand = 0; strand < capacity; strand++) {
    const root = roots[strand];
    const surfaceDepth = clamp((root.downDepth - 0.72) / 0.22, 0, 1);
    const bulkFraction =
      1 - surfaceDepth * surfaceDepth * (3 - 2 * surfaceDepth);
    volumeWeights.fill(
      root.hairKind === "down" && root.kind === 0
        ? Math.round(255 * root.trunkWeight * bulkFraction)
        : 0,
      strand * strandVertices,
      (strand + 1) * strandVertices,
    );
    for (let sample = 0; sample <= strandSegments; sample++) {
      const t = sample / strandSegments;
      const shade = (0.94 + 0.1 * t) * root.variation;
      for (let side = 0; side < 2; side++) {
        const offset = (strand * strandVertices + sample * 2 + side) * 3;
        colors[offset] = root.color[0] * shade;
        colors[offset + 1] = root.color[1] * shade;
        colors[offset + 2] = root.color[2] * shade;
        const texel = (strand * strandVertices + sample * 2 + side) * 2;
        coordinates[texel] = side * 65535;
        coordinates[texel + 1] = Math.round(t * 65535);
      }
    }
    for (let segment = 0; segment < strandSegments; segment++) {
      const a = strand * strandVertices + segment * 2,
        offset = strand * strandIndices + segment * 12;
      indices.set(
        [
          a,
          a + 1,
          a + 2,
          a + 1,
          a + 3,
          a + 2,
          a + 2,
          a + 1,
          a,
          a + 2,
          a + 3,
          a + 1,
        ],
        offset,
      );
    }
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute(
    "uv",
    new THREE.Uint16BufferAttribute(coordinates, 2, true),
  );
  geometry.setAttribute(
    "furVolumeWeight",
    new THREE.Uint8BufferAttribute(volumeWeights, 1, true),
  );
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function createRegion(
  name: FurRegion,
  roots: Root[],
  groomCurve: Float32Array,
  longGroomCurve: Float32Array,
  longStyle: Float32Array,
): Region {
  const capacity = roots.length,
    strandSegments = 4,
    strandVertices = 10,
    strandIndices = 48;
  const geometry = createFurGeometry(roots, strandSegments);
  const material = createCatFurMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = FUR_NAMES[name];
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  // Picking continues to the small original surface rather than intersecting
  // nearly a million fibre triangles on every pointer movement.
  mesh.raycast = () => {};
  mesh.userData = {
    norwegianFur: true,
    furRegion: name,
    capacity,
    strandVertices,
    strandSegments,
    strandIndices,
    rootPair: [0, 1],
    tipPair: [8, 9],
    rootBinding: "triangle-barycentric",
    exportPose: "static-current-groom",
  };
  return {
    name,
    capacity,
    roots,
    groomCurve,
    longGroomCurve,
    longStyle,
    strandSegments,
    strandVertices,
    strandIndices,
    samples: SHORT_SAMPLES,
    mesh,
    length: -1,
    density: -1,
    coat: null,
    pendingFull: false,
    pendingMotion: false,
  };
}

/** Load once, attach the returned meshes as direct children of scene. */
export async function createNorwegianFur(
  scene: THREE.Group,
  surface: THREE.Mesh,
  options: { includeGroom?: boolean } = {},
): Promise<NorwegianFur> {
  if (options.includeGroom === false)
    return createCatNativeCoatDetails(scene, surface);
  const { landmarks, headBounds } = metadata(scene);
  const uv = surface.geometry.getAttribute("uv");
  if (!uv) throw new Error("猫咪缺少毛色坐标。");
  const colorAt = colorSampler(surface);
  const included = principalSurfaceVertices(surface);
  const membership = skinMembership(surface);
  const position = surface.geometry.getAttribute("position");
  const indices = surface.geometry.index;
  const evaluated = new Float32Array(position.count * 3);
  const normals = new Float32Array(position.count * 3);
  const previousPositions = new Float32Array(evaluated.length);
  const previousNormals = new Float32Array(normals.length);
  const dirtyVertices = new Uint8Array(position.count);
  const matrix = new THREE.Matrix4(),
    inverse = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const tailSegments: {
    a: THREE.Vector3;
    b: THREE.Vector3;
    direction: THREE.Vector3;
  }[] = [];
  const limbSegments: {
    a: THREE.Vector3;
    b: THREE.Vector3;
    direction: THREE.Vector3;
  }[] = [];
  let captureAxes = true;
  const seamGroups: number[][] = [];
  let signature = "";

  function evaluateSurface() {
    previousPositions.set(evaluated);
    previousNormals.set(normals);
    scene.updateMatrixWorld(true);
    if (surface instanceof THREE.SkinnedMesh) surface.skeleton.update();
    inverse.copy(scene.matrixWorld).invert();
    matrix.multiplyMatrices(inverse, surface.matrixWorld);
    if (captureAxes && surface instanceof THREE.SkinnedMesh) {
      const bones = surface.skeleton.bones
        .filter((bone) => /^PantherTail\d+$/.test(bone.name))
        .sort(
          (a, b) =>
            Number(a.name.match(/\d+$/)?.[0]) -
            Number(b.name.match(/\d+$/)?.[0]),
        );
      for (let i = 0; i + 1 < bones.length; i++) {
        const a = bones[i]
          .getWorldPosition(new THREE.Vector3())
          .applyMatrix4(inverse);
        const b = bones[i + 1]
          .getWorldPosition(new THREE.Vector3())
          .applyMatrix4(inverse);
        tailSegments.push({ a, b, direction: b.clone().sub(a).normalize() });
      }
      for (const bone of surface.skeleton.bones.filter((bone) =>
        /Leg(?:\d|Palm|Digit)/.test(bone.name),
      )) {
        for (const child of bone.children.filter(
          (child) => child instanceof THREE.Bone,
        )) {
          const a = bone
            .getWorldPosition(new THREE.Vector3())
            .applyMatrix4(inverse);
          const b = child
            .getWorldPosition(new THREE.Vector3())
            .applyMatrix4(inverse);
          if (a.distanceToSquared(b) > 1e-7)
            limbSegments.push({
              a,
              b,
              direction: b.clone().sub(a).normalize(),
            });
        }
      }
    }
    for (let i = 0; i < position.count; i++) {
      surface.getVertexPosition(i, point).applyMatrix4(matrix);
      evaluated[i * 3] = point.x;
      evaluated[i * 3 + 1] = point.y;
      evaluated[i * 3 + 2] = point.z;
    }
    normals.fill(0);
    const triangles = indices ? indices.count / 3 : position.count / 3;
    for (let triangle = 0; triangle < triangles; triangle++) {
      const a = indices ? indices.getX(triangle * 3) : triangle * 3;
      const b = indices ? indices.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const c = indices ? indices.getX(triangle * 3 + 2) : triangle * 3 + 2;
      const ax = evaluated[b * 3] - evaluated[a * 3],
        ay = evaluated[b * 3 + 1] - evaluated[a * 3 + 1],
        az = evaluated[b * 3 + 2] - evaluated[a * 3 + 2];
      const bx = evaluated[c * 3] - evaluated[a * 3],
        by = evaluated[c * 3 + 1] - evaluated[a * 3 + 1],
        bz = evaluated[c * 3 + 2] - evaluated[a * 3 + 2];
      const nx = ay * bz - az * by,
        ny = az * bx - ax * bz,
        nz = ax * by - ay * bx;
      for (const vertex of [a, b, c]) {
        normals[vertex * 3] += nx;
        normals[vertex * 3 + 1] += ny;
        normals[vertex * 3 + 2] += nz;
      }
    }
    // Weld only duplicated reference vertices with compatible skin normals.
    // Posed contacts are never welded: a folded leg remains a separate surface.
    for (const group of seamGroups) {
      let x = 0,
        y = 0,
        z = 0;
      for (const vertex of group) {
        x += normals[vertex * 3];
        y += normals[vertex * 3 + 1];
        z += normals[vertex * 3 + 2];
      }
      for (const vertex of group) {
        normals[vertex * 3] = x;
        normals[vertex * 3 + 1] = y;
        normals[vertex * 3 + 2] = z;
      }
    }
    for (let vertex = 0; vertex < position.count; vertex++) {
      const offset = vertex * 3,
        length =
          Math.hypot(
            normals[offset],
            normals[offset + 1],
            normals[offset + 2],
          ) || 1;
      normals[offset] /= length;
      normals[offset + 1] /= length;
      normals[offset + 2] /= length;
      dirtyVertices[vertex] = Number(
        Math.abs(evaluated[offset] - previousPositions[offset]) +
          Math.abs(evaluated[offset + 1] - previousPositions[offset + 1]) +
          Math.abs(evaluated[offset + 2] - previousPositions[offset + 2]) >
          1e-7 ||
          Math.abs(normals[offset] - previousNormals[offset]) +
            Math.abs(normals[offset + 1] - previousNormals[offset + 1]) +
            Math.abs(normals[offset + 2] - previousNormals[offset + 2]) >
            1e-5,
      );
    }
  }
  evaluateSurface();
  captureAxes = false;
  const seams = new Map<string, number[][]>();
  for (let vertex = 0; vertex < position.count; vertex++) {
    if (!included[vertex]) continue;
    const offset = vertex * 3;
    const key = `${Math.round(evaluated[offset] * 1e5)},${Math.round(evaluated[offset + 1] * 1e5)},${Math.round(evaluated[offset + 2] * 1e5)}`;
    const candidates = seams.get(key) ?? [];
    let group = candidates.find((candidate) => {
      const other = candidate[0] * 3;
      return (
        normals[offset] * normals[other] +
          normals[offset + 1] * normals[other + 1] +
          normals[offset + 2] * normals[other + 2] >
        0.8
      );
    });
    if (!group) {
      group = [];
      candidates.push(group);
      seams.set(key, candidates);
    }
    group.push(vertex);
  }
  for (const candidates of seams.values())
    for (const group of candidates)
      if (group.length > 1) seamGroups.push(group);
  evaluateSurface();
  const details = createCatGroomDetails(scene, surface, { colorAt });
  const allBounds = new THREE.Box3();
  for (let i = 0; i < position.count; i++)
    allBounds.expandByPoint(point.fromArray(evaluated, i * 3));
  const bodyHeight = allBounds.max.y - allBounds.min.y;
  const headBottom = headBounds.min[1];
  const eyeMid: V3 = [
    0,
    (landmarks.eyeCenters[0][1] + landmarks.eyeCenters[1][1]) / 2,
    (landmarks.eyeCenters[0][2] + landmarks.eyeCenters[1][2]) / 2,
  ];
  const flowField = createCatFurFlow({
    ...landmarks,
    headBounds,
    bodyBounds: {
      min: allBounds.min.toArray() as V3,
      max: allBounds.max.toArray() as V3,
    },
  });
  const coatAnatomy = createCatCoatAnatomy({
    ...landmarks,
    headBounds,
    bodyBounds: {
      min: allBounds.min.toArray() as V3,
      max: allBounds.max.toArray() as V3,
    },
  });
  const groomGuides = createCatGroomGuides(
    {
      ...landmarks,
      headBounds,
      bodyBounds: {
        min: allBounds.min.toArray() as V3,
        max: allBounds.max.toArray() as V3,
      },
    },
    {
      positions: evaluated,
      normals,
      included,
      head: membership.head,
      limb: membership.limb,
      tail: membership.tail,
      uv: (vertex) => [uv.getX(vertex), uv.getY(vertex)],
    },
  );
  const axisPoint = new THREE.Vector3(),
    axisClosest = new THREE.Vector3();
  const axisLine = new THREE.Line3();
  function referenceAxis(
    x: number,
    y: number,
    z: number,
    limb: number,
    tail: number,
  ): V3 {
    axisPoint.set(x, y, z);
    function weightedAxis(segments: typeof limbSegments, fallback: V3): V3 {
      let sx = 0,
        sy = 0,
        sz = 0,
        total = 0;
      for (const segment of segments) {
        axisLine
          .set(segment.a, segment.b)
          .closestPointToPoint(axisPoint, true, axisClosest);
        const weight = Math.exp(
          -axisClosest.distanceToSquared(axisPoint) / 0.028,
        );
        sx += segment.direction.x * weight;
        sy += segment.direction.y * weight;
        sz += segment.direction.z * weight;
        total += weight;
      }
      const length = Math.hypot(sx, sy, sz);
      return total > 1e-8 && length > 1e-8
        ? [sx / length, sy / length, sz / length]
        : fallback;
    }
    const leg = weightedAxis(limbSegments, [0, -0.98, -0.15]);
    const plume = weightedAxis(tailSegments, [0, 0.1, -0.99]);
    const blend = tail / Math.max(limb + tail, 1e-8);
    const mixed: V3 = leg.map(
      (v, i) => v * (1 - blend) + plume[i] * blend,
    ) as V3;
    const length = Math.hypot(...mixed) || 1;
    return mixed.map((v) => v / length) as V3;
  }
  const pools: Record<FurRegion, Triangle[]> = { head: [], ruff: [], body: [] };
  const areas: Record<FurRegion, number> = { head: 0, ruff: 0, body: 0 };
  const triangles = indices ? indices.count / 3 : position.count / 3;
  for (let triangle = 0; triangle < triangles; triangle++) {
    const a = indices ? indices.getX(triangle * 3) : triangle * 3;
    const b = indices ? indices.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const c = indices ? indices.getX(triangle * 3 + 2) : triangle * 3 + 2;
    if (!included[a] || !included[b] || !included[c]) continue;
    const ax = evaluated[b * 3] - evaluated[a * 3],
      ay = evaluated[b * 3 + 1] - evaluated[a * 3 + 1],
      az = evaluated[b * 3 + 2] - evaluated[a * 3 + 2];
    const bx = evaluated[c * 3] - evaluated[a * 3],
      by = evaluated[c * 3 + 1] - evaluated[a * 3 + 1],
      bz = evaluated[c * 3 + 2] - evaluated[a * 3 + 2];
    const area =
      Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
    if (area < 1e-10) continue;
    const y =
      (evaluated[a * 3 + 1] + evaluated[b * 3 + 1] + evaluated[c * 3 + 1]) / 3;
    const z =
      (evaluated[a * 3 + 2] + evaluated[b * 3 + 2] + evaluated[c * 3 + 2]) / 3;
    const h =
      (membership.head[a] + membership.head[b] + membership.head[c]) / 3;
    const region: FurRegion =
      h > 0.55 && y > headBottom - 0.03
        ? "head"
        : y > bodyHeight * 0.49 && z > eyeMid[2] - 0.75
          ? "ruff"
          : "body";
    areas[region] += area;
    pools[region].push({ a, b, c, area, end: areas[region] });
  }

  const shortHair: CoatHairProfile = {
    kind: "down",
    layerT: 0,
    lengthScale: 0,
    widthScale: 0,
    liftScale: 0,
    crimp: 0,
  };
  const longHair: CoatHairProfile = { ...shortHair };
  function rootAt(
    region: FurRegion,
    random: () => number,
    member: number,
    anchor?: Root,
  ): Root | null {
    const choice = random() * areas[region],
      pool = pools[region];
    let low = 0,
      high = pool.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (pool[middle].end < choice) low = middle + 1;
      else high = middle;
    }
    const triangle = anchor ?? pool[low];
    if (!triangle) return null;
    const { a, b, c } = triangle;
    const r = Math.sqrt(random());
    let u = 1 - r,
      v = r * (1 - random()),
      w = 1 - u - v;
    if (anchor) {
      // Representative compound-follicle patch. Every member stays on the
      // anchor's actual triangle; no free-space offsets or floating roots.
      const longestEdge = Math.max(
        Math.hypot(
          evaluated[b * 3] - evaluated[a * 3],
          evaluated[b * 3 + 1] - evaluated[a * 3 + 1],
          evaluated[b * 3 + 2] - evaluated[a * 3 + 2],
        ),
        Math.hypot(
          evaluated[c * 3] - evaluated[a * 3],
          evaluated[c * 3 + 1] - evaluated[a * 3 + 1],
          evaluated[c * 3 + 2] - evaluated[a * 3 + 2],
        ),
      );
      const spread = Math.min(0.65, 0.01 / Math.max(longestEdge, 0.001));
      u = anchor.u * (1 - spread) + u * spread;
      v = anchor.v * (1 - spread) + v * spread;
      w = anchor.w * (1 - spread) + w * spread;
    }
    const x =
      evaluated[a * 3] * u + evaluated[b * 3] * v + evaluated[c * 3] * w;
    const y =
      evaluated[a * 3 + 1] * u +
      evaluated[b * 3 + 1] * v +
      evaluated[c * 3 + 1] * w;
    const z =
      evaluated[a * 3 + 2] * u +
      evaluated[b * 3 + 2] * v +
      evaluated[c * 3 + 2] * w;
    const nY =
      normals[a * 3 + 1] * u + normals[b * 3 + 1] * v + normals[c * 3 + 1] * w;
    const color = colorAt(
      uv.getX(a) * u + uv.getX(b) * v + uv.getX(c) * w,
      uv.getY(a) * u + uv.getY(b) * v + uv.getY(c) * w,
    );
    let lengthScale = 1;
    if (region === "head") {
      // Geometric exclusion regions protect the entire eyeball opening. A short
      // transition around the lid avoids hairs crossing the optical surface.
      for (const eye of landmarks.eyeCenters) {
        const distance =
          ((x - eye[0]) / 0.14) ** 2 +
          ((y - eye[1]) / 0.105) ** 2 +
          ((z - eye[2]) / 0.22) ** 2;
        if (distance < 1) return null;
        if (distance < 2.8)
          lengthScale = Math.min(lengthScale, 0.22 + (distance - 1) * 0.23);
      }
      const muzzle = landmarks.muzzleCenter;
      if (
        Math.abs(x - muzzle[0]) < 0.095 &&
        y > muzzle[1] - 0.025 &&
        y < muzzle[1] + 0.19 &&
        z > muzzle[2] + 0.005
      )
        return null;
      const pink = color[0] > color[1] * 1.5 && color[0] > color[2] * 1.2;
      if (pink && z > eyeMid[2] - 0.3) return null;
    }
    if (y < allBounds.min.y + 0.09 && nY < -0.3) return null;
    const limb =
      membership.limb[a] * u + membership.limb[b] * v + membership.limb[c] * w;
    const tail =
      membership.tail[a] * u + membership.tail[b] * v + membership.tail[c] * w;
    const hind =
      membership.hind[a] * u + membership.hind[b] * v + membership.hind[c] * w;
    const heightBlend = clamp(
      (y - bodyHeight * 0.2) / (bodyHeight * 0.2),
      0,
      1,
    );
    const breeches = hind * heightBlend * heightBlend * (3 - 2 * heightBlend);
    const kind = tail > 0.4 ? 2 : limb > 0.45 ? 1 : 0;
    const sourceNormal: V3 = [
      normals[a * 3] * u + normals[b * 3] * v + normals[c * 3] * w,
      nY,
      normals[a * 3 + 2] * u + normals[b * 3 + 2] * v + normals[c * 3 + 2] * w,
    ];
    const head =
      membership.head[a] * u + membership.head[b] * v + membership.head[c] * w;
    const anatomy = coatAnatomy.sample([x, y, z], sourceNormal, {
      head,
      limb,
      hind,
      tail,
    });
    if (!anchor && random() > anatomy.density) return null;
    lengthScale *= anatomy.lengthScale;
    const flow = flowField.sample([x, y, z], sourceNormal, {
      head:
        membership.head[a] * u +
        membership.head[b] * v +
        membership.head[c] * w,
      limb,
      tail,
      axis:
        Math.max(limb, tail) > 0.001
          ? referenceAxis(x, y, z, limb, tail)
          : undefined,
    });
    const ab: V3 = [
      evaluated[b * 3] - evaluated[a * 3],
      evaluated[b * 3 + 1] - evaluated[a * 3 + 1],
      evaluated[b * 3 + 2] - evaluated[a * 3 + 2],
    ];
    const ac: V3 = [
      evaluated[c * 3] - evaluated[a * 3],
      evaluated[c * 3 + 1] - evaluated[a * 3 + 1],
      evaluated[c * 3 + 2] - evaluated[a * 3 + 2],
    ];
    const variation = 0.87 + random() * 0.25,
      roll = random() * Math.PI;
    const dorsal = clamp(
      (nY / (Math.hypot(...sourceNormal) || 1) - 0.15) / 0.55,
      0,
      1,
    );
    const appendage = clamp((Math.max(head, limb, tail) - 0.05) / 0.4, 0, 1);
    const tailLay = THREE.MathUtils.smoothstep(tail, 0.05, 0.45);
    const limbLay = THREE.MathUtils.smoothstep(limb, 0.05, 0.45);
    // Preserve the seeded planting stream while moving the old post-plant
    // stratification into the construction-time profile cache.
    random();
    const layer = (member + random()) / REPRESENTATIVE_GROUP_SIZE;
    const hairAnatomy = { ...anatomy, lengthScale };
    coatHairProfile(layer, hairAnatomy, "short", shortHair);
    coatHairProfile(layer, hairAnatomy, "long", longHair);
    return {
      a,
      b,
      c,
      u,
      v,
      w,
      patchU: u,
      patchV: v,
      patchW: w,
      color,
      hairKind: shortHair.kind,
      shortLength: shortHair.lengthScale,
      longLength: longHair.lengthScale,
      hairWidth: shortHair.widthScale,
      hairLift: shortHair.liftScale,
      hairCrimp: shortHair.crimp,
      downDepth: shortHair.layerT,
      kind,
      breeches,
      flow: bindSurfaceVector(flow.tangent, ab, ac),
      gather: bindSurfaceVector(flow.gather, ab, ac),
      phase: flow.phase,
      curl: flow.wave,
      flowLength: flow.lengthScale,
      guardLength: flow.guardLengthScale,
      bodyStyling: flow.bodyStyling,
      backLay:
        (1 - appendage * appendage * (3 - 2 * appendage)) *
        dorsal *
        dorsal *
        (3 - 2 * dorsal),
      trunkWeight: 1 - appendage * appendage * (3 - 2 * appendage),
      appendageLay: 1 - 0.45 * tailLay - 0.32 * limbLay * (1 - tailLay),
      tailWeight: tail,
      variation,
      roll,
      layer,
    };
  }

  const regions: Region[] = [];
  try {
    for (const name of ["head", "ruff", "body"] as const) {
      const random = randomGenerator(
        { head: 0x74ace, ruff: 0x5eed34, body: 0x9feca1 }[name],
      );
      const roots: Root[] = [];
      let anchor: Root | undefined;
      const representativeGroupSize = REPRESENTATIVE_GROUP_SIZE;
      for (
        let attempt = 0;
        roots.length < CAPACITIES[name] && attempt < CAPACITIES[name] * 12;
        attempt++
      ) {
        const member = roots.length % representativeGroupSize;
        if (member === 0) anchor = undefined;
        const root = rootAt(name, random, member, anchor);
        if (root) {
          if (member === 0) anchor = root;
          roots.push(root);
        }
      }
      if (roots.length < CAPACITIES[name] * 0.8)
        throw new Error(`猫咪 ${name} 区域的毛根表面不足。`);
      // Keep the six planted members together through LOD. Per-fibre shuffle
      // left isolated needles when a distant view retained only 20% of a patch.
      for (let first = 0; first < roots.length; first += representativeGroupSize) {
        const last = Math.min(roots.length, first + representativeGroupSize);
        let u = 0, v = 0, w = 0;
        for (let i = first; i < last; i++) {
          u += roots[i].u; v += roots[i].v; w += roots[i].w;
        }
        const count = last - first;
        for (let i = first; i < last; i++) {
          roots[i].patchU = u / count;
          roots[i].patchV = v / count;
          roots[i].patchW = w / count;
        }
      }
      const patchOrder = createCatGroomPatchOrder(roots, representativeGroupSize,
        randomGenerator({ head: 0x17a3, ruff: 0x26b5, body: 0x39c7 }[name]));
      const orderedRoots = Array.from(patchOrder, (originalIndex) => {
        const root = roots[originalIndex];
        return { ...root, flow: { ...root.flow }, gather: { ...root.gather } };
      });
      const groomCurve = new Float32Array(
        orderedRoots.length * CAT_GROOM_CURVE_STRIDE,
      );
      const longGroomCurve = new Float32Array(groomCurve.length);
      const longStyle = new Float32Array(orderedRoots.length * 2);
      const basePoint: V3 = [0, 0, 0],
        baseNormal: V3 = [0, 0, 0],
        baseFlow: V3 = [0, 0, 0];
      const ab: V3 = [0, 0, 0],
        ac: V3 = [0, 0, 0];
      for (let i = 0; i < orderedRoots.length; i++) {
        const root = orderedRoots[i],
          { a, b, c, u, v, w } = root;
        for (let axis = 0; axis < 3; axis++) {
          basePoint[axis] =
            evaluated[a * 3 + axis] * u +
            evaluated[b * 3 + axis] * v +
            evaluated[c * 3 + axis] * w;
          baseNormal[axis] =
            normals[a * 3 + axis] * u +
            normals[b * 3 + axis] * v +
            normals[c * 3 + axis] * w;
          ab[axis] = evaluated[b * 3 + axis] - evaluated[a * 3 + axis];
          ac[axis] = evaluated[c * 3 + axis] - evaluated[a * 3 + axis];
        }
        const normalLength = Math.hypot(...baseNormal) || 1;
        for (let axis = 0; axis < 3; axis++) baseNormal[axis] /= normalLength;
        transportSurfaceVector(root.flow, ab, ac, baseNormal, baseFlow);
        const anatomy = {
          head:
            membership.head[a] * u +
            membership.head[b] * v +
            membership.head[c] * w,
          limb:
            membership.limb[a] * u +
            membership.limb[b] * v +
            membership.limb[c] * w,
          tail:
            membership.tail[a] * u +
            membership.tail[b] * v +
            membership.tail[c] * w,
        };
        groomGuides.write(
          basePoint,
          baseNormal,
          baseFlow,
          anatomy,
          root.hairKind,
          root.phase,
          groomCurve,
          i * CAT_GROOM_CURVE_STRIDE,
        );
        const localStyle = groomGuides.write(
          basePoint,
          baseNormal,
          baseFlow,
          anatomy,
          root.hairKind,
          root.phase,
          longGroomCurve,
          i * CAT_GROOM_CURVE_STRIDE,
          "long",
          name,
        );
        longStyle[i * 2] = localStyle[0];
        longStyle[i * 2 + 1] = localStyle[1];
      }
      const region = createRegion(
        name,
        orderedRoots,
        groomCurve,
        longGroomCurve,
        longStyle,
      );
      region.mesh.userData.canonicalGroom = {
        representation:
          "surface-projected authored guides with root-relative five-point curves",
        guides: groomGuides.guides.map((guide) => ({
          name: guide.name,
          root: guide.root,
          normal: guide.normal,
          comb: guide.comb,
          uv: guide.uv,
          surfaceVertex: guide.surfaceVertex,
          knots: guide.curve,
          longKnots: guide.longCurve,
          longOnly: guide.longOnly,
          outerCoatOnly: guide.outerCoatOnly,
          restrictRegion: guide.restrictRegion,
          longLengthScale: guide.longLengthScale,
          longWidthScale: guide.longWidthScale,
        })),
      };
      region.mesh.userData.follicularPlanting = {
        representation: "surface-bound compound-follicle patches",
        representativeGroupSize,
        previewOrder: "whole-patches-retained",
        clumpTarget: "shared-surface-barycentric-patch-centre",
        note: "Representative render fibres, not a measured cat follicle map or physical shaft count",
      };
      regions.push(region);
      // Preparing a full groom yields between regions so loading feedback paints.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  } catch (error) {
    for (const region of regions) {
      region.mesh.geometry.dispose();
      region.mesh.material.dispose();
    }
    details.dispose();
    throw error;
  }

  const volumeReferencePositions = evaluated.slice();
  const volumeReferenceNormals = normals.slice();
  // A close, filled undercoat sits beneath the long guard hairs. Without this
  // layer, isolated subpixel guards leave a see-through, peppered silhouette.
  // It follows the posed skin and original UVs; it does not replace the visible
  // geometric fibres or inflate the face, feet, eyes or nose.
  const undercoatGeometry = new THREE.BufferGeometry();
  undercoatGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(position.count * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  undercoatGeometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Float32Array(position.count * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  undercoatGeometry.setAttribute("uv", uv.clone());
  const undercoatTriangles: Record<"ruff" | "body", Triangle[]> = {
    ruff: [],
    body: [],
  };
  const undercoatWeights = {
    head: new Float32Array(position.count),
    ruff: new Float32Array(position.count),
    body: new Float32Array(position.count),
  };
  for (const name of ["head", "ruff", "body"] as const)
    for (const triangle of pools[name]) {
      for (const vertex of [triangle.a, triangle.b, triangle.c])
        undercoatWeights[name][vertex] += triangle.area;
      if (name === "head") continue;
      const middleY =
        (evaluated[triangle.a * 3 + 1] +
          evaluated[triangle.b * 3 + 1] +
          evaluated[triangle.c * 3 + 1]) /
        3;
      if (middleY > allBounds.min.y + bodyHeight * 0.14)
        undercoatTriangles[name].push(triangle);
    }
  for (let vertex = 0; vertex < position.count; vertex++) {
    const total =
      undercoatWeights.head[vertex] +
        undercoatWeights.ruff[vertex] +
        undercoatWeights.body[vertex] || 1;
    undercoatWeights.ruff[vertex] /= total;
    undercoatWeights.body[vertex] /= total;
  }
  undercoatGeometry.setIndex(
    new THREE.BufferAttribute(
      new Uint32Array(
        (undercoatTriangles.ruff.length + undercoatTriangles.body.length) * 3,
      ),
      1,
    ),
  );
  const undercoatNeighbours: number[][] = Array.from(
    { length: position.count },
    () => [],
  );
  for (const name of ["ruff", "body"] as const)
    for (const { a, b, c } of undercoatTriangles[name]) {
      undercoatNeighbours[a].push(b, c);
      undercoatNeighbours[b].push(a, c);
      undercoatNeighbours[c].push(a, b);
    }
  const originalMaterial = (
    Array.isArray(surface.material) ? surface.material[0] : surface.material
  ) as THREE.MeshStandardMaterial;
  const undercoatMaterial = originalMaterial.clone();
  undercoatMaterial.name = "LongCoat_Undercoat";
  undercoatMaterial.roughness = 0.94;
  undercoatMaterial.normalScale.multiplyScalar(0.35);
  const undercoat = new THREE.Mesh(undercoatGeometry, undercoatMaterial);
  undercoat.name = "Coat_Undercoat";
  undercoat.castShadow = false;
  undercoat.receiveShadow = true;
  undercoat.raycast = () => {};
  undercoat.userData = {
    norwegianFur: true,
    undercoat: true,
    coatType: "long",
    volumeRegions: ["ruff", "body"],
    exportPose: "static-current-groom",
  };
  undercoatGeometry.setDrawRange(0, 0);
  let undercoatSignature = "";
  let volumeEnabled = false;
  let volume: ReturnType<typeof createCatFurVolume> | undefined;
  let volumeSignature = "";
  let volumeDirections: Float32Array | undefined;
  let volumeBindings: (
    { a: number; b: number; c: number; flow: FurSurfaceBinding } | undefined
  )[] = [];

  function ensureVolume() {
    if (volume) return;
    const skinIndex = indices
      ? Uint32Array.from({ length: indices.count }, (_, i) => indices.getX(i))
      : Uint32Array.from({ length: position.count }, (_, i) => i);
    const incident = new Int32Array(position.count).fill(-1);
    for (let i = 0; i < skinIndex.length; i += 3)
      for (let k = 0; k < 3; k++)
        if (incident[skinIndex[i + k]] < 0) incident[skinIndex[i + k]] = i;
    const masks = {
      body: new Float32Array(position.count),
      ruff: new Float32Array(position.count),
    };
    volumeDirections = new Float32Array(position.count * 3);
    volumeBindings = new Array(position.count);
    const p: V3 = [0, 0, 0],
      n: V3 = [0, 0, 0],
      ab: V3 = [0, 0, 0],
      ac: V3 = [0, 0, 0];
    for (let v = 0; v < position.count; v++) {
      const appendage = clamp(
        (Math.max(membership.head[v], membership.limb[v], membership.tail[v]) -
          0.05) /
          0.4,
        0,
        1,
      );
      const trunk = 1 - appendage * appendage * (3 - 2 * appendage);
      masks.body[v] = undercoatWeights.body[v] * trunk;
      masks.ruff[v] = undercoatWeights.ruff[v] * trunk;
      if (incident[v] < 0 || masks.body[v] + masks.ruff[v] < 0.001) continue;
      for (let axis = 0; axis < 3; axis++) {
        p[axis] = volumeReferencePositions[v * 3 + axis];
        n[axis] = volumeReferenceNormals[v * 3 + axis];
      }
      const flow = flowField.sample(p, n, {
        head: membership.head[v],
        limb: membership.limb[v],
        tail: membership.tail[v],
      });
      const t = incident[v],
        a = skinIndex[t],
        b = skinIndex[t + 1],
        c = skinIndex[t + 2];
      for (let axis = 0; axis < 3; axis++) {
        ab[axis] =
          volumeReferencePositions[b * 3 + axis] -
          volumeReferencePositions[a * 3 + axis];
        ac[axis] =
          volumeReferencePositions[c * 3 + axis] -
          volumeReferencePositions[a * 3 + axis];
        volumeDirections[v * 3 + axis] = flow.tangent[axis];
      }
      volumeBindings[v] = {
        a,
        b,
        c,
        flow: bindSurfaceVector(flow.tangent, ab, ac),
      };
    }
    const groom = getCatCoatProfile("long").groom;
    const fields = buildCatFurVolumeFields({
      vertexCount: position.count,
      normals: volumeReferenceNormals,
      regions: regions
        .filter(
          (r): r is Region & { name: "body" | "ruff" } => r.name !== "head",
        )
        .map((r) => ({
          name: r.name,
          roots: r.roots,
          curve: r.longGroomCurve,
        })),
      samples: LONG_SAMPLES,
      masks,
      neighbours: undercoatNeighbours,
      seamGroups,
      tangentGain: groom.tangent + 0.1,
      gravity: groom.gravity,
      flyawayShare: groom.flyawayShare,
    });
    volume = createCatFurVolume({
      positions: volumeReferencePositions,
      normals: volumeReferenceNormals,
      uv: uv as THREE.BufferAttribute,
      index: skinIndex,
      regionWeights: masks,
      directions: volumeDirections,
      envelope: fields.envelope,
      sweep: fields.sweep,
      baseMaterial: originalMaterial,
      layerCount: 16,
    });
    for (const mesh of volume.meshes) {
      mesh.userData.groomFieldObservations = fields.counts;
      mesh.userData.groomEnvelopeStatistic =
        "reference-down-barycentric-weighted-p80-with-local-smoothing";
    }
    resource.meshes.push(...volume.meshes);
    scene.add(...volume.meshes);
  }

  function updateVolume(
    design: FurDesign,
    coat: CatCoatType,
    groom: CoatGroom,
  ) {
    if (!volume || !volumeDirections) return;
    const next = `${signature}|${coat}|${design.coatMode}|${design.shape.bodyFurLength}|${design.shape.ruffFurLength}|${design.shape.bodyFurDensity}|${design.shape.ruffFurDensity}|${volumeEnabled}|${detailLevel < 0.4 ? 8 : detailLevel > 0.6 ? 16 : "hold"}`;
    if (next === volumeSignature) return;
    volumeSignature = next;
    const n: V3 = [0, 0, 0],
      ab: V3 = [0, 0, 0],
      ac: V3 = [0, 0, 0],
      flow: V3 = [0, 0, 0];
    for (let v = 0; v < volumeBindings.length; v++) {
      const binding = volumeBindings[v];
      if (!binding) continue;
      for (let axis = 0; axis < 3; axis++) {
        n[axis] = normals[v * 3 + axis];
        ab[axis] =
          evaluated[binding.b * 3 + axis] - evaluated[binding.a * 3 + axis];
        ac[axis] =
          evaluated[binding.c * 3 + axis] - evaluated[binding.a * 3 + axis];
      }
      transportSurfaceVector(binding.flow, ab, ac, n, flow);
      volumeDirections.set(flow, v * 3);
    }
    const lengths = { body: 0, ruff: 0 },
      densities = { body: 0, ruff: 0 };
    for (const name of ["body", "ruff"] as const) {
      const amount =
        clamp(
          design.shape[`${name}FurLength`] ?? DEFAULT_LENGTHS[name],
          0,
          100,
        ) / 100;
      const range = groom.lengths[name];
      lengths[name] =
        range.min + amount ** range.exponent * (range.max - range.min);
      densities[name] =
        clamp(design.shape[`${name}FurDensity`] ?? 75, 0, 100) / 100;
    }
    volume.update({
      positions: evaluated,
      normals,
      directions: volumeDirections,
      lengths,
      densities,
      coatType: coat,
      detail: detailLevel,
      enabledRegions: {
        body: volumeEnabled && design.coatMode === "groom",
        ruff: false,
      },
    });
  }

  function updateUndercoat(
    design: FurDesign,
    coat: CatCoatType,
    groom: CoatGroom,
    legacyExport = false,
  ) {
    const active = coat === "long" && design.coatMode === "groom";
    const density = {
      ruff: clamp(design.shape.ruffFurDensity ?? 75, 0, 100) / 100,
      body: clamp(design.shape.bodyFurDensity ?? 75, 0, 100) / 100,
    };
    const hybridBody = volumeEnabled && !legacyExport;
    const nextSignature = `${signature}|${coat}|${design.coatMode}|${design.shape.ruffFurLength}|${design.shape.bodyFurLength}|${density.ruff}|${density.body}|${hybridBody}`;
    if (nextSignature === undercoatSignature) return;
    undercoatSignature = nextSignature;
    if (!active || density.ruff + density.body === 0) {
      undercoatGeometry.setDrawRange(0, 0);
      return;
    }
    const loft = { ruff: 0, body: 0 };
    for (const name of ["ruff", "body"] as const) {
      const range = groom.lengths[name],
        amount =
          clamp(
            design.shape[`${name}FurLength`] ?? DEFAULT_LENGTHS[name],
            0,
            100,
          ) / 100;
      const length =
        range.min + Math.pow(amount, range.exponent) * (range.max - range.min);
      loft[name] =
        length *
        (groom.undercoatLength[0] + groom.undercoatLength[1]) *
        0.5 *
        groom.lift[0] *
        0.72 *
        Math.pow(density[name], 1.15);
    }
    const output = undercoatGeometry.attributes.position.array as Float32Array;
    const outputNormals = undercoatGeometry.attributes.normal
      .array as Float32Array;
    const outputIndices = undercoatGeometry.index!.array as Uint32Array;
    const edges = new Map<string, { a: number; b: number; count: number }>();
    let count = 0;
    for (const name of ["ruff", "body"] as const)
      if (density[name] > 0)
        for (const triangle of undercoatTriangles[name]) {
          outputIndices[count++] = triangle.a;
          outputIndices[count++] = triangle.b;
          outputIndices[count++] = triangle.c;
          for (const [a, b] of [
            [triangle.a, triangle.b],
            [triangle.b, triangle.c],
            [triangle.c, triangle.a],
          ]) {
            const key = a < b ? `${a},${b}` : `${b},${a}`,
              edge = edges.get(key);
            if (edge) edge.count++;
            else edges.set(key, { a, b, count: 1 });
          }
        }
    // Close every open boundary back onto the source skin. Several transition
    // rings prevent a raised polygon wall at the neck or a partly hidden region.
    const rings = new Uint8Array(position.count).fill(6),
      queue: number[] = [];
    for (const edge of edges.values())
      if (edge.count === 1)
        for (const vertex of [edge.a, edge.b]) {
          if (rings[vertex] !== 0) {
            rings[vertex] = 0;
            queue.push(vertex);
          }
        }
    for (let i = 0; i < queue.length; i++) {
      const vertex = queue[i],
        next = rings[vertex] + 1;
      if (next > 5) continue;
      for (const neighbour of undercoatNeighbours[vertex])
        if (rings[neighbour] > next) {
          rings[neighbour] = next;
          queue.push(neighbour);
        }
    }
    for (let vertex = 0; vertex < position.count; vertex++) {
      const offset = vertex * 3,
        py = evaluated[offset + 1];
      const leg = membership.limb[vertex],
        tail = membership.tail[vertex];
      const foot = clamp(
        (py - allBounds.min.y - bodyHeight * 0.14) / (bodyHeight * 0.14),
        0,
        1,
      );
      const anatomy =
        (1 - 0.72 * leg) * (1 + 0.28 * tail) * foot * foot * (3 - 2 * foot);
      const boundaryT = Math.min(1, rings[vertex] / 5),
        boundary = boundaryT * boundaryT * (3 - 2 * boundaryT);
      const appendage = clamp(
        (Math.max(membership.head[vertex], leg, tail) - 0.05) / 0.4,
        0,
        1,
      );
      const retainedBody = hybridBody
        ? appendage * appendage * (3 - 2 * appendage)
        : 1;
      const distance =
        0.00025 +
        (undercoatWeights.ruff[vertex] * loft.ruff +
          undercoatWeights.body[vertex] * loft.body * retainedBody) *
          anatomy *
          boundary;
      for (let axis = 0; axis < 3; axis++) {
        output[offset + axis] =
          evaluated[offset + axis] + normals[offset + axis] * distance;
        if (axis === 1)
          output[offset + axis] = Math.max(
            allBounds.min.y + 0.004,
            output[offset + axis],
          );
        outputNormals[offset + axis] = normals[offset + axis];
      }
    }
    undercoatGeometry.index!.needsUpdate = true;
    undercoatGeometry.attributes.position.needsUpdate = true;
    undercoatGeometry.attributes.normal.needsUpdate = true;
    undercoatGeometry.setDrawRange(0, count);
    undercoatGeometry.computeBoundingBox();
    undercoatGeometry.computeBoundingSphere();
    undercoat.userData.density = density;
    undercoat.userData.loft = loft;
  }

  function surfaceSignature() {
    scene.updateMatrixWorld(true);
    // Use the model's relative frame. Global breathing/turning moves the skin
    // and groom together and does not require rebuilding a million vertices.
    inverse.copy(scene.matrixWorld).invert();
    matrix.multiplyMatrices(inverse, surface.matrixWorld);
    const stable = (values: ArrayLike<number>) =>
      Array.from(values, (n) => Math.round(n * 1e6)).join(",");
    const bones: string[] = [];
    if (surface instanceof THREE.SkinnedMesh)
      for (const bone of surface.skeleton.bones) {
        const relative = new THREE.Matrix4().multiplyMatrices(
          inverse,
          bone.matrixWorld,
        );
        bones.push(stable(relative.elements));
      }
    return `${stable(surface.morphTargetInfluences ?? [])}|${stable(matrix.elements)}|${bones.join(";")}`;
  }

  function regionChanged(region: Region) {
    return region.roots.some(
      (root) =>
        dirtyVertices[root.a] || dirtyVertices[root.b] || dirtyVertices[root.c],
    );
  }

  function regenerate(
    region: Region,
    lengthControl: number,
    coat: CatCoatType,
    groom: CoatGroom,
    limit = region.roots.length,
  ) {
    const longCoat = coat === "long";
    const strandSegments = longCoat ? 8 : 4;
    if (region.strandSegments !== strandSegments) {
      const previous = region.mesh.geometry;
      region.mesh.geometry = createFurGeometry(region.roots, strandSegments);
      region.strandSegments = strandSegments;
      region.strandVertices = (strandSegments + 1) * 2;
      region.strandIndices = strandSegments * 12;
      region.samples = longCoat ? LONG_SAMPLES : SHORT_SAMPLES;
      Object.assign(region.mesh.userData, {
        strandSegments,
        strandVertices: region.strandVertices,
        strandIndices: region.strandIndices,
        tipPair: [strandSegments * 2, strandSegments * 2 + 1],
        curveInterpolation: "C1-canonical-guide-Hermite",
      });
      // The same surface roots/material survive the coat switch; only the
      // tessellation buffers are replaced and their GPU allocation released.
      previous.dispose();
    }
    const geometry = region.mesh.geometry;
    const positions = geometry.attributes.position.array as Float32Array;
    const outputNormals = geometry.attributes.normal.array as Float32Array;
    const outputWidths = geometry.attributes.furWidth.array as Float32Array;
    const outputFilterAxis = geometry.attributes.furFilterAxis
      .array as Int8Array;
    const outputTangents = geometry.attributes.furTangent.array as Int16Array;
    const authoredCurve = longCoat ? region.longGroomCurve : region.groomCurve;
    const amount = lengthControl / 100;
    const range = groom.lengths[region.name];
    const baseLength =
      range.min + Math.pow(amount, range.exponent) * (range.max - range.min);
    // Every styling decision was made in the neutral surface frame. Motion
    // only transports these cached guide vectors; it never changes a clump's
    // neighbours when a shoulder bends or a leg contacts the chest.
    const ab: V3 = [0, 0, 0],
      ac: V3 = [0, 0, 0],
      normal: V3 = [0, 0, 0];
    const flow: V3 = [0, 0, 0],
      gather: V3 = [0, 0, 0];
    for (
      let strand = 0;
      strand < Math.min(limit, region.roots.length);
      strand++
    ) {
      const root = region.roots[strand],
        { a, b, c, u, v, w } = root;
      let filterFallback = false;
      const px =
        evaluated[a * 3] * u + evaluated[b * 3] * v + evaluated[c * 3] * w;
      const py =
        evaluated[a * 3 + 1] * u +
        evaluated[b * 3 + 1] * v +
        evaluated[c * 3 + 1] * w;
      const pz =
        evaluated[a * 3 + 2] * u +
        evaluated[b * 3 + 2] * v +
        evaluated[c * 3 + 2] * w;
      let nx = normals[a * 3] * u + normals[b * 3] * v + normals[c * 3] * w;
      let ny =
        normals[a * 3 + 1] * u +
        normals[b * 3 + 1] * v +
        normals[c * 3 + 1] * w;
      let nz =
        normals[a * 3 + 2] * u +
        normals[b * 3 + 2] * v +
        normals[c * 3 + 2] * w;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      ab[0] = evaluated[b * 3] - evaluated[a * 3];
      ab[1] = evaluated[b * 3 + 1] - evaluated[a * 3 + 1];
      ab[2] = evaluated[b * 3 + 2] - evaluated[a * 3 + 2];
      ac[0] = evaluated[c * 3] - evaluated[a * 3];
      ac[1] = evaluated[c * 3 + 1] - evaluated[a * 3 + 1];
      ac[2] = evaluated[c * 3 + 2] - evaluated[a * 3 + 2];
      normal[0] = nx;
      normal[1] = ny;
      normal[2] = nz;
      transportSurfaceVector(root.flow, ab, ac, normal, flow);
      transportSurfaceVector(root.gather, ab, ac, normal, gather);
      let tx = flow[0],
        ty = flow[1],
        tz = flow[2];
      if (Math.hypot(tx, ty, tz) < 0.01) {
        // A degenerate source triangle has no usable transport derivative.
        tx = nz;
        ty = 0;
        tz = -nx;
        if (Math.abs(ny) > 0.99) {
          tx = ny;
          ty = -nx;
          tz = 0;
        }
        const fallback = Math.hypot(tx, ty, tz) || 1;
        tx /= fallback;
        ty /= fallback;
        tz /= fallback;
      }
      let sx = ny * tz - nz * ty,
        sy = nz * tx - nx * tz,
        sz = nx * ty - ny * tx;
      const individual = Math.sin(root.roll * 11.73 + root.variation * 5.1);
      const flowNoise =
        (root.curl * 0.88 + individual * 0.12) * groom.flowSpread;
      tx += sx * flowNoise;
      ty += sy * flowNoise;
      tz += sz * flowNoise;
      const variedLength = Math.hypot(tx, ty, tz) || 1;
      tx /= variedLength;
      ty /= variedLength;
      tz /= variedLength;
      sx = ny * tz - nz * ty;
      sy = nz * tx - nx * tz;
      sz = nx * ty - ny * tx;
      const cr = Math.cos(root.roll),
        sr = Math.sin(root.roll);
      const wx = sx * cr + nx * sr,
        wy = sy * cr + ny * sr,
        wz = sz * cr + nz * sr;
      const undercoat = root.hairKind === "down";
      const awn = root.hairKind === "awn";
      const anatomyLength =
        root.kind === 2
          ? groom.tailFullness
          : root.kind === 1
            ? THREE.MathUtils.lerp(0.45, groom.breeches, root.breeches)
            : 1;
      const rawLength =
        baseLength *
        (coat === "long" ? root.longLength : root.shortLength) *
        THREE.MathUtils.lerp(
          root.flowLength,
          root.guardLength,
          coat === "long" && !undercoat ? root.bodyStyling : 0,
        ) *
        anatomyLength *
        (longCoat && region.name === "ruff" && undercoat ? 0.9 : 1) *
        (longCoat && region.name === "ruff" && !undercoat
          ? region.longStyle[strand * 2]
          : 1) *
        (0.84 + root.variation * 0.17) *
        (root.layer > 1 - groom.flyawayShare ? 1.12 : 1);
      const length =
        root.breeches > 0.1
          ? Math.min(rawLength, Math.max(0.003, py - 0.035) / 1.3)
          : rawLength;
      const width =
        groom.width[region.name] *
        root.hairWidth *
        (longCoat ? (undercoat ? 1 : awn ? 0.9 : 0.7) : 1) *
        (longCoat && region.name === "ruff" && !undercoat
          ? region.longStyle[strand * 2 + 1]
          : 1) *
        (0.85 + root.variation * 0.15) *
        (volumeEnabled && longCoat && region.name === "body" && root.kind === 0
          ? 1 - root.trunkWeight * (1 - (undercoat ? 0.3 : awn ? 0.35 : 0.3))
          : 1);
      // Undercoat remains close and weakly grouped; guard hairs approach a
      // shared curved guide at the same arc parameter, never its root alone.
      const bundle = Math.min(0.52, groom.clump * (undercoat ? 0.16 : awn ? 0.55 : 1))
        * (region.name === "head" ? 0.55 : 1);
      // Pull towards one shared patch guide, rather than translating every
      // neighbour in almost the same direction. The smooth t^2(3-2t) below
      // keeps every original root fixed and transports its derivative too.
      const pu = root.patchU - u, pv = root.patchV - v, pw = root.patchW - w;
      const patchX = evaluated[a * 3] * pu + evaluated[b * 3] * pv + evaluated[c * 3] * pw;
      const patchY = evaluated[a * 3 + 1] * pu + evaluated[b * 3 + 1] * pv + evaluated[c * 3 + 1] * pw;
      const patchZ = evaluated[a * 3 + 2] * pu + evaluated[b * 3 + 2] * pv + evaluated[c * 3 + 2] * pw;
      const inward = patchX * nx + patchY * ny + patchZ * nz;
      const groupX = patchX - nx * inward + gather[0] * 0.2;
      const groupY = patchY - ny * inward + gather[1] * 0.2;
      const groupZ = patchZ - nz * inward + gather[2] * 0.2;
      const gatherLength = Math.hypot(groupX, groupY, groupZ);
      const gatherScale = Math.min(
        1,
        (length * 0.72) / Math.max(gatherLength, 1e-8),
      );
      const dx = groupX * gatherScale,
        dy = groupY * gatherScale,
        dz = groupZ * gatherScale;
      const curveOffset = strand * CAT_GROOM_CURVE_STRIDE;
      const forwardGain = groom.tangent + 0.1;
      // Long primary hairs lie over the supporting down's crown, instead of
      // arching into a separate sparse wire canopy. Their rearward sweep and
      // length remain unchanged; limbs, short fur and all down keep their form.
      const outerLay =
        longCoat && region.name === "body" && root.kind !== 1 && !undercoat
          ? awn
            ? 0.82
            : 0.64
          : 1;
      // A relaxed back coat lies toward the flanks, rather than forming the
      // raised silhouette of piloerection. This is an authored 20% adjustment,
      // not an angle recovered from a paper. The neutral-skin field stays fixed
      // through standing/resting, and leaves face, limbs and tail independent.
      const backLay =
        longCoat && region.name === "body" ? 1 - 0.2 * root.backLay : 1;
      // Fill the space above the close opaque shell with several down depths,
      // instead of lifting almost every fine hair into one suspended canopy.
      // The upper class retains its original loft; T/B sweep, planted roots
      // and the existing back lay stay unchanged. The same gain below acts
      // on both the centreline's N coordinate and its analytical derivative.
      const downDepthGain =
        longCoat && region.name === "body" && root.kind === 0 && undercoat
          ? 1 -
            root.trunkWeight *
              (1 - (0.4 + 0.6 * root.downDepth * root.downDepth))
          : 1;
      // The old tail/breeches templates had both a high radial arc and extra
      // length, lifting the entire coat into a separate cage. Relax only the
      // long body loft, with a continuous neutral-skin boundary. Tangential
      // length, roots and fibre radii stay unchanged; use the same gain for
      // positions and analytic derivatives below, including during a pose.
      const appendageLay =
        longCoat && region.name === "body" ? root.appendageLay : 1;
      // Tail down previously shared a single raised crown: kind2 was excluded
      // from the torso's depth layers. Fill the space below that crown while
      // retaining its upper fibres, every root and the outer coat's sweep.
      // This neutral skin-weight blend is unchanged by standing/resting.
      const tailDepthBlend = longCoat && region.name === "body"
        ? THREE.MathUtils.smoothstep(root.tailWeight, 0.45, 0.9) : 0;
      const tailDownDepthGain = undercoat
        ? THREE.MathUtils.lerp(1, 0.45 + 0.55 * root.downDepth * root.downDepth,
          tailDepthBlend) : 1;
      const normalGain =
        root.hairLift * outerLay * backLay * downDepthGain * appendageLay * tailDownDepthGain;
      const phase = root.phase + individual * 0.12;
      const sinPhase = Math.sin(phase),
        cosPhase = Math.cos(phase);
      const waveAmplitude =
        length *
        (longCoat ? (undercoat ? 0.035 : 0.024) : 0.018) *
        root.hairCrimp;
      // Chest down supports the outer locks instead of sharing their full
      // hanging sag. Fade by neutral anatomy to protect the head/limb border.
      // This same per-root factor reaches position t^2 and derivative 2t.
      const ruffGravity = longCoat && region.name === "ruff"
        ? THREE.MathUtils.lerp(1, undercoat ? 0.20 : awn ? 0.35 : 0.40, root.trunkWeight)
        : 1;
      const gravity =
        length * groom.gravity * (region.name === "head" ? 0.28 : 1) * ruffGravity;
      // Preserve the guide's authored clearance on upward-facing skin. Raw
      // world-down sag previously overwhelmed the back curve's radial rise
      // and buried its tip in the torso. Tangential/outward sag still forms
      // the chest drape and underside fall; only inward normal sag is removed.
      const inwardGravity = Math.max(0, ny);
      const gravityX = nx * inwardGravity * gravity,
        gravityY = (-1 + ny * inwardGravity) * gravity,
        gravityZ = nz * inwardGravity * gravity;
      for (let sample = 0; sample <= region.strandSegments; sample++) {
        const {
          t,
          t2,
          sinPi,
          cosPi,
          sinBend,
          cosBend,
          sinCrimp,
          cosCrimp,
          taper,
          value,
          derivative,
        } = region.samples[sample];
        const fineDown = longCoat && undercoat;
        const waveSin = fineDown ? sinCrimp : sinBend,
          waveCos = fineDown ? cosCrimp : cosBend;
        const sinWave = sinPhase * waveCos + cosPhase * waveSin;
        const cosWave = cosPhase * waveCos - sinPhase * waveSin;
        let cn = 0,
          ct = 0,
          cb = 0,
          dn = 0,
          dt = 0,
          db = 0;
        for (let knot = 0; knot < 4; knot++) {
          const o = curveOffset + knot * 3,
            w = value[knot + 1],
            d = derivative[knot + 1];
          cn += authoredCurve[o] * w;
          ct += authoredCurve[o + 1] * w;
          cb += authoredCurve[o + 2] * w;
          dn += authoredCurve[o] * d;
          dt += authoredCurve[o + 1] * d;
          db += authoredCurve[o + 2] * d;
        }
        if (!longCoat) {
          // Close short fur follows the same authored comb, with a much
          // smaller radial arc. It is not the long coat merely scaled down.
          cn = 0.11 * t + 0.22 * cn;
          dn = 0.11 + 0.22 * dn;
          ct = t + 0.12 * (ct - t);
          dt = 1 + 0.12 * (dt - 1);
          cb *= 0.12;
          db *= 0.12;
        }
        const normalDistance = 0.00045 + length * cn * normalGain;
        const tangentDistance = length * ct * forwardGain;
        const sideDistance = length * cb;
        const gathering = bundle * t2 * (3 - 2 * t);
        const wave = waveAmplitude * sinPi * sinWave;
        const cx =
          px +
          nx * normalDistance +
          tx * tangentDistance +
          dx * gathering +
          sx * (sideDistance + wave) +
          gravityX * t2;
        const cy =
          py +
          ny * normalDistance +
          ty * tangentDistance +
          dy * gathering +
          sy * (sideDistance + wave) +
          gravityY * t2;
        const cz =
          pz +
          nz * normalDistance +
          tz * tangentDistance +
          dz * gathering +
          sz * (sideDistance + wave) +
          gravityZ * t2;
        // Both the shading normal and real transverse radius follow the
        // authored curve's local derivative, independent of camera direction.
        const nd = length * dn * normalGain;
        const td = length * dt * forwardGain;
        const sd = length * db;
        const cd = bundle * 6 * t * (1 - t);
        const wd =
          waveAmplitude *
          (Math.PI * cosPi * sinWave +
            (fineDown ? Math.PI * 2 : 2.4) * sinPi * cosWave);
        const vx =
          nx * nd + tx * td + dx * cd + sx * (sd + wd) + gravityX * 2 * t;
        const vy =
          ny * nd + ty * td + dy * cd + sy * (sd + wd) + gravityY * 2 * t;
        const vz =
          nz * nd + tz * td + dz * cd + sz * (sd + wd) + gravityZ * 2 * t;
        const vl2 = vx * vx + vy * vy + vz * vz || 1;
        const tangentScale = 32767 / Math.sqrt(vl2);
        const quantizedTX = Math.round(vx * tangentScale),
          quantizedTY = Math.round(vy * tangentScale),
          quantizedTZ = Math.round(vz * tangentScale);
        const projection = (nx * vx + ny * vy + nz * vz) / vl2;
        let fnx = nx - vx * projection,
          fny = ny - vy * projection,
          fnz = nz - vz * projection;
        const fnl = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz) || 1;
        fnx /= fnl;
        fny /= fnl;
        fnz /= fnl;
        const halfWidth = width * 0.5 * taper;
        const transverseDot = (wx * vx + wy * vy + wz * vz) / vl2;
        let hx = wx - vx * transverseDot,
          hy = wy - vy * transverseDot,
          hz = wz - vz * transverseDot;
        let hl = Math.hypot(hx, hy, hz);
        if (hl < 1e-8) {
          hx = ny * vz - nz * vy;
          hy = nz * vx - nx * vz;
          hz = nx * vy - ny * vx;
          hl = Math.hypot(hx, hy, hz) || 1;
        }
        hx *= halfWidth / hl;
        hy *= halfWidth / hl;
        hz *= halfWidth / hl;
        const floorY = allBounds.min.y + 0.002;
        const leftY = sample === 0 ? cy - hy : Math.max(floorY, cy - hy),
          rightY = sample === 0 ? cy + hy : Math.max(floorY, cy + hy);
        const clippedHalfY = (rightY - leftY) * 0.5;
        // The normal and physical transverse span recover a curve axis up to
        // sign. Retain the analytic direction in one signed byte so a rare
        // span-frame reversal cannot twist the screen-space sampling filter.
        const crossX = fny * hz - fnz * clippedHalfY,
          crossY = fnz * hx - fnx * hz,
          crossZ = fnx * clippedHalfY - fny * hx;
        const crossSquared =
          crossX * crossX + crossY * crossY + crossZ * crossZ;
        const relativeCrossSquared =
          crossSquared /
          Math.max(
            1e-60,
            (fnx * fnx + fny * fny + fnz * fnz) *
              (hx * hx + clippedHalfY * clippedHalfY + hz * hz),
          );
        const axisDirection = Math.sign(
          crossX * vx + crossY * vy + crossZ * vz,
        );
        if (
          relativeCrossSquared < 1e-8 ||
          axisDirection === 0 ||
          (sample > 0 && Math.min(leftY, rightY) <= floorY + 1e-6)
        )
          filterFallback = true;
        for (let side = 0; side < 2; side++) {
          const offset =
            (strand * region.strandVertices + sample * 2 + side) * 3;
          const sign = side === 0 ? -1 : 1;
          positions[offset] = cx + hx * sign;
          positions[offset + 1] = side === 0 ? leftY : rightY;
          positions[offset + 2] = cz + hz * sign;
          outputNormals[offset] = fnx;
          outputNormals[offset + 1] = fny;
          outputNormals[offset + 2] = fnz;
          outputTangents[offset] = quantizedTX;
          outputTangents[offset + 1] = quantizedTY;
          outputTangents[offset + 2] = quantizedTZ;
          outputWidths[offset] = hx;
          outputWidths[offset + 1] = clippedHalfY;
          outputWidths[offset + 2] = hz;
          outputFilterAxis[strand * region.strandVertices + sample * 2 + side] =
            axisDirection;
        }
      }
      if (filterFallback)
        outputFilterAxis.fill(
          0,
          strand * region.strandVertices,
          (strand + 1) * region.strandVertices,
        );
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
    geometry.attributes.furWidth.needsUpdate = true;
    geometry.attributes.furFilterAxis.needsUpdate = true;
    geometry.attributes.furTangent.needsUpdate = true;
    const positionAttribute = geometry.attributes
      .position as THREE.BufferAttribute;
    const normalAttribute = geometry.attributes.normal as THREE.BufferAttribute;
    positionAttribute.clearUpdateRanges();
    normalAttribute.clearUpdateRanges();
    const widthAttribute = geometry.attributes
      .furWidth as THREE.BufferAttribute;
    widthAttribute.clearUpdateRanges();
    const filterAxisAttribute = geometry.attributes
      .furFilterAxis as THREE.BufferAttribute;
    const tangentAttribute = geometry.attributes.furTangent as THREE.BufferAttribute;
    tangentAttribute.clearUpdateRanges();
    tangentAttribute.addUpdateRange(
      0, Math.min(limit, region.roots.length) * region.strandVertices * 3,
    );
    filterAxisAttribute.clearUpdateRanges();
    filterAxisAttribute.addUpdateRange(
      0,
      Math.min(limit, region.roots.length) * region.strandVertices,
    );
    widthAttribute.addUpdateRange(
      0,
      Math.min(limit, region.roots.length) * region.strandVertices * 3,
    );
    positionAttribute.addUpdateRange(
      0,
      Math.min(limit, region.roots.length) * region.strandVertices * 3,
    );
    normalAttribute.addUpdateRange(
      0,
      Math.min(limit, region.roots.length) * region.strandVertices * 3,
    );
    region.pendingFull = limit < region.roots.length;
    region.pendingMotion = false;
    // Groom meshes are not culled or raycast. A motion preview only uploads
    // the visible prefix; export/settling rebuilds the full bound surface.
    if (!region.pendingFull) {
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
    region.length = lengthControl;
    region.coat = coat;
    region.mesh.material.roughness = groom.roughness;
    configureCatFurMaterial(region.mesh.material, {
      coatType: coat,
      detailLevel,
    });
    region.mesh.userData.furLength = lengthControl;
    region.mesh.userData.coatType = coat;
    region.mesh.userData.flowField = "reference-anatomical-continuous-v1";
    region.mesh.userData.flowTransport = "triangle-derivatives-preserve-length";
    region.mesh.userData.guideStyling =
      "surface-projected-authored-five-point-curves";
    region.mesh.userData.lightingTangent = "normalized-int16-analytic-curve-derivative";
    region.mesh.userData.groomLayers =
      coat === "long"
        ? "down,awn,guard,ruff,breeches,tail-plume"
        : "close-down,short-awn,short-guard";
    region.mesh.userData.coatAnatomy =
      "cat-inspired-regional-compound-follicles-v1";
  }

  let disposed = false;
  let detailLevel = 1;
  let lastDesign: FurDesign | undefined;
  function applyPreviewCounts() {
    for (const region of regions) {
      const intended = Number(region.mesh.userData.strandCount ?? 0);
      const preview =
        intended > 0 ? Math.max(1, Math.floor(intended * detailLevel)) : 0;
      region.mesh.geometry.setDrawRange(0, preview * region.strandIndices);
      region.mesh.userData.previewStrands = preview;
      region.mesh.userData.detailLevel = detailLevel;
      configureCatFurMaterial(region.mesh.material, {
        coatType: region.coat ?? "short",
        detailLevel,
        volumeReplacement:
          volumeEnabled &&
          !!volume &&
          region.coat === "long" &&
          region.name === "body",
      });
    }
  }
  const resource: NorwegianFur = {
    preparedGroom: true,
    meshes: [
      ...regions.map((region) => region.mesh),
      undercoat,
      ...details.meshes,
    ],
    update(design) {
      if (disposed) return;
      lastDesign = {
        shape: { ...design.shape },
        coatType: design.coatType,
        coatMode: design.coatMode ?? "groom",
      };
      const nextSignature = surfaceSignature(),
        changedSurface = signature !== nextSignature;
      if (changedSurface) {
        evaluateSurface();
        signature = nextSignature;
      }
      const profile = getCatCoatProfile(design.coatType);
      for (const region of regions) {
        const densityValue = design.shape[`${region.name}FurDensity`];
        const lengthValue = design.shape[`${region.name}FurLength`];
        const density =
          design.coatMode === "groom"
            ? clamp(Number.isFinite(densityValue) ? densityValue : 75, 0, 100)
            : 0;
        const length = clamp(
          Number.isFinite(lengthValue)
            ? lengthValue
            : DEFAULT_LENGTHS[region.name],
          0,
          100,
        );
        if (
          density > 0 &&
          ((changedSurface && regionChanged(region)) ||
            region.length !== length ||
            region.coat !== profile.id ||
            region.pendingFull ||
            region.pendingMotion)
        )
          regenerate(region, length, profile.id, profile.groom);
        else if (changedSurface && density === 0) region.pendingFull = true;
        const count =
          profile.id === "hairless"
            ? 0
            : Math.floor((region.capacity * density) / 100);
        region.mesh.userData.strandCount = count;
        region.mesh.userData.furStrands = count;
        region.mesh.userData.furDensity = density;
        region.density = density;
      }
      updateUndercoat(design, profile.id, profile.groom);
      updateVolume(design, profile.id, profile.groom);
      details.update({
        density: design.coatMode === "groom" ? design.shape.headFurDensity : 0,
        length: design.shape.headFurLength,
        coat: profile.id,
      });
      applyPreviewCounts();
    },
    refresh(options = {}) {
      if (disposed || !lastDesign) return;
      const next = surfaceSignature();
      const changed = next !== signature;
      const allowedPending = regions.some(
        (region) =>
          region.pendingMotion && (!options.headOnly || region.name !== "body"),
      );
      if (!changed && !options.full && !allowedPending) return;
      if (changed) {
        evaluateSurface();
        signature = next;
      }
      const profile = getCatCoatProfile(lastDesign.coatType);
      for (const region of regions) {
        const count = Number(
          region.mesh.userData.strandCount ?? region.capacity,
        );
        if (count <= 0) {
          if (changed) region.pendingFull = true;
          region.pendingMotion = false;
          continue;
        }
        if (options.headOnly && region.name === "body" && !options.full) {
          if (changed && regionChanged(region)) region.pendingMotion = true;
          continue;
        }
        if (
          (changed && regionChanged(region)) ||
          region.pendingMotion ||
          (options.full && region.pendingFull)
        ) {
          const length =
            lastDesign.shape[`${region.name}FurLength`] ??
            DEFAULT_LENGTHS[region.name];
          regenerate(
            region,
            length,
            profile.id,
            profile.groom,
            options.full
              ? region.capacity
              : Math.max(1, Math.ceil(count * detailLevel)),
          );
        }
      }
      // Head-only ticks deliberately defer body breathing/pose work to its
      // slower refresh budget. pendingMotion survives the global pose stamp.
      updateUndercoat(lastDesign, profile.id, profile.groom);
      updateVolume(lastDesign, profile.id, profile.groom);
      details.update();
      applyPreviewCounts();
    },
    setDetail(level) {
      const next = clamp(Number.isFinite(level) ? level : 1, 0.18, 1);
      if (Math.abs(next - detailLevel) < 0.025) return;
      const expanding = next > detailLevel;
      detailLevel = next;
      if (expanding && lastDesign) {
        const profile = getCatCoatProfile(lastDesign.coatType);
        for (const region of regions)
          if (
            Number(region.mesh.userData.strandCount ?? 0) > 0 &&
            (region.pendingFull || region.pendingMotion)
          )
            regenerate(
              region,
              region.length,
              profile.id,
              profile.groom,
              next === 1
                ? region.capacity
                : Math.max(
                    1,
                    Math.ceil(
                      Number(region.mesh.userData.strandCount ?? 0) * next,
                    ),
                  ),
            );
      }
      if (lastDesign && volume)
        updateVolume(
          lastDesign,
          getCatCoatProfile(lastDesign.coatType).id,
          getCatCoatProfile(lastDesign.coatType).groom,
        );
      applyPreviewCounts();
    },
    setVolume(enabled) {
      if (disposed || enabled === volumeEnabled) return;
      if (enabled) ensureVolume();
      volumeEnabled = enabled;
      // The controlled prototype uses finer actual outer/surface fibres,
      // not an opacity multiplier hiding the previous broad geometry.
      const body = regions.find((region) => region.name === "body");
      if (body) body.length = -1;
      volumeSignature = "";
      if (lastDesign) resource.update(lastDesign);
    },
    volumeInfo() {
      return volume?.getInfo() ?? [];
    },
    setVolumeDensity(texture, scale = 1, uvTransform) {
      if (disposed) return;
      if (texture) ensureVolume();
      volume?.setDensityTextureForRegion("body", texture, scale, uvTransform);
    },
    setVolumeGeometry(scales) {
      if (disposed) return;
      ensureVolume();
      volume?.setGeometryScales(scales);
      volumeSignature = "";
    },
    snapshotMeshes() {
      // Export reproduces the current pose at full authored/user density,
      // even after a reduced-detail animated preview.
      resource.refresh({ full: true });
      const snapshots: THREE.Mesh[] = regions
        .filter((region) => Number(region.mesh.userData.strandCount) > 0)
        .map((region) => {
          const source = region.mesh.geometry,
            count = Number(region.mesh.userData.strandCount);
          const geometry = new THREE.BufferGeometry();
          for (const name of ["position", "normal", "color", "uv"]) {
            const attribute = source.getAttribute(
              name,
            ) as THREE.BufferAttribute;
            geometry.setAttribute(
              name,
              new THREE.BufferAttribute(
                attribute.array.slice(
                  0,
                  count * region.strandVertices * attribute.itemSize,
                ),
                attribute.itemSize,
                attribute.normalized,
              ),
            );
          }
          geometry.setIndex(
            new THREE.BufferAttribute(
              source.index!.array.slice(0, count * region.strandIndices),
              1,
            ),
          );
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
          const mesh = new THREE.Mesh(
            geometry,
            createCatFurExportMaterial(region.mesh.material),
          );
          mesh.name = region.mesh.name;
          mesh.userData = structuredClone(region.mesh.userData);
          mesh.userData.ownedFurExportMaterial = true;
          mesh.visible = true;
          return mesh;
        });
      if (undercoatGeometry.drawRange.count > 0) {
        const restore = volumeEnabled && lastDesign;
        if (restore)
          updateUndercoat(
            restore,
            getCatCoatProfile(restore.coatType).id,
            getCatCoatProfile(restore.coatType).groom,
            true,
          );
        try {
          const geometry = undercoatGeometry.clone();
          geometry.setIndex(
            new THREE.BufferAttribute(
              undercoatGeometry.index!.array.slice(
                0,
                undercoatGeometry.drawRange.count,
              ),
              1,
            ),
          );
          geometry.setDrawRange(0, geometry.index!.count);
          const mesh = new THREE.Mesh(geometry, undercoatMaterial);
          mesh.name = undercoat.name;
          mesh.userData = structuredClone(undercoat.userData);
          snapshots.push(mesh);
        } finally {
          if (restore)
            updateUndercoat(
              restore,
              getCatCoatProfile(restore.coatType).id,
              getCatCoatProfile(restore.coatType).groom,
            );
        }
      }
      snapshots.push(...details.snapshotMeshes());
      return snapshots;
    },
    stats() {
      return Object.fromEntries(
        regions.map((region) => [
          region.name,
          {
            strands: Number(region.mesh.userData.strandCount ?? 0),
            capacity: region.capacity,
            length: region.length,
            previewStrands: Number(region.mesh.userData.previewStrands ?? 0),
            detailLevel,
            strandSegments: region.strandSegments,
            strandVertices: region.strandVertices,
            strandIndices: region.strandIndices,
          },
        ]),
      ) as Record<FurRegion, RegionStats>;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const region of regions) {
        region.mesh.removeFromParent();
        region.mesh.geometry.dispose();
        region.mesh.material.dispose();
      }
      undercoat.removeFromParent();
      undercoatGeometry.dispose();
      undercoatMaterial.dispose();
      details.dispose();
      volume?.dispose();
    },
  };
  return resource;
}
