import * as T from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { type CatDesign, type Pose, shapeControls } from "./cat-studio";
import { buildCoatSurface } from "./cat-coat";
import { createCatEye } from "./cat-eyes";
import { createCatEar } from "./cat-ears";
import { createCoatNormal } from "./cat-coat-normal";
import { createCatNose, taperedWhisker } from "./cat-muzzle";
import { sampleCoat } from "./cat-coat-pattern";
import { createRestSurface } from "./cat-rest-surface";

type P = [number, number, number];
const smooth = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const gaussian = (v: number, center: number, radius: number) =>
  Math.exp(-(((v - center) / radius) ** 2));
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
let neutral: T.BufferGeometry | null = null;
let neutralSkin: T.BufferGeometry | null = null;
let neutralCoat: T.BufferGeometry | null = null;
let faceProbe: T.Mesh | null = null;
const faceRay = new T.Raycaster();
function faceSurface(x: number, y: number) {
  if (!faceProbe) {
    const base = baseGeometry(),
      source = base.getAttribute("position"),
      sourceIndex = base.getIndex()!,
      positions: number[] = [],
      normals: number[] = [],
      sourceNormal = baseGeometry().getAttribute("normal");
    for (let i = 0; i < sourceIndex.count; i += 3) {
      const vertices = [0, 1, 2].map((k) => sourceIndex.getX(i + k));
      if (vertices.every((k) => source.getY(k) > 1.26 && source.getZ(k) > 0.9))
        for (const k of vertices) {
          positions.push(source.getX(k), source.getY(k), source.getZ(k));
          normals.push(
            sourceNormal.getX(k),
            sourceNormal.getY(k),
            sourceNormal.getZ(k),
          );
        }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
    faceProbe = new T.Mesh(
      geometry,
      new T.MeshBasicMaterial({ side: T.DoubleSide }),
    );
    faceProbe.updateMatrixWorld(true);
  }
  faceRay.set(new T.Vector3(x, y, 1.45), new T.Vector3(0, 0, -1));
  faceRay.far = 0.7;
  return faceRay.intersectObject(faceProbe, false)[0];
}

// A continuous implicit surface: torso, neck, muzzle and limbs are joined before triangulation.
// Coordinates are metres-like scene units, +Z is the cat's face, Y is up.
function baseGeometry() {
  if (neutral) return neutral;
  const parts: { p: P; r: P; blend?: number }[] = [
    { p: [0, 1.02, -0.13], r: [0.32, 0.36, 0.83] },
    { p: [0, 1.1, 0.48], r: [0.29, 0.39, 0.35] },
    { p: [0, 1.01, -0.66], r: [0.33, 0.38, 0.34] },
    { p: [0, 1.23, 0.64], r: [0.23, 0.25, 0.27] },
    { p: [0, 1.425, 0.81], r: [0.255, 0.22, 0.245] },
    { p: [0, 1.515, 0.81], r: [0.212, 0.115, 0.205], blend: 0.045 },
    { p: [-0.145, 1.335, 0.865], r: [0.145, 0.135, 0.15], blend: 0.045 },
    { p: [0.145, 1.335, 0.865], r: [0.145, 0.135, 0.15], blend: 0.045 },
    { p: [0, 1.255, 0.865], r: [0.205, 0.095, 0.155], blend: 0.035 },
    { p: [0, 1.37, 1.008], r: [0.078, 0.125, 0.072], blend: 0.025 },
    { p: [-0.068, 1.3, 1.045], r: [0.095, 0.067, 0.078], blend: 0.025 },
    { p: [0.068, 1.3, 1.045], r: [0.095, 0.067, 0.078], blend: 0.025 },
    { p: [0, 1.245, 1.026], r: [0.125, 0.044, 0.078], blend: 0.025 },
  ];
  for (const side of [-1, 1]) {
    parts.push(
      { p: [side * 0.245, 0.86, 0.54], r: [0.115, 0.31, 0.115] },
      { p: [side * 0.245, 0.36, 0.57], r: [0.075, 0.28, 0.085] },
      { p: [side * 0.245, 0.1, 0.65], r: [0.102, 0.095, 0.16] },
    );
    parts.push(
      { p: [side * 0.25, 0.82, -0.64], r: [0.17, 0.3, 0.2] },
      { p: [side * 0.25, 0.43, -0.81], r: [0.085, 0.26, 0.09] },
      { p: [side * 0.25, 0.1, -0.69], r: [0.105, 0.095, 0.16] },
    );
  }
  for (let i = 0; i < 20; i++) {
    const t = i / 19;
    parts.push({
      p: [
        0.1 * Math.sin(t * 3.2),
        1.08 + 0.67 * t,
        -0.92 - 0.85 * t + 0.12 * t * t,
      ],
      r: [0.075 - 0.035 * t, 0.075 - 0.035 * t, 0.075 - 0.035 * t],
    });
  }
  const mc = new MarchingCubes(
    160,
    new T.MeshStandardMaterial(),
    false,
    false,
    180_000,
  );
  mc.isolation = 0;
  const n = mc.resolution,
    spans = [1.35, 2.3, 3.4],
    centers = [0, 1, -0.15];
  const worldToCell = (v: number, axis: number) =>
    ((v - centers[axis]) / spans[axis] + 0.5) * n;
  mc.field.fill(-1);
  // Evaluate bounded volumes instead of testing every part at every voxel.
  // Finer sampling resolves the small muzzle pads and curved jaw without a faceted dome.
  for (const part of parts) {
    const toCell = worldToCell;
    const start = part.p.map((v, a) =>
      Math.max(1, Math.floor(toCell(v - part.r[a] - 0.1, a))),
    );
    const end = part.p.map((v, a) =>
      Math.min(n - 2, Math.ceil(toCell(v + part.r[a] + 0.1, a))),
    );
    for (let z = start[2]; z <= end[2]; z++)
      for (let y = start[1]; y <= end[1]; y++)
        for (let x = start[0]; x <= end[0]; x++) {
          const px = (x / n - 0.5) * spans[0],
            py = (y / n - 0.5) * spans[1] + centers[1],
            pz = (z / n - 0.5) * spans[2] + centers[2];
          const dx = (px - part.p[0]) / part.r[0],
            dy = (py - part.p[1]) / part.r[1],
            dz = (pz - part.p[2]) / part.r[2];
          // Ellipsoid distance approximation keeps the merge radius in world space.
          const k0 = Math.hypot(dx, dy, dz),
            k1 = Math.hypot(dx / part.r[0], dy / part.r[1], dz / part.r[2]);
          const d = (k0 * (k0 - 1)) / Math.max(k1, 0.0001);
          const index = x + n * y + n * n * z;
          mc.field[index] = -smooth(-mc.field[index], d, part.blend ?? 0.065);
        }
  }
  // Shallow orbital recesses sit behind the almond apertures instead of
  // mounting the eyes on top of a smooth spherical forehead.
  for (const side of [-1, 1]) {
    for (
      let z = Math.floor(worldToCell(0.94, 2));
      z < Math.ceil(worldToCell(1.1, 2));
      z++
    )
      for (
        let y = Math.floor(worldToCell(1.38, 1));
        y < Math.ceil(worldToCell(1.55, 1));
        y++
      )
        for (
          let x = Math.floor(worldToCell(-0.25, 0));
          x < Math.ceil(worldToCell(0.25, 0));
          x++
        ) {
          const px = (x / n - 0.5) * spans[0],
            py = (y / n - 0.5) * spans[1] + centers[1],
            pz = (z / n - 0.5) * spans[2] + centers[2];
          if (pz < 0.94 || pz > 1.1) continue;
          const d =
            (Math.hypot(
              (px - side * 0.125) / 0.066,
              (py - 1.465) / 0.052,
              (pz - 1.02) / 0.062,
            ) -
              1) *
            0.052;
          const index = x + n * y + n * n * z;
          mc.field[index] = smooth(mc.field[index], d, 0.012);
        }
  }
  mc.update();
  const count = mc.geometry.drawRange.count;
  const geometry = new T.BufferGeometry();
  const positions = new Float32Array(
    mc.geometry.attributes.position.array.slice(0, count * 3),
  );
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] *= spans[0] / 2;
    positions[i + 1] = (positions[i + 1] * spans[1]) / 2 + centers[1];
    positions[i + 2] = (positions[i + 2] * spans[2]) / 2 + centers[2];
  }
  geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
  const welded = mergeVertices(geometry, 0.0001);
  welded.computeVertexNormals();
  geometry.dispose();
  mc.geometry.dispose();
  (mc.material as T.Material).dispose();
  // Preserve shared vertices: expanding every triangle duplicated all seven
  // shape targets and normals, making export needlessly large and memory-heavy.
  neutral = welded;
  return welded;
}

