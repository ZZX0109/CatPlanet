import * as THREE from "three";
import type { CatCoatType } from "./cat-coat-profiles";

type V3 = [number, number, number];
type Binding = {
  a: number;
  b: number;
  c: number;
  bary: THREE.Vector3;
  frameInverse: THREE.Matrix3;
  transport?: THREE.Matrix3;
};
type Strand = {
  root: Binding;
  side: number;
  length: number;
  rise: number;
  forward: number;
  radius: number;
  phase: number;
  earRegion?: "ear-inner" | "ear-tip";
  earSide?: number;
  clump?: number;
  color?: V3;
  colorUV?: [number, number];
  bend?: V3;
  tier?: number;
  fiber?: number;
};
export type CatGroomDetails = {
  meshes: THREE.Mesh[];
  update(options?: { density?: number; length?: number; coat?: CatCoatType }): void;
  snapshotMeshes(): THREE.Mesh[];
  dispose(): void;
};

/** Sparse anatomical details, bound to actual skin triangles rather than bones
 * alone. Root positions therefore follow facial morphs as well as pose. */
export function createCatGroomDetails(
  scene: THREE.Group,
  surface: THREE.Mesh,
  options: { colorAt?: (u: number, v: number) => V3 } = {},
): CatGroomDetails {
  let data: Record<string, any> | undefined;
  scene.traverse((node) => {
    if (!data && node.userData.creatorLandmarks) data = node.userData;
  });
  if (!data) throw new Error("Detail groom needs anatomical landmarks.");
  const hairless =
    data.creatorBaseId === "sphynx" ||
    data.creatorTemplateId === "sphynx-cat-v1";
  const landmarks = data.creatorLandmarks as {
    eyeCenters: V3[];
    earBases: V3[];
    muzzleCenter: V3;
  };
  const canReplaceWhiskers =
    data.creatorGroom?.removedWhiskerCards === true ||
    Number(data.creatorGroom?.removedWhiskerCards) > 0;
  const eyes = landmarks.eyeCenters
    .map((p) => new THREE.Vector3(...p))
    .sort((a, b) => a.x - b.x);
  const eyeSpan = eyes[0].distanceTo(eyes[1]);
  const muzzle = new THREE.Vector3(...landmarks.muzzleCenter);
  const right = eyes[1].clone().sub(eyes[0]).normalize();
  const forward = new THREE.Vector3()
    .crossVectors(right, new THREE.Vector3(0, 1, 0))
    .normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  const matrix = new THREE.Matrix4(),
    inverse = new THREE.Matrix4();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const triangle = new THREE.Triangle(),
    nearest = new THREE.Vector3(),
    normal = new THREE.Vector3();
  const index = surface.geometry.index;
  const count = surface.geometry.attributes.position.count;
  const initial = new Float32Array(count * 3);
  const updateMatrix = () => {
    scene.updateMatrixWorld(true);
    if (surface instanceof THREE.SkinnedMesh) surface.skeleton.update();
    inverse.copy(scene.matrixWorld).invert();
    matrix.multiplyMatrices(inverse, surface.matrixWorld);
  };
  const vertex = (i: number, target: THREE.Vector3) =>
    surface.getVertexPosition(i, target).applyMatrix4(matrix);
  updateMatrix();
  for (let i = 0; i < count; i++) vertex(i, a).toArray(initial, i * 3);
  function bindingFor(
    ai: number,
    bi: number,
    ci: number,
    bary: THREE.Vector3,
  ): Binding {
    const aa = new THREE.Vector3().fromArray(initial, ai * 3),
      bb = new THREE.Vector3().fromArray(initial, bi * 3),
      cc = new THREE.Vector3().fromArray(initial, ci * 3);
    const e = bb.sub(aa).normalize(),
      n = new THREE.Vector3().crossVectors(e, cc.sub(aa)).normalize(),
      f = new THREE.Vector3().crossVectors(n, e).normalize();
    return {
      a: ai,
      b: bi,
      c: ci,
      bary,
      frameInverse: new THREE.Matrix3()
        .set(e.x, f.x, n.x, e.y, f.y, n.y, e.z, f.z, n.z)
        .transpose(),
    };
  }

  function bind(
    target: THREE.Vector3,
    ear?: { side: number; y: number },
  ): Binding {
    let distance = Infinity,
      best: Binding | undefined;
    const total = index ? index.count : count;
    for (let k = 0; k < total; k += 3) {
      const ai = index ? index.getX(k) : k,
        bi = index ? index.getX(k + 1) : k + 1,
        ci = index ? index.getX(k + 2) : k + 2;
      a.fromArray(initial, ai * 3);
      b.fromArray(initial, bi * 3);
      c.fromArray(initial, ci * 3);
      triangle.set(a, b, c);
      triangle.getNormal(normal);
      if (
        ear &&
        ((a.y + b.y + c.y) / 3 < ear.y ||
          (a.x + b.x + c.x) * ear.side <= 0 ||
          normal.dot(forward) < 0.05)
      )
        continue;
      triangle.closestPointToPoint(target, nearest);
      const d = nearest.distanceToSquared(target);
      if (d < distance) {
        distance = d;
        best = bindingFor(
          ai,
          bi,
          ci,
          triangle.getBarycoord(nearest, new THREE.Vector3())!,
        );
      }
    }
    if (!best) throw new Error("Could not attach groom detail to skin.");
    return best;
  }

  const whiskers: Strand[] = [],
    earTufts: Strand[] = [],
    earTips: Strand[] = [];
  if (!hairless && canReplaceWhiskers)
    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++)
        for (let column = 0; column < 4; column++) {
          const phase = (row * 4 + column) * 1.73 + side * 0.48;
          const target = muzzle
            .clone()
            .addScaledVector(right, side * eyeSpan * (0.31 + 0.058 * column))
            .addScaledVector(
              up,
              eyeSpan * ((1 - row) * 0.068 - 0.035 - column * 0.009),
            )
            .addScaledVector(forward, -eyeSpan * (0.08 + 0.02 * column));
          whiskers.push({
            root: bind(target),
            side,
            length: eyeSpan * (1.32 + 0.1 * column + 0.06 * Math.sin(phase)),
            rise: eyeSpan * ((1 - row) * 0.38 + 0.06 * Math.cos(phase)),
            forward: eyeSpan * (0.12 + 0.06 * Math.cos(phase)),
            radius: eyeSpan * (0.0038 + 0.0005 * Math.sin(phase)),
            phase,
          });
        }
      for (let eyebrow = 0; eyebrow < 3; eyebrow++) {
        const eye = side < 0 ? eyes[0] : eyes[1],
          phase = eyebrow * 2.31 + side;
        const target = eye
          .clone()
          .addScaledVector(up, eyeSpan * (0.29 + 0.025 * eyebrow))
          .addScaledVector(right, side * eyeSpan * (0.02 + 0.09 * eyebrow))
          .addScaledVector(forward, -eyeSpan * 0.08);
        whiskers.push({
          root: bind(target),
          side,
          length: eyeSpan * (0.34 + 0.08 * eyebrow),
          rise: eyeSpan * (0.27 + 0.05 * eyebrow),
          forward: eyeSpan * 0.04,
          radius: eyeSpan * 0.0025,
          phase,
        });
      }
    }
  // Weld UV splits for the sole purpose of rejecting detached native hair
  // cards as new roots. Preserve every original vertex/face/material unchanged.
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (v: number): number => {
    let root = v;
    while (parent[root] !== root) root = parent[root];
    while (parent[v] !== v) { const next = parent[v]; parent[v] = root; v = next; }
    return root;
  };
  const join = (a: number, b: number) => { parent[find(a)] = find(b); };
  const welded = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(initial[i * 3] * 1e6)},${Math.round(initial[i * 3 + 1] * 1e6)},${Math.round(initial[i * 3 + 2] * 1e6)}`;
    const prior = welded.get(key);
    if (prior === undefined) welded.set(key, i); else join(i, prior);
  }
  const total = index ? index.count : count;
  for (let k = 0; k < total; k += 3) {
    const ai = index ? index.getX(k) : k;
    join(ai, index ? index.getX(k + 1) : k + 1);
    join(ai, index ? index.getX(k + 2) : k + 2);
  }
  const componentFaces = new Map<number, number>();
  for (let k = 0; k < total; k += 3) {
    const root = find(index ? index.getX(k) : k);
    componentFaces.set(root, (componentFaces.get(root) ?? 0) + 1);
  }
  const earWeights = new Float32Array(count);
  if (surface instanceof THREE.SkinnedMesh) {
    const si = surface.geometry.getAttribute("skinIndex"), sw = surface.geometry.getAttribute("skinWeight");
    const earBones = new Set(surface.skeleton.bones.flatMap((bone, i) => /Bone00[89]/.test(bone.name) ? [i] : []));
    if (si && sw) for (let i = 0; i < count; i++) for (let j = 0; j < 4; j++)
      if (earBones.has(si.getComponent(i, j))) earWeights[i] += sw.getComponent(i, j);
  }
  type EarTriangle = { a: number; b: number; c: number; center: THREE.Vector3; color?: V3; uv?: [number, number]; forward: number };
  const uv = surface.geometry.getAttribute("uv");
  function closestEar(target: THREE.Vector3, pool: EarTriangle[]) {
    let best: Binding | undefined, distance = Infinity;
    for (const t of pool) {
      a.fromArray(initial, t.a * 3); b.fromArray(initial, t.b * 3); c.fromArray(initial, t.c * 3);
      triangle.set(a, b, c).closestPointToPoint(target, nearest);
      const d = nearest.distanceToSquared(target);
      if (d < distance) {
        distance = d;
        best = bindingFor(t.a, t.b, t.c, triangle.getBarycoord(nearest, new THREE.Vector3())!);
      }
    }
    return best;
  }
  function bindingPoint(root: Binding) {
    return new THREE.Vector3().fromArray(initial, root.a * 3).multiplyScalar(root.bary.x)
      .addScaledVector(new THREE.Vector3().fromArray(initial, root.b * 3), root.bary.y)
      .addScaledVector(new THREE.Vector3().fromArray(initial, root.c * 3), root.bary.z);
  }
  if (!hairless) for (const ear of landmarks.earBases) {
    const base = new THREE.Vector3(...ear), side = Math.sign(base.x) || 1;
    const skin: EarTriangle[] = [], inner: EarTriangle[] = [];
    let tip = base.clone();
    for (let k = 0; k < total; k += 3) {
      const ai = index ? index.getX(k) : k, bi = index ? index.getX(k + 1) : k + 1, ci = index ? index.getX(k + 2) : k + 2;
      if ((componentFaces.get(find(ai)) ?? 0) < 128) continue;
      a.fromArray(initial, ai * 3); b.fromArray(initial, bi * 3); c.fromArray(initial, ci * 3);
      const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      if (center.x * side <= 0 || center.y < base.y + eyeSpan * .03
        || center.y > base.y + eyeSpan * 1.25 || Math.abs(center.x - base.x) > eyeSpan * .65
        || Math.abs(center.z - base.z) > eyeSpan * .75) continue;
      if ((earWeights[ai] + earWeights[bi] + earWeights[ci]) / 3 < .03) continue;
      triangle.set(a, b, c); triangle.getNormal(normal);
      const area = triangle.getArea(), longest = Math.max(a.distanceToSquared(b), b.distanceToSquared(c), c.distanceToSquared(a));
      if (area < 1e-10 || longest / (2 * area) > 30) continue;
      const sampleUV: [number, number] | undefined = uv ? [(uv.getX(ai) + uv.getX(bi) + uv.getX(ci)) / 3, (uv.getY(ai) + uv.getY(bi) + uv.getY(ci)) / 3] : undefined;
      const color = sampleUV && options.colorAt ? options.colorAt(...sampleUV) : undefined;
      const t = { a: ai, b: bi, c: ci, center, color, uv: sampleUV, forward: normal.dot(forward) };
      skin.push(t);
      for (const v of [a, b, c]) if (v.y > tip.y) tip.copy(v);
      if (t.forward > .12 && center.y > base.y + eyeSpan * .1
        && (!color || (color[0] > color[1] * 1.12 && color[0] > color[2] * 1.16))) inner.push(t);
    }
    if (!skin.length) continue;
    const coatSamples = skin.filter(t => t.color && !(t.color[0] > t.color[1] * 1.5 && t.color[0] > t.color[2] * 1.2));
    const add = (root: Binding, region: "ear-inner" | "ear-tip", clump: number, random: () => number, fiber: number) => {
      const rootP = bindingPoint(root);
      const nearestCoat = [...coatSamples].sort((a, b) => a.center.distanceToSquared(rootP) - b.center.distanceToSquared(rootP))[0];
      const u = uv ? uv.getX(root.a) * root.bary.x + uv.getX(root.b) * root.bary.y + uv.getX(root.c) * root.bary.z : 0;
      const v = uv ? uv.getY(root.a) * root.bary.x + uv.getY(root.b) * root.bary.y + uv.getY(root.c) * root.bary.z : 0;
      const tipHair = region === "ear-tip", spread = random(), jitter = .82 + .32 * random();
      // Interleave short support, mid-coat and a few long tips inside each
      // density prefix. The longer fibres converge near the cone's axis.
      const tierIndex = tipHair ? (fiber * 5 + Math.floor(fiber / 8)) % 8 : fiber % 5;
      const tier = tipHair ? (tierIndex < 4 ? 0 : tierIndex < 7 ? 1 : 2)
        : (tierIndex < 3 ? 0 : tierIndex === 3 ? 1 : 2);
      const tierScale = tipHair ? 1 : [.52, .83, 1.16][tier];
      const endX = tip.x + eyeSpan * (random() - .5) * (tipHair ? [.11, .065, .025][tier] : .02);
      const tipLateral = (endX - rootP.x) / .75;
      (tipHair ? earTips : earTufts).push({ root,
        side: tipHair ? Math.sign(tipLateral) || side : -side,
        earSide: side, earRegion: region, clump, tier, fiber,
        length: tipHair ? Math.abs(tipLateral) : eyeSpan * (.10 + .032 * clump + .035 * spread) * jitter * tierScale,
        rise: eyeSpan * (tipHair ? [.045 + .035 * spread, .095 + .05 * spread, .165 + .055 * spread][tier]
          : .025 + .022 * clump + .028 * spread) * jitter * tierScale,
        forward: tipHair ? (tip.z - rootP.z) * .75 + eyeSpan * (random() - .5) * [.065, .045, .025][tier]
          : eyeSpan * (.016 + .027 * random()),
        radius: eyeSpan * (tipHair ? .00135 : .0014) * (.78 + .4 * random()), phase: fiber * 2.399 + side * .8,
        bend: tipHair ? [eyeSpan * (random() - .5) * .055, -eyeSpan * (.008 + .017 * random()), eyeSpan * (random() - .5) * .045]
          : [eyeSpan * side * (random() - .5) * .025, eyeSpan * (random() - .5) * .027, eyeSpan * (.008 + .012 * random())],
        color: nearestCoat?.color ?? (options.colorAt ? options.colorAt(u, v) : [.38, .36, .32]),
        colorUV: nearestCoat?.uv ?? [u, v],
      });
    };
    let randomState = side < 0 ? 0x68123 : 0x117af;
    const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
    // Four coherent overlapping fans, each with short support and fewer long hairs, nearby bound roots and a shared
    // length/rise hierarchy. No equal-spaced row of independently aimed teeth.
    for (let clump = 0; clump < 4 && inner.length; clump++) {
      const target = base.clone().lerp(tip, .22 + .155 * clump)
        .addScaledVector(right, side * eyeSpan * (clump % 2 ? -.045 : .035))
        .addScaledVector(forward, eyeSpan * .15);
      const anchor = closestEar(target, inner);
      if (!anchor) continue;
      for (let fiber = 0; fiber < 15; fiber++) {
        const r = Math.sqrt(random()), mix = .14 + .18 * random(), rb = new THREE.Vector3(1 - r, r * (1 - random()), 0);
        rb.z = 1 - rb.x - rb.y;
        add(bindingFor(anchor.a, anchor.b, anchor.c, anchor.bary.clone().lerp(rb, mix)), "ear-inner", clump, random, fiber);
      }
    }
    const tipPool = skin.filter(t => t.center.y > tip.y - eyeSpan * .17);
    const anchors: Binding[] = [], used = new Set<EarTriangle>();
    // Spread the cone across eight nearby actual skin faces, front/back and
    // both sides of the apex, instead of a single upright rod on one triangle.
    for (let cluster = 0; cluster < Math.min(8, tipPool.length); cluster++) {
      const theta = cluster * Math.PI * 2 / 8;
      const target = tip.clone().addScaledVector(right, eyeSpan * .055 * Math.cos(theta))
        .addScaledVector(up, -eyeSpan * (.025 + .045 * Math.abs(Math.sin(theta))))
        .addScaledVector(forward, eyeSpan * .04 * Math.sin(theta));
      const t = [...tipPool].filter(t => !used.has(t)).sort((a, b) => a.center.distanceToSquared(target) - b.center.distanceToSquared(target))[0];
      if (!t) continue;
      used.add(t);
      const anchor = closestEar(target, [t]);
      if (anchor) anchors.push(anchor);
    }
    for (let fiber = 0; fiber < 32 && anchors.length; fiber++) {
      const anchor = anchors[fiber % anchors.length], r = Math.sqrt(random());
      const rb = new THREE.Vector3(1 - r, r * (1 - random()), 0);
      rb.z = 1 - rb.x - rb.y;
      add(bindingFor(anchor.a, anchor.b, anchor.c, anchor.bary.clone().lerp(rb, .2 + .25 * random())), "ear-tip", fiber % anchors.length, random, fiber);
    }
  }
  // Prefixes always alternate sides, independently for inner and tip regions.
  for (const strands of [earTufts, earTips]) {
    const left = strands.filter(s => s.earSide === -1), right = strands.filter(s => s.earSide === 1), ordered: Strand[] = [];
    if (strands === earTufts) for (const side of [left, right]) side.sort((a, b) => (a.fiber! - b.fiber!) || (a.clump! - b.clump!));
    for (let i = 0; i < Math.max(left.length, right.length); i++) { if (left[i]) ordered.push(left[i]); if (right[i]) ordered.push(right[i]); }
    strands.splice(0, strands.length, ...ordered);
  }

  function meshFor(
    name: string,
    strands: Strand[],
    segments: number,
    sides: number,
    roughness: number,
  ) {
    const geometry = new THREE.BufferGeometry();
    const vertices = (segments + 1) * sides;
    const positions = new Float32Array(strands.length * vertices * 3),
      normals = new Float32Array(positions.length),
      colors = new Float32Array(positions.length);
    const indices = new Uint32Array(strands.length * segments * sides * 6);
    for (let s = 0; s < strands.length; s++)
      for (let j = 0; j <= segments; j++)
        for (let side = 0; side < sides; side++) {
          const k = (s * vertices + j * sides + side) * 3,
            t = j / segments;
          // Root pigmentation is subdued; the shaft stays ivory instead of an
          // unlit white wire. Geometric tube normals give a moving slim highlight.
          const brightness = THREE.MathUtils.lerp(
            0.38,
            0.84,
            Math.min(1, t * 3),
          );
          if (strands[s].earRegion && strands[s].color) {
            const shaft = THREE.MathUtils.smoothstep(t, .035, .52);
            const inner = strands[s].earRegion === "ear-inner";
            const lift = shaft * (inner ? .66 : .16);
            const shade = .58 + .42 * shaft;
            const soft: V3 = [.26, .25, .235];
            colors[k] = THREE.MathUtils.lerp(strands[s].color![0] * shade, soft[0], lift);
            colors[k + 1] = THREE.MathUtils.lerp(strands[s].color![1] * shade, soft[1], lift);
            colors[k + 2] = THREE.MathUtils.lerp(strands[s].color![2] * shade, soft[2], lift);
          } else {
            colors[k] = brightness;
            colors[k + 1] = brightness * 0.97;
            colors[k + 2] = brightness * 0.91;
          }
        }
    for (let s = 0; s < strands.length; s++)
      for (let j = 0; j < segments; j++)
        for (let side = 0; side < sides; side++) {
          const next = (side + 1) % sides,
            a = s * vertices + j * sides + side,
            b = s * vertices + j * sides + next;
          indices.set(
            [a, b, a + sides, b, b + sides, a + sides],
            (s * segments * sides + j * sides + side) * 6,
          );
        }
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setDrawRange(0, indices.length);
    const material = new THREE.MeshStandardMaterial({
      color: "white",
      vertexColors: true,
      roughness,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    mesh.userData = {
      norwegianFur: true,
      groomDetail: name.includes("Whisker") ? "whiskers" : "earTufts",
      detailType: name.includes("Whisker") ? "whiskers" : "ear-tufts",
      ...(strands[0]?.earRegion ? { earRegion: strands[0].earRegion, colorSource: "nearest-source-coat-UV-linear-with-explicit-soft-gray-shaft-transition", revision: 2, densityOrder: "left-right-interleaved", rootSurfaceFilter: "welded-component>=128faces,earBoneWeight>.03,triangle-aspect<30", rootBindings: strands.map(s => ({ a: s.root.a, b: s.root.b, c: s.root.c, bary: s.root.bary.toArray(), side: s.earSide, clump: s.clump, tier: s.tier, colorUV: s.colorUV })) } : {}),
      strandCount: strands.length,
      strandVertices: vertices,
      strandSegments: segments,
      strandSides: sides,
      rootIndices: Array.from({ length: sides }, (_, i) => i),
      rootPair: [0, Math.floor(sides / 2)],
      rootBinding: "triangle-barycentric",
      exportPose: "static-current-groom",
    };
    return { mesh, strands, segments, sides };
  }
  const groups: ReturnType<typeof meshFor>[] = [];
  if (whiskers.length)
    groups.push(meshFor("Detail_Whiskers", whiskers, 16, 5, 0.53));
  if (earTufts.length)
    groups.push(meshFor("Detail_EarTufts", earTufts, 8, 4, 0.88));
  if (earTips.length)
    groups.push(meshFor("Detail_EarTipTufts", earTips, 10, 4, 0.84));
  const rootPoint = new THREE.Vector3(),
    rootNormal = new THREE.Vector3(),
    center = new THREE.Vector3(),
    tangent = new THREE.Vector3(),
    basisA = new THREE.Vector3(),
    basisB = new THREE.Vector3(),
    radial = new THREE.Vector3();
  const edge = new THREE.Vector3(),
    across = new THREE.Vector3(),
    transport = new THREE.Matrix3(),
    flowRight = new THREE.Vector3(),
    flowUp = new THREE.Vector3(),
    flowForward = new THREE.Vector3();
  let earDensity = 100,
    earLength = 50;
  let coat: CatCoatType = "long";
  function update(options: { density?: number; length?: number; coat?: CatCoatType } = {}) {
    if (options.coat) coat = options.coat;
    if (Number.isFinite(options.density))
      earDensity = THREE.MathUtils.clamp(options.density!, 0, 100);
    if (Number.isFinite(options.length))
      earLength = THREE.MathUtils.clamp(options.length!, 0, 100);
    updateMatrix();
    for (const group of groups) {
      const isEar = !!group.strands[0]?.earRegion;
      const activeCount = isEar
        ? coat === "hairless" ? 0 : Math.floor((group.strands.length * earDensity) / 100)
        : group.strands.length;
      const lengthScale = isEar ? (0.45 + (0.8 * earLength) / 100) * (coat === "short" ? .58 : 1) : 1;
      if (isEar) { group.mesh.visible = activeCount > 0; group.mesh.userData.coatType = coat; }
      group.mesh.geometry.setDrawRange(
        0,
        activeCount * group.segments * group.sides * 6,
      );
      group.mesh.userData.strandCount = activeCount;
      group.mesh.userData.furLength = isEar ? earLength : undefined;
      const positions = group.mesh.geometry.attributes.position
          .array as Float32Array,
        normals = group.mesh.geometry.attributes.normal.array as Float32Array;
      for (let s = 0; s < group.strands.length; s++) {
        const strand = group.strands[s],
          binding = strand.root;
        vertex(binding.a, a);
        vertex(binding.b, b);
        vertex(binding.c, c);
        triangle.set(a, b, c);
        triangle.getNormal(rootNormal);
        edge.copy(b).sub(a).normalize();
        across.crossVectors(rootNormal, edge).normalize();
        if (rootNormal.lengthSq() > 0.5 && edge.lengthSq() > 0.5) {
          transport
            .set(
              edge.x,
              across.x,
              rootNormal.x,
              edge.y,
              across.y,
              rootNormal.y,
              edge.z,
              across.z,
              rootNormal.z,
            )
            .multiply(binding.frameInverse);
          (binding.transport ??= new THREE.Matrix3()).copy(transport);
        } else transport.copy(binding.transport ?? new THREE.Matrix3());
        flowRight.copy(right).applyMatrix3(transport).normalize();
        flowUp.copy(up).applyMatrix3(transport).normalize();
        flowForward.copy(forward).applyMatrix3(transport).normalize();
        rootPoint
          .copy(a)
          .multiplyScalar(binding.bary.x)
          .addScaledVector(b, binding.bary.y)
          .addScaledVector(c, binding.bary.z)
          .addScaledVector(rootNormal, 0.0003);
        for (let j = 0; j <= group.segments; j++) {
          const t = j / group.segments,
            curve = t * t;
          const droop = group.mesh.name.includes("Whisker") ? 0.16 : 0.035;
          const length = strand.length * lengthScale,
            rise = strand.rise * lengthScale,
            advance = strand.forward * lengthScale;
          if (isEar) {
            const lift = eyeSpan * (strand.earRegion === "ear-tip" ? .018 : .045) * Math.min(1, lengthScale);
            const bend = strand.bend ?? [0, 0, 0], sine = Math.sin(Math.PI * t), cosineD = Math.PI * Math.cos(Math.PI * t);
            center.copy(rootPoint)
              .addScaledVector(flowRight, strand.side * length * (t - .25 * curve))
              .addScaledVector(flowUp, rise * (t - .10 * curve) - length * .012 * curve)
              .addScaledVector(flowForward, advance * t + length * .10 * Math.sin(Math.PI * t))
              .addScaledVector(rootNormal, lift * Math.sin(Math.PI * t * .65))
              .addScaledVector(flowRight, bend[0] * lengthScale * sine)
              .addScaledVector(flowUp, bend[1] * lengthScale * sine)
              .addScaledVector(flowForward, bend[2] * lengthScale * sine);
            tangent.copy(flowRight).multiplyScalar(strand.side * length * (1 - .5 * t))
              .addScaledVector(flowUp, rise * (1 - .20 * t) - length * .024 * t)
              .addScaledVector(flowForward, advance + length * .10 * Math.PI * Math.cos(Math.PI * t))
              .addScaledVector(rootNormal, lift * Math.PI * .65 * Math.cos(Math.PI * t * .65))
              .addScaledVector(flowRight, bend[0] * lengthScale * cosineD)
              .addScaledVector(flowUp, bend[1] * lengthScale * cosineD)
              .addScaledVector(flowForward, bend[2] * lengthScale * cosineD).normalize();
          } else {
          center
            .copy(rootPoint)
            .addScaledVector(
              flowRight,
              strand.side * length * (t - 0.055 * curve),
            )
            .addScaledVector(flowUp, rise * t - length * droop * curve)
            .addScaledVector(
              flowForward,
              advance * t + length * 0.12 * Math.sin(Math.PI * t),
            );
          if (group.mesh.name.includes("EarTufts"))
            center.addScaledVector(
              rootNormal,
              eyeSpan *
                0.06 *
                Math.min(1, lengthScale) *
                (t + 0.5 * Math.sin(Math.PI * t)),
            );
          tangent
            .copy(flowRight)
            .multiplyScalar(strand.side * length * (1 - 0.11 * t))
            .addScaledVector(flowUp, rise - length * droop * 2 * t)
            .addScaledVector(
              flowForward,
              advance + length * 0.12 * Math.PI * Math.cos(Math.PI * t),
            )
            .normalize();
          }
          basisA.crossVectors(tangent, up).normalize();
          if (basisA.lengthSq() < 0.01)
            basisA.crossVectors(tangent, forward).normalize();
          basisB.crossVectors(tangent, basisA).normalize();
          const radius = strand.radius * Math.max(0.035, Math.pow(1 - t, 1.3));
          for (let side = 0; side < group.sides; side++) {
            const angle = (side / group.sides) * Math.PI * 2 + strand.phase;
            radial
              .copy(basisA)
              .multiplyScalar(Math.cos(angle))
              .addScaledVector(basisB, Math.sin(angle));
            const k =
              (s * (group.segments + 1) * group.sides +
                j * group.sides +
                side) *
              3;
            positions[k] = center.x + radial.x * radius;
            positions[k + 1] = center.y + radial.y * radius;
            positions[k + 2] = center.z + radial.z * radius;
            radial.toArray(normals, k);
          }
        }
      }
      group.mesh.geometry.attributes.position.needsUpdate = true;
      group.mesh.geometry.attributes.normal.needsUpdate = true;
      group.mesh.geometry.computeBoundingBox();
      group.mesh.geometry.computeBoundingSphere();
    }
  }
  update();
  return {
    meshes: groups.map((g) => g.mesh),
    update,
    snapshotMeshes: () =>
      groups
        .filter((group) => Number(group.mesh.userData.strandCount) > 0)
        .map(({ mesh, segments, sides }) => {
          const count = Number(mesh.userData.strandCount),
            vertices = (segments + 1) * sides * count;
          const geometry = new THREE.BufferGeometry();
          for (const name of ["position", "normal", "color"]) {
            const source = mesh.geometry.getAttribute(
              name,
            ) as THREE.BufferAttribute;
            geometry.setAttribute(
              name,
              new THREE.BufferAttribute(
                source.array.slice(0, vertices * source.itemSize),
                source.itemSize,
              ),
            );
          }
          geometry.setIndex(
            new THREE.BufferAttribute(
              mesh.geometry.index!.array.slice(0, count * segments * sides * 6),
              1,
            ),
          );
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
          const copy = new THREE.Mesh(geometry, mesh.material);
          copy.name = mesh.name;
          copy.userData = structuredClone(mesh.userData);
          return copy;
        }),
    dispose() {
      for (const { mesh } of groups) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}
