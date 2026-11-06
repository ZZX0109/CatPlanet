import * as THREE from "three";

export const faceControls = [
  {
    key: "faceWidth",
    label: "脸部宽度",
    low: "窄",
    high: "宽",
    description: "调整额头与脸部宽度，保留颈部和身体。",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "cheeks",
    label: "脸颊饱满度",
    low: "清瘦",
    high: "饱满",
    description: "温和调整两侧脸颊的饱满程度。",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "muzzleLength",
    label: "口鼻长度",
    low: "短",
    high: "长",
    description: "沿这只猫真实的面部朝向调整口鼻。",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "eyeSize",
    label: "眼睛大小",
    low: "小",
    high: "大",
    description: "调整眼睛周围的曲面，现有眼部贴图随曲面变化。",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "eyeSpacing",
    label: "眼睛间距",
    low: "近",
    high: "远",
    description: "让左右眼区向内或向外温和移动。",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "earSize",
    label: "耳朵大小",
    low: "小",
    high: "大",
    description: "以耳根为支点调整耳朵，平滑保留连接。",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "earSpacing",
    label: "耳朵间距",
    low: "近",
    high: "远",
    description: "小幅调整耳朵间距，保持耳根连续。",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "noseWidth",
    label: "鼻子宽度",
    low: "窄",
    high: "宽",
    description: "调整鼻头宽度，保持口鼻与下巴衔接。",
    min: 0,
    max: 100,
    step: 1,
  },
] as const;

export type FaceKey = (typeof faceControls)[number]["key"];
export type FaceDesign = {
  schemaVersion: 1;
  templateId: "cc0-tabby-v1";
  shape: Record<FaceKey, number>;
};

export const defaultFaceDesign: FaceDesign = {
  schemaVersion: 1,
  templateId: "cc0-tabby-v1",
  shape: Object.fromEntries(
    faceControls.map(({ key }) => [key, 50]),
  ) as FaceDesign["shape"],
};

const keys = new Set<string>(faceControls.map(({ key }) => key));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Return a fresh, strictly validated design; importing never mutates its input. */
export function parseFaceDesign(input: unknown): FaceDesign {
  if (
    !isRecord(input) ||
    input.schemaVersion !== 1 ||
    input.templateId !== "cc0-tabby-v1" ||
    Object.keys(input).some(
      (key) => !["schemaVersion", "templateId", "shape"].includes(key),
    ) ||
    !isRecord(input.shape) ||
    Object.keys(input.shape).some((key) => !keys.has(key)) ||
    Object.keys(input.shape).length !== faceControls.length
  ) {
    throw new Error("这不是受支持的虎斑猫捏脸文件。");
  }
  const shape = {} as FaceDesign["shape"];
  for (const { key } of faceControls) {
    const value = input.shape[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    ) {
      throw new Error("捏脸参数需要是 0 到 100 之间的数字。");
    }
    shape[key] = value;
  }
  return { schemaVersion: 1, templateId: "cc0-tabby-v1", shape };
}

/** Landmarks measured from this template's textured surface, in scene coordinates. */
export const tabbyFaceLandmarks = {
  origin: [-0.278, 1.071, 0.557],
  lateral: [0.956, 0, -0.293],
  leftEye: [-0.349, 1.071, 0.578],
  rightEye: [-0.207, 1.074, 0.535],
  nose: [-0.2753, 0.976, 0.6117],
} as const;