function deform(p: T.Vector3, shape: CatDesign["shape"]) {
  const s = (key: keyof CatDesign["shape"]) => (shape[key] - 50) / 50;
  const head = gaussian(p.y, 1.44, 0.26) * gaussian(p.z, 0.87, 0.38);
  const cheek = gaussian(p.y, 1.33, 0.14) * gaussian(p.z, 0.91, 0.22);
  const muzzle = gaussian(p.z, 1.1, 0.1) * gaussian(p.y, 1.3, 0.12);
  const torso = gaussian(p.z, -0.12, 0.85) * gaussian(p.y, 1.02, 0.4);
  const tail = Math.max(0, Math.min(1, (-p.z - 0.9) / 0.7));
  return new T.Vector3(
    p.x *
      (1 +
        head * 0.14 * s("headWidth") +
        cheek * 0.14 * s("cheeks") +
        torso * 0.22 * s("bodyWeight")),
    p.y +
      Math.min(p.y / 0.65, 1) * 0.14 * s("legLength") +
      torso * (p.y - 1.02) * 0.15 * s("bodyWeight"),
    p.z +
      muzzle * 0.045 * s("muzzle") -
      Math.max(0, -p.z) * 0.14 * s("bodyLength") -
      tail * 0.22 * s("tailLength"),
  );
}
function furColor(p: T.Vector3, design: CatDesign) {
  return sampleCoat(p, design);
}

export function buildCat(design: CatDesign) {
  const group = new T.Group();
  group.name = "MiaoxingCat";
  group.userData = { design, templateVersion: "anatomical-short-hair-v3" };
  const bones: T.Bone[] = [],
    rest: T.Vector3[] = [];
  function bone(name: string, point: P, parent = -1) {
    const b = new T.Bone();
    b.name = name;
    const absolute = deform(new T.Vector3(...point), design.shape);
    b.position.copy(absolute);
    if (parent >= 0) {
      b.position.sub(rest[parent]);
      bones[parent].add(b);
    } else group.add(b);
    bones.push(b);
    rest.push(absolute);
    return bones.length - 1;
  }
  bone("Root", [0, 0, 0]);
  bone("Spine", [0, 1.0, -0.2], 0);
  bone("Chest", [0, 1.15, 0.44], 1);
  bone("Neck", [0, 1.23, 0.64], 2);
  bone("Head", [0, 1.43, 0.81], 3);
  for (const side of [-1, 1])
    for (const front of [true, false]) {
      const prefix = `${front ? "Front" : "Rear"}${side < 0 ? "L" : "R"}`;
      const top = bone(
        prefix + "Upper",
        [side * 0.245, front ? 0.91 : 1.0, front ? 0.54 : -0.66],
        front ? 2 : 1,
      );
      const lower = bone(
        prefix + "Lower",
        [side * 0.245, 0.5, front ? 0.57 : -0.81],
        top,
      );
      bone(prefix + "Paw", [side * 0.245, 0.1, front ? 0.65 : -0.69], lower);
    }
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    bone(
      "Tail" + i,
      [
        0.1 * Math.sin(t * 3.2),
        1.08 + 0.67 * t,
        -0.92 - 0.85 * t + 0.12 * t * t,
      ],
      i ? bones.length - 1 : 1,
    );
  }
  const skeleton = new T.Skeleton(bones);
  const localRest = bones.map((bone) => bone.position.clone());
  function weights(p: T.Vector3) {
    const scores: { index: number; value: number }[] = [];
    function envelope(index: number, a: P, b: P, radius: number) {
      const from = new T.Vector3(...a),
        direction = new T.Vector3(...b).sub(from);
      const fraction = T.MathUtils.clamp(
        p.clone().sub(from).dot(direction) /
          Math.max(0.00001, direction.lengthSq()),
        0,
        1,
      );
      const distance = from
        .addScaledVector(direction, fraction)
        .distanceToSquared(p);
      scores.push({
        index,
        value: Math.pow((radius * radius) / (radius * radius + distance), 4),
      });
    }
    envelope(1, [0, 1.02, -0.7], [0, 1.02, 0.2], 0.28);
    envelope(2, [0, 1.1, 0.3], [0, 1.26, 0.6], 0.24);
    envelope(3, [0, 1.15, 0.62], [0, 1.35, 0.75], 0.19);
    envelope(4, [0, 1.44, 0.82], [0, 1.3, 1.04], 0.26);
    for (let limb = 0; limb < 4; limb++) {
      const side = limb < 2 ? -1 : 1,
        front = limb % 2 === 0,
        top = 5 + limb * 3;
      const hip: P = [side * 0.245, front ? 0.91 : 1.0, front ? 0.54 : -0.66],
        knee: P = [side * 0.245, 0.5, front ? 0.57 : -0.81],
        paw: P = [side * 0.245, 0.1, front ? 0.65 : -0.69];
      envelope(top, hip, knee, front ? 0.105 : 0.14);
      envelope(top + 1, knee, paw, 0.075);
      envelope(top + 2, paw, [paw[0], 0.1, paw[2] + 0.1], 0.09);
    }
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const point: P = [
        0.1 * Math.sin(t * 3.2),
        1.08 + 0.67 * t,
        -0.92 - 0.85 * t + 0.12 * t * t,
      ];
      envelope(17 + i, point, point, 0.08);
    }
    scores.sort((a, b) => b.value - a.value);
    const selected = scores.slice(0, 4),
      total = selected.reduce((sum, s) => sum + s.value, 0);
    return {
      indices: selected.map((s) => s.index),
      weights: selected.map((s) => s.value / total),
    };
  }
  function skin(geometry: T.BufferGeometry) {
    const positions = geometry.getAttribute("position"),
      indices: number[] = [],
      values: number[] = [],
      colors: number[] = [];
    const morphs: T.BufferAttribute[] = [];
    for (const control of shapeControls) {
      if (["eyeSize", "eyeSpacing", "earSize"].includes(control.key)) continue;
      const arr = new Float32Array(positions.count * 3);
      const shape = Object.fromEntries(
        shapeControls.map((c) => [c.key, c.key === control.key ? 100 : 50]),
      ) as CatDesign["shape"];
      for (let i = 0; i < positions.count; i++) {
        const p = new T.Vector3().fromBufferAttribute(positions, i);
        deform(p, shape)
          .sub(p)
          .toArray(arr, i * 3);
      }
      const attribute = new T.BufferAttribute(arr, 3);
      attribute.name = control.key;
      morphs.push(attribute);
    }
    geometry.morphAttributes.position = morphs;
    geometry.morphTargetsRelative = true;
    for (let i = 0; i < positions.count; i++) {
      const p = new T.Vector3().fromBufferAttribute(positions, i),
        w = weights(p),
        color = furColor(p, design);
      indices.push(...w.indices);
      values.push(...w.weights);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute(
      "skinWeight",
      new T.Float32BufferAttribute(values, 4),
    );
    if (!geometry.getAttribute("color"))
      geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    return geometry;
  }
  if (!neutralSkin) neutralSkin = skin(baseGeometry().clone());
  const geometry = neutralSkin.clone();
  const skinPositions = geometry.getAttribute("position"),
    uv = new Float32Array(skinPositions.count * 2);
  for (let i = 0; i < skinPositions.count; i++) {
    const p = new T.Vector3().fromBufferAttribute(skinPositions, i);
    uv[i * 2] = Math.atan2(p.x, p.y - 1.02) / (2 * Math.PI) + 0.5;
    uv[i * 2 + 1] = (p.z + 2) / 4;
  }
  geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
  function colorGeometry(g: T.BufferGeometry, shade?: T.BufferAttribute) {
    const positions = g.getAttribute("position"),
      colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const color = furColor(
        new T.Vector3().fromBufferAttribute(positions, i),
        design,
      );
      if (shade) color.multiplyScalar(shade.getX(i));
      color.toArray(colors, i * 3);
    }
    g.setAttribute("color", new T.BufferAttribute(colors, 3));
  }
  colorGeometry(geometry);
  const material = new T.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.94,
    sheen: 0.4,
    sheenRoughness: 0.9,
    sheenColor: "#d7c8b5",
    normalMap: createCoatNormal(),
    normalScale: new T.Vector2(0.3, 0.3),
  });
  const body = new T.SkinnedMesh(geometry, material);
  body.name = "CatBody";
  body.add(bones[0]);
  group.add(body);
  group.updateMatrixWorld(true);
  body.bind(skeleton);
  for (const [key, index] of Object.entries(body.morphTargetDictionary || {}))
    body.morphTargetInfluences![index] =
      (design.shape[key as keyof CatDesign["shape"]] - 50) / 50;
  body.castShadow = true;
  body.receiveShadow = true;
  body.frustumCulled = false;
  if (!neutralCoat)
    neutralCoat = skin(
      buildCoatSurface(baseGeometry(), () => new T.Color(1, 1, 1)),
    );
  const hairGeo = neutralCoat.clone();
  colorGeometry(
    hairGeo,
    neutralCoat.getAttribute("color") as T.BufferAttribute,
  );
  const hair = new T.SkinnedMesh(
    hairGeo,
    new T.MeshStandardMaterial({
      vertexColors: true,
      side: T.DoubleSide,
      roughness: 1,
    }),
  );
  hair.name = "ShortCoat";
  hair.receiveShadow = true;
  group.add(hair);
  hair.bind(skeleton);
  hair.morphTargetInfluences = [...body.morphTargetInfluences!];
  hair.frustumCulled = false;
  const head = bones[4];
  function attach(mesh: T.Object3D, at: P) {
    mesh.position.copy(deform(new T.Vector3(...at), design.shape).sub(rest[4]));
    head.add(mesh);
    return mesh;
  }
  const eyes: ReturnType<typeof createCatEye>[] = [];
  const eyelids: T.Mesh[] = [];
  for (const side of [-1, 1]) {
    const eye = createCatEye({
      radius: 0.065 * (1 + (design.shape.eyeSize - 50) / 500),
      color: design.eyes,
      coat: design.coat,
      side,
    });
    eye.group.name = side < 0 ? "EyeL" : "EyeR";
    eye.group.traverse((object) => {
      if (object === eye.group) return;
      object.name = `${eye.group.name}_${object.name.replace(/\s/g, "_")}`;
      if (
        object instanceof T.Mesh &&
        object.morphTargetDictionary?.eyelidClosure !== undefined
      )
        eyelids.push(object);
    });
    const eyeAt: P = [
      side * (0.125 + (design.shape.eyeSpacing - 50) * 0.00024),
      1.465,
      0.996,
    ];
    attach(eye.group, eyeAt);
    eye.group.rotation.y = side * 0.38;
    const eyeCenter = deform(new T.Vector3(...eyeAt), design.shape);
    eye.group.traverse((object) => {
      if (!(object instanceof T.Mesh) || !object.name.includes("orbital"))
        return;
      const positions = object.geometry.getAttribute("position"),
        normals = object.geometry.getAttribute("normal");
      for (let i = 0; i < positions.count; i++) {
        const local = new T.Vector3().fromBufferAttribute(positions, i);
        const world = local
          .clone()
          .applyAxisAngle(new T.Vector3(0, 1, 0), side * 0.38)
          .add(new T.Vector3(...eyeAt));
        const hit = faceSurface(world.x, world.y);
        if (!hit) continue;
        const mix = (Math.floor(i / 49) / 5) ** 0.7;
        const fitted = deform(
          new T.Vector3(world.x, world.y, hit.point.z + 0.0008),
          design.shape,
        )
          .sub(eyeCenter)
          .applyAxisAngle(new T.Vector3(0, 1, 0), -side * 0.38);
        local.lerp(fitted, mix);
        positions.setXYZ(i, local.x, local.y, local.z);
        if (hit.normal) {
          const n = new T.Vector3()
            .fromBufferAttribute(normals, i)
            .lerp(
              hit.normal
                .clone()
                .applyAxisAngle(new T.Vector3(0, 1, 0), -side * 0.38),
              mix,
            )
            .normalize();
          normals.setXYZ(i, n.x, n.y, n.z);
        }
      }
      positions.needsUpdate = true;
      normals.needsUpdate = true;
    });
    eye.group.traverse((object) => {
      if (
        !(object instanceof T.Mesh) ||
        !(object.name.includes("orbital") || object.name.includes("eyelid"))
      )
        return;
      const positions = object.geometry.getAttribute("position"),
        colors = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) {
        const point = new T.Vector3()
          .fromBufferAttribute(positions, i)
          .applyAxisAngle(new T.Vector3(0, 1, 0), side * 0.38)
          .add(new T.Vector3(...eyeAt));
        furColor(point, design).toArray(colors, i * 3);
      }
      object.geometry.setAttribute("color", new T.BufferAttribute(colors, 3));
      const material = object.material as T.MeshPhysicalMaterial;
      material.color.set("#ffffff");
      material.vertexColors = true;
      material.needsUpdate = true;
    });
    eyes.push(eye);
    const es = 0.86 * (1 + (design.shape.earSize - 50) / 250);
    const ear = createCatEar(side, design.coat);
    ear.scale.set(es, es, es);
    ear.rotation.z = side * -0.2;
    attach(ear, [side * 0.2, 1.6, 0.76]);
  }
  attach(createCatNose(), [0, 1.322, 1.118]);
  function line(points: P[], radius: number, color: string) {
    const curve = new T.CatmullRomCurve3(
      points.map((p) => deform(new T.Vector3(...p), design.shape).sub(rest[4])),
    );
    const mesh = new T.Mesh(
      radius < 0.001
        ? taperedWhisker(curve, radius)
        : new T.TubeGeometry(curve, 20, radius, 5, false),
      new T.MeshStandardMaterial({ color, roughness: 0.6 }),
    );
    head.add(mesh);
  }
  line(
    [
      [0, 1.31, 1.139],
      [0, 1.282, 1.136],
      [-0.044, 1.267, 1.119],
    ],
    0.0015,
    "#69554a",
  );
  line(
    [
      [0, 1.282, 1.136],
      [0.044, 1.267, 1.119],
    ],
    0.0015,
    "#69554a",
  );
  for (const side of [-1, 1])
    for (let i = 0; i < 6; i++)
      line(
        [
          [side * 0.075, 1.31 - i * 0.006, 1.108],
          [side * 0.23, 1.3 + (i - 3) * 0.014, 1.16],
          [
            side * (0.39 + hash(i + side * 10) * 0.08),
            1.28 + (i - 3) * 0.026,
            1.04,
          ],
        ],
        0.0009,
        "#dfd6c7",
      );
  // Pose preview and exported clips share this exact skeleton.
  let restCorrectiveIndex = -1;
  function pose(
    time: number,
    mode: Pose,
    reduced = false,
    blend?: { rest: number; walk: number },
  ) {
    const t = reduced ? 0 : time;
    const resting = blend?.rest ?? (mode === "rest" ? 1 : 0);
    const walking = blend?.walk ?? (mode === "walk" ? 1 : 0);
    if (restCorrectiveIndex >= 0) {
      body.morphTargetInfluences![restCorrectiveIndex] = resting;
      hair.morphTargetInfluences![restCorrectiveIndex] = resting;
    }
    bones.forEach((b, i) => {
      b.rotation.set(0, 0, 0);
      b.position.copy(localRest[i]);
    });
    bones[0].position.y = -0.5 * resting;
    bones[3].position.y -= 0.08 * resting;
    bones[4].position.y -= 0.06 * resting;
    bones[3].rotation.x =
      resting * -0.025 + Math.sin(t * Math.PI) * 0.012 * (1 - resting);
    bones[4].rotation.x = 0.03 * resting;
    for (let limb = 0; limb < 4; limb++) {
      const top = 5 + limb * 3,
        front = limb % 2 === 0;
      const swing = Math.sin(
        t * Math.PI * 2 + (limb === 0 || limb === 3 ? 0 : Math.PI),
      );
      if (walking > 0.001) {
        // Two-bone IK uses the deformed rest lengths, keeping paws near the floor.
        const upper = rest[top + 1].clone().sub(rest[top]),
          lower = rest[top + 2].clone().sub(rest[top + 1]);
        const l1 = upper.length(),
          l2 = lower.length();
        const dy =
          rest[top + 2].y -
          rest[top].y -
          0 +
          walking * Math.max(0, swing) * 0.055;
        const dz = rest[top + 2].z - rest[top].z + walking * swing * 0.1;
        const d = T.MathUtils.clamp(Math.hypot(dy, dz), 0.01, l1 + l2 - 0.0001);
        const angle = Math.atan2(-dz, -dy);
        const bend = Math.acos(
          T.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1),
        );
        const elbow =
          Math.PI -
          Math.acos(
            T.MathUtils.clamp(
              (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2),
              -1,
              1,
            ),
          );
        const initialUpper = Math.atan2(-upper.z, -upper.y),
          initialLower = Math.atan2(-lower.z, -lower.y);
        const activation = T.MathUtils.smoothstep(walking, 0, 0.2);
        bones[top].rotation.x = (angle + bend - initialUpper) * activation;
        bones[top + 1].rotation.x =
          (-elbow - (initialLower - initialUpper)) * activation;
        bones[top + 2].rotation.x =
          -bones[top].rotation.x - bones[top + 1].rotation.x;
      }
      if (resting > 0) {
        const knee = rest[top + 1].clone();
        knee.y = 0.5 + (front ? 0.2 : 0.22);
        knee.z = front ? 0.3 : -0.26;
        const foot = rest[top + 2].clone();
        foot.y = 0.6;
        foot.z = front ? 0.72 : -0.6;
        bones[top + 1].position.lerp(knee.clone().sub(rest[top]), resting);
        bones[top + 2].position.lerp(foot.sub(knee), resting);
      }
    }
    bones[17].rotation.x = -0.85 * resting;
    bones[17].rotation.y = -0.4 * resting;
    bones[18].rotation.y = -0.2 * resting;
    bones[19].rotation.y = -0.3 * resting;
    bones[18].rotation.z = reduced
      ? 0
      : Math.sin(t * Math.PI) * 0.04 * (1 - resting);
    const blink = reduced
      ? 0
      : Math.pow(Math.max(0, Math.cos(t * 0.9 + 1.5)), 50);
    for (const eye of eyes)
      eye.setClosure(resting * 0.94 + (1 - resting) * blink);
    group.updateMatrixWorld(true);
  }
  // A pose-space corrective keeps the soft abdomen supported and the rear feet
  // tucked under the haunch. Its inverse skin transform preserves the edited
  // design at stand/walk while fixing the sharp folds made by linear skinning.
  pose(0, "rest", true);
  const restSurface = createRestSurface(rest, 0.5);
  function addRestCorrective(mesh: T.SkinnedMesh) {
    const g = mesh.geometry,
      positions = g.getAttribute("position"),
      indices = g.getAttribute("skinIndex"),
      weights = g.getAttribute("skinWeight");
    const data = new Float32Array(positions.count * 3),
      matrix = new T.Matrix4(),
      boneMatrix = new T.Matrix4();
    const vertex = new T.Vector3(),
      morphed = new T.Vector3(),
      posed = new T.Vector3(),
      desired = new T.Vector3();
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);
      const belly =
        (1 - T.MathUtils.smoothstep(vertex.y, 0.68, 0.88)) *
        gaussian(vertex.z, -0.1, 0.75) *
        gaussian(vertex.x, 0, 0.5);
      morphed.copy(vertex);
      for (let m = 0; m < 7; m++)
        morphed.addScaledVector(
          new T.Vector3().fromBufferAttribute(
            g.morphAttributes.position![m],
            i,
          ),
          mesh.morphTargetInfluences![m],
        );
      const folded = restSurface(vertex, morphed);
      if (folded.weight < 0.001 && belly < 0.001) continue;
      mesh.applyBoneTransform(i, posed.copy(morphed));
      desired.copy(posed);
      const support = 0.03 + 0.035 * (Math.abs(morphed.x) / 0.36) ** 2;
      desired.y = T.MathUtils.lerp(
        desired.y,
        Math.min(desired.y, support),
        belly,
      );
      desired.x += Math.sign(vertex.x) * belly * 0.018;
      // One continuous centreline transports each entire limb cross-section.
      // Independent nearest-segment frames made the old wrist split into forks.
      desired.lerp(folded.point, folded.weight);
      matrix.elements.fill(0);
      for (let k = 0; k < 4; k++) {
        const boneIndex = indices.getComponent(i, k),
          weight = weights.getComponent(i, k);
        boneMatrix.multiplyMatrices(
          skeleton.bones[boneIndex].matrixWorld,
          skeleton.boneInverses[boneIndex],
        );
        for (let e = 0; e < 16; e++)
          matrix.elements[e] += boneMatrix.elements[e] * weight;
      }
      if (Math.abs(matrix.determinant()) < 0.000001)
        throw new Error("The resting limb skin transform is degenerate.");
      desired.applyMatrix4(matrix.invert()).sub(morphed);
      desired.toArray(data, i * 3);
    }
    const target = new T.BufferAttribute(data, 3);
    target.name = "restFold";
    const influences = [...mesh.morphTargetInfluences!];
    g.morphAttributes.position!.push(target);
    mesh.updateMorphTargets();
    mesh.morphTargetInfluences = [...influences, 0];
  }
  addRestCorrective(body);
  addRestCorrective(hair);
  restCorrectiveIndex = 7;
  // Rebuild resting normals from the actually skinned, folded surface, rather
  // than carrying upright-leg normals into the horizontal forearm and haunch.
  const restPositions = new Float32Array(
    geometry.attributes.position.count * 3,
  );
  const p = new T.Vector3();
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    p.fromBufferAttribute(geometry.attributes.position, i);
    for (let m = 0; m < 8; m++)
      p.addScaledVector(
        new T.Vector3().fromBufferAttribute(
          geometry.morphAttributes.position![m],
          i,
        ),
        m === 7 ? 1 : body.morphTargetInfluences![m],
      );
    body.applyBoneTransform(i, p).toArray(restPositions, i * 3);
  }
  const normalSource = new T.BufferGeometry();
  normalSource.setAttribute(
    "position",
    new T.BufferAttribute(restPositions, 3),
  );
  normalSource.setIndex(geometry.index!.clone());
  normalSource.computeVertexNormals();
  const restNormals = new Float32Array(restPositions.length);
  const normalMatrix = new T.Matrix4(),
    partMatrix = new T.Matrix4(),
    inverseRotation = new T.Matrix3();
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    normalMatrix.elements.fill(0);
    for (let k = 0; k < 4; k++) {
      const index = geometry.attributes.skinIndex.getComponent(i, k),
        weight = geometry.attributes.skinWeight.getComponent(i, k);
      partMatrix.multiplyMatrices(
        skeleton.bones[index].matrixWorld,
        skeleton.boneInverses[index],
      );
      for (let e = 0; e < 16; e++)
        normalMatrix.elements[e] += partMatrix.elements[e] * weight;
    }
    inverseRotation.setFromMatrix4(normalMatrix).invert();
    p.fromBufferAttribute(normalSource.attributes.normal, i)
      .applyMatrix3(inverseRotation)
      .normalize()
      .sub(new T.Vector3().fromBufferAttribute(geometry.attributes.normal, i))
      .toArray(restNormals, i * 3);
  }
  const noNormalDelta = new T.BufferAttribute(
    new Float32Array(restNormals.length),
    3,
  );
  geometry.morphAttributes.normal = [
    ...Array(7).fill(noNormalDelta),
    new T.BufferAttribute(restNormals, 3),
  ];
  normalSource.dispose();
  const clips: T.AnimationClip[] = [];
  for (const mode of ["stand", "walk", "rest"] as Pose[]) {
    const tracks: T.KeyframeTrack[] = [],
      times = Array.from({ length: 49 }, (_, i) => i / 24);
    const lidValues = eyelids.map(() => [] as number[]);
    const bodyWeights: number[] = [],
      hairWeights: number[] = [];
    const positionValues = bones.map(() => [] as number[]);
    const values = bones.map(() => [] as number[]);
    for (const t of times) {
      pose(t, mode);
      bodyWeights.push(...body.morphTargetInfluences!);
      hairWeights.push(...hair.morphTargetInfluences!);
      eyelids.forEach((lid, i) =>
        lidValues[i].push(lid.morphTargetInfluences![0]),
      );
      bones.forEach((b, i) =>
        values[i].push(
          b.quaternion.x,
          b.quaternion.y,
          b.quaternion.z,
          b.quaternion.w,
        ),
      );
      bones.forEach((b, i) => positionValues[i].push(...b.position.toArray()));
    }
    bones.forEach((b, i) =>
      tracks.push(
        new T.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, values[i]),
      ),
    );
    bones.forEach((b, i) =>
      tracks.push(
        new T.VectorKeyframeTrack(
          `${b.name}.position`,
          times,
          positionValues[i],
        ),
      ),
    );
    tracks.push(
      new T.NumberKeyframeTrack(
        "CatBody.morphTargetInfluences",
        times,
        bodyWeights,
      ),
    );
    tracks.push(
      new T.NumberKeyframeTrack(
        "ShortCoat.morphTargetInfluences",
        times,
        hairWeights,
      ),
    );
    eyelids.forEach((lid, i) =>
      tracks.push(
        new T.NumberKeyframeTrack(
          `${lid.name}.morphTargetInfluences`,
          times,
          lidValues[i],
        ),
      ),
    );
    clips.push(new T.AnimationClip(mode, 2, tracks));
  }
  pose(0, "stand", true);
  return {
    group,
    pose,
    clips,
    triangles: geometry.index!.count / 3 + hairGeo.index!.count / 3,
    dispose() {
      eyes.forEach((eye) => eye.dispose());
      const materials = new Set<T.Material>();
      group.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            materials.add(m),
          );
        }
      });
      materials.forEach((m) => m.dispose());
      skeleton.dispose();
    },
  };
}