const origin = new THREE.Vector3(...tabbyFaceLandmarks.origin);
const lateral = new THREE.Vector3(...tabbyFaceLandmarks.lateral).normalize();
const up = new THREE.Vector3(0, 1, 0);
const forward = new THREE.Vector3().crossVectors(lateral, up).normalize();
const smooth = (low: number, high: number, value: number) => {
  const t = THREE.MathUtils.clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
const region = (
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
) => 1 - smooth(0.2, 1, (x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);

function headMask(u: number, v: number, w: number) {
  return (
    (1 - smooth(0.235, 0.3, Math.abs(u))) *
    smooth(-0.185, -0.105, v) *
    (1 - smooth(0.24, 0.29, v)) *
    smooth(-0.27, -0.17, w) *
    (1 - smooth(0.13, 0.2, w))
  );
}

/** Positive endpoint displacement in the template's local facial frame. */
function displacement(
  key: FaceKey,
  u: number,
  v: number,
  w: number,
  mask: number,
  output: THREE.Vector3,
) {
  let du = 0,
    dv = 0,
    dw = 0;
  if (key === "faceWidth") {
    du = u * 0.1 * (1 - smooth(0.065, 0.17, v));
  } else if (key === "cheeks") {
    for (const side of [-1, 1]) {
      const weight = region(
        u - side * 0.145,
        v + 0.083,
        w + 0.015,
        0.115,
        0.095,
        0.15,
      );
      du += side * 0.014 * weight;
      dw += 0.006 * weight;
    }
  } else if (key === "muzzleLength") {
    dw = 0.016 * region(u + 0.012, v + 0.105, w - 0.047, 0.13, 0.1, 0.13);
  } else if (key === "eyeSize" || key === "eyeSpacing") {
    for (const side of [-1, 1]) {
      const centerU = side * 0.0745;
      const centerV = side < 0 ? 0 : 0.003;
      const weight = region(u - centerU, v - centerV, w, 0.071, 0.063, 0.1);
      if (key === "eyeSize") {
        du += (u - centerU) * 0.13 * weight;
        dv += (v - centerV) * 0.13 * weight;
        dw += w * 0.04 * weight;
      } else {
        du += side * 0.008 * weight;
      }
    }
  } else if (key === "earSize" || key === "earSpacing") {
    for (const side of [-1, 1]) {
      const centerU = side * 0.153;
      // The root collar remains fixed; the entire pinna above it moves smoothly.
      const ear =
        smooth(0.085, 0.15, v) *
        smooth(0.065, 0.125, side * u) *
        (1 - smooth(0.03, 0.1, w));
      if (key === "earSize") {
        du += (u - centerU) * 0.12 * ear;
        dv += (v - 0.105) * 0.12 * ear;
        dw += (w + 0.105) * 0.1 * ear;
      } else {
        du += side * 0.008 * ear;
      }
    }
  } else if (key === "noseWidth") {
    du =
      (u + 0.012) *
      0.18 *
      region(u + 0.012, v + 0.095, w - 0.054, 0.068, 0.05, 0.09);
  }
  return output
    .copy(lateral)
    .multiplyScalar(du * mask)
    .addScaledVector(up, dv * mask)
    .addScaledVector(forward, dw * mask);
}

/**
 * Decimation left a few almost-collinear triangles. A nonlinear field can move
 * their middle vertex across the long edge even when its continuous Jacobian is
 * safe. Bound that vertex's departure from edge interpolation for the SUM of
 * all eight controls, keeping a collar of the original triangle height.
 */
function protectSlivers(
  base: Float32Array,
  index: THREE.BufferAttribute | null,
  fields: Float32Array[],
  masks: Float32Array,
) {
  // UV seams duplicate vertices. Solve on exact position representatives, then
  // copy the same displacement back to every duplicate to avoid opening seams.
  const representatives = new Uint32Array(base.length / 3);
  const byPosition = new Map<string, number>();
  for (let i = 0; i < representatives.length; i++) {
    const key = `${base[i * 3]},${base[i * 3 + 1]},${base[i * 3 + 2]}`;
    const representative = byPosition.get(key) ?? i;
    byPosition.set(key, representative);
    representatives[i] = representative;
  }
  const constraints: {
    a: number;
    b: number;
    c: number;
    t: number;
    limit: number;
  }[] = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const edge = new THREE.Vector3(),
    height = new THREE.Vector3();
  const count = index?.count ?? base.length / 3;
  for (let i = 0; i < count; i += 3) {
    const ids = [
      representatives[index ? index.getX(i) : i],
      representatives[index ? index.getX(i + 1) : i + 1],
      representatives[index ? index.getX(i + 2) : i + 2],
    ];
    if (!ids.some((id) => masks[id] > 0)) continue;
    a.fromArray(base, ids[0] * 3);
    b.fromArray(base, ids[1] * 3);
    c.fromArray(base, ids[2] * 3);
    const edges = [
      a.distanceToSquared(b),
      b.distanceToSquared(c),
      c.distanceToSquared(a),
    ];
    const longest = edges.indexOf(Math.max(...edges));
    const ai = ids[longest],
      bi = ids[(longest + 1) % 3],
      ci = ids[(longest + 2) % 3];
    if (masks[ci] === 0 || edges[longest] < 1e-16) continue;
    a.fromArray(base, ai * 3);
    b.fromArray(base, bi * 3);
    c.fromArray(base, ci * 3);
    edge.subVectors(b, a);
    height.subVectors(c, a);
    const t = height.dot(edge) / edge.lengthSq();
    height.addScaledVector(edge, -t);
    const h = height.length();
    if (h / edge.length() < 0.12)
      constraints.push({ a: ai * 3, b: bi * 3, c: ci * 3, t, limit: h * 0.2 });
  }
  // Project all three vertices, rather than pushing only the middle vertex:
  // this remains stable where neighboring skinny triangles share constraints.
  for (let pass = 0; pass < 24; pass++) {
    for (const { a, b, c, t, limit } of constraints) {
      let residual = 0;
      for (const field of fields) {
        residual += Math.hypot(
          field[c] - THREE.MathUtils.lerp(field[a], field[b], t),
          field[c + 1] - THREE.MathUtils.lerp(field[a + 1], field[b + 1], t),
          field[c + 2] - THREE.MathUtils.lerp(field[a + 2], field[b + 2], t),
        );
      }
      if (residual <= limit || residual === 0) continue;
      const scale = limit / residual;
      const ca = masks[a / 3] > 0 ? -(1 - t) : 0;
      const cb = masks[b / 3] > 0 ? -t : 0;
      const cc = masks[c / 3] > 0 ? 1 : 0;
      const denominator = ca * ca + cb * cb + cc * cc;
      for (const field of fields) {
        for (let axis = 0; axis < 3; axis++) {
          const prediction = THREE.MathUtils.lerp(
            field[a + axis],
            field[b + axis],
            t,
          );
          const correction =
            ((field[c + axis] - prediction) * (scale - 1)) / denominator;
          field[a + axis] += correction * ca;
          field[b + axis] += correction * cb;
          field[c + axis] += correction * cc;
        }
      }
    }
  }
  for (let i = 0; i < representatives.length; i++) {
    if (representatives[i] === i) continue;
    for (const field of fields) {
      for (let axis = 0; axis < 3; axis++)
        field[i * 3 + axis] = field[representatives[i] * 3 + axis];
    }
  }
}

type Entry = {
  mesh: THREE.Mesh;
  original: THREE.BufferGeometry;
  geometry: THREE.BufferGeometry;
  dictionary: THREE.Mesh["morphTargetDictionary"];
  influences: THREE.Mesh["morphTargetInfluences"];
};
type FaceController = {
  apply: (design: FaceDesign) => void;
  reset: () => void;
  dispose: () => void;
};
const attached = new WeakMap<THREE.Object3D, FaceController>();

/**
 * Adds 16 native, relative GLB-compatible morph targets to an owned geometry clone.
 * Position, UV, index, imported normals, source materials and textures stay intact.
 * A slider only changes GPU weights after this one-time preparation.
 */
export function attachFaceMorphs(scene: THREE.Object3D): FaceController {
  const existing = attached.get(scene);
  if (existing) return existing;
  scene.updateMatrixWorld(true);
  const rootInverse = scene.matrixWorld.clone().invert();
  const entries: Entry[] = [];
  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  const point = new THREE.Vector3(),
    local = new THREE.Vector3(),
    delta = new THREE.Vector3();
  const restore = () => {
    for (const entry of entries) {
      entry.mesh.geometry = entry.original;
      entry.mesh.morphTargetDictionary = entry.dictionary;
      entry.mesh.morphTargetInfluences = entry.influences;
      entry.geometry.dispose();
    }
  };
  try {
    for (const mesh of meshes) {
      const original = mesh.geometry;
      const position = original.getAttribute("position");
      if (!position || position.itemSize !== 3) continue;
      const meshToTemplate = new THREE.Matrix4().multiplyMatrices(
        rootInverse,
        mesh.matrixWorld,
      );
      const templateToMesh = meshToTemplate.clone().invert();
      const templatePoints = new Float32Array(position.count * 3);
      const masks = new Float32Array(position.count);
      let affected = 0;
      for (let i = 0; i < position.count; i++) {
        point
          .fromBufferAttribute(position, i)
          .applyMatrix4(meshToTemplate)
          .sub(origin);
        const u = point.dot(lateral),
          v = point.y,
          w = point.dot(forward);
        templatePoints.set([u, v, w], i * 3);
        masks[i] = headMask(u, v, w);
        if (masks[i] > 0) affected++;
      }
      if (affected === 0) continue;
      if ((original.morphAttributes.position?.length ?? 0) > 0) {
        throw new Error("请使用未附加捏脸形变的基础虎斑猫模型。");
      }
      const geometry = original.clone();
      const entry: Entry = {
        mesh,
        original,
        geometry,
        dictionary: mesh.morphTargetDictionary,
        influences: mesh.morphTargetInfluences,
      };
      entries.push(entry);
      const base = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        base[i * 3] = position.getX(i);
        base[i * 3 + 1] = position.getY(i);
        base[i * 3 + 2] = position.getZ(i);
      }
      const scratch = new THREE.BufferGeometry();
      if (geometry.index) scratch.setIndex(geometry.index.clone());
      scratch.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(base, 3),
      );
      scratch.computeVertexNormals();
      const neutralNormals = Float32Array.from(
        scratch.getAttribute("normal").array,
      );
      if (!geometry.hasAttribute("normal"))
        geometry.setAttribute("normal", scratch.getAttribute("normal").clone());
      const positions: THREE.BufferAttribute[] = [],
        normals: THREE.BufferAttribute[] = [];
      const minimum = Float32Array.from(base),
        maximum = Float32Array.from(base);
      try {
        const fields = faceControls.map(({ key }) => {
          const positive = new Float32Array(base.length);
          for (let i = 0; i < position.count; i++) {
            if (masks[i] === 0) continue;
            const offset = i * 3;
            displacement(
              key,
              templatePoints[offset],
              templatePoints[offset + 1],
              templatePoints[offset + 2],
              masks[i],
              delta,
            );
            point
              .set(base[offset], base[offset + 1], base[offset + 2])
              .applyMatrix4(meshToTemplate);
            local.copy(point).add(delta).applyMatrix4(templateToMesh);
            positive[offset] = local.x - base[offset];
            positive[offset + 1] = local.y - base[offset + 1];
            positive[offset + 2] = local.z - base[offset + 2];
          }
          return positive;
        });
        protectSlivers(base, geometry.index, fields, masks);
        // Keep a reserve when all eight sliders reach opposite extremes at once.
        // This preserves visible edits while avoiding near-flat source slivers.
        for (const field of fields) {
          for (let i = 0; i < field.length; i++) field[i] *= 0.85;
        }
        for (const [controlIndex, { key }] of faceControls.entries()) {
          const positive = fields[controlIndex];
          // Every legal combination has at most one active endpoint per control.
          for (let i = 0; i < base.length; i++) {
            minimum[i] -= Math.abs(positive[i]);
            maximum[i] += Math.abs(positive[i]);
          }
          for (const sign of [-1, 1]) {
            const offsets = new Float32Array(base.length),
              absolute = new Float32Array(base.length);
            for (let i = 0; i < base.length; i++) {
              offsets[i] = positive[i] * sign;
              absolute[i] = base[i] + offsets[i];
            }
            const name = `TabbyFace_${key}_${sign < 0 ? "low" : "high"}`;
            const attribute = new THREE.Float32BufferAttribute(offsets, 3);
            attribute.name = name;
            positions.push(attribute);
            scratch.setAttribute(
              "position",
              new THREE.Float32BufferAttribute(absolute, 3),
            );
            scratch.computeVertexNormals();
            const computed = scratch.getAttribute("normal"),
              normalOffsets = new Float32Array(base.length);
            for (let i = 0; i < position.count; i++) {
              // Match the neutral recalculation before subtracting, and strictly
              // exclude the torso: imported body's lighting never changes.
              if (masks[i] === 0) continue;
              for (let axis = 0; axis < 3; axis++) {
                const offset = i * 3 + axis;
                normalOffsets[offset] =
                  (computed.array[offset] - neutralNormals[offset]) * masks[i];
              }
            }
            const normal = new THREE.Float32BufferAttribute(normalOffsets, 3);
            normal.name = name;
            normals.push(normal);
          }
        }
      } finally {
        scratch.dispose();
      }
      geometry.morphTargetsRelative = true;
      geometry.morphAttributes.position = positions;
      geometry.morphAttributes.normal = normals;
      // Conservative bounds include all eight sliders at either extreme together,
      // rather than just the neutral mesh or each isolated morph target.
      const bounds = new THREE.Box3();
      for (let i = 0; i < position.count; i++) {
        bounds.expandByPoint(point.fromArray(minimum, i * 3));
        bounds.expandByPoint(point.fromArray(maximum, i * 3));
      }
      geometry.boundingBox = bounds;
      geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
      mesh.geometry = geometry;
      mesh.updateMorphTargets();
    }
    if (entries.length === 0)
      throw new Error("没有找到此虎斑猫的可编辑脸部曲面。");
  } catch (error) {
    restore();
    throw error;
  }
  let disposed = false;
  const controller: FaceController = {
    apply(design) {
      if (disposed) throw new Error("这个捏脸模型已经关闭，请重新加载。");
      const valid = parseFaceDesign(design);
      for (const { mesh } of entries) {
        const weights = mesh.morphTargetInfluences!;
        faceControls.forEach(({ key }, index) => {
          const amount = (valid.shape[key] - 50) / 50;
          weights[index * 2] = Math.max(0, -amount);
          weights[index * 2 + 1] = Math.max(0, amount);
        });
      }
    },
    reset() {
      controller.apply(defaultFaceDesign);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      restore();
      attached.delete(scene);
    },
  };
  attached.set(scene, controller);
  controller.reset();
  return controller;
}
