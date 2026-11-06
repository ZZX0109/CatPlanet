import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import {
  createCatFurMaterial,
  configureCatFurMaterial,
  createCatFurExportMaterial,
} from "../../lib/cat-fur-material";
import { createCatFurSegmentPreview } from "../../lib/cat-fur-segments";
const mean = (a) => a.reduce((s, n) => s + n, 0) / Math.max(1, a.length);
function createRenderer() {
  const canvas = document.createElement("canvas"),
    context = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
    });
  if (!context) throw Error("No WebGL2");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    alpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(256, 256);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.append(canvas);
  return renderer;
}
function diagnostics(renderer) {
  const gl = renderer.getContext();
  return {
    error: gl.getError(),
    samples: gl.getParameter(gl.SAMPLES),
    programs: renderer.info.programs.map((p) => ({
      name: p.name,
      runnable: p.diagnostics?.runnable ?? true,
      programLog: p.diagnostics?.programLog ?? "",
    })),
  };
}
export async function runFurFilterFixture() {
  const renderer = createRenderer(),
    scene = new THREE.Scene(),
    camera = new THREE.OrthographicCamera(-128, 128, 128, -128, 0.1, 1000),
    target = new THREE.WebGLRenderTarget(256, 256, {
      count: 2,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  camera.position.set(0, 0, 500);
  camera.lookAt(0, 0, 0);
  const material = createCatFurMaterial();
  configureCatFurMaterial(material, {
    coatType: "long",
    detailLevel: 1,
    sampling: true,
    renderPass: "accumulation",
    opaqueDepth: null,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(18 * 3), 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(new Float32Array(18 * 3), 3),
  );
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(new Float32Array(18 * 3).fill(1), 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(new Float32Array(18 * 2), 2),
  );
  geometry.setAttribute(
    "furWidth",
    new THREE.Float32BufferAttribute(new Float32Array(18 * 3), 3),
  );
  const sourceIndices = [];
  for (let i = 0; i < 8; i++) {
    const a = i * 2;
    sourceIndices.push(
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
    );
  }
  geometry.setIndex(sourceIndices);
  geometry.setDrawRange(0, 96);
  geometry.setAttribute(
    "furFilterAxis",
    new THREE.BufferAttribute(new Int8Array(18).fill(1), 1),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData = {
    furRegion: "test",
    norwegianFur: true,
    strandSegments: 8,
    strandVertices: 18,
    strandIndices: 96,
    strandCount: 1,
    capacity: 1,
  };
  scene.add(mesh);
  const preview = createCatFurSegmentPreview(mesh);
  scene.add(preview.mesh);
  let activeFilter = "legacy",
    lastBackend = null;
  const backendChecks = [];
  function setFilter(value) {
    activeFilter = value;
    configureCatFurMaterial(material, { coverageFilter: value });
  }
  const projections = [
    { id: "0", angle: 0, tilt: 0, roll: 0, scale: [1, 1, 1] },
    { id: "15", angle: 15, tilt: 0, roll: 0, scale: [1, 1, 1] },
    { id: "45", angle: 45, tilt: 0, roll: 0, scale: [1, 1, 1] },
    { id: "90", angle: 90, tilt: 0, roll: 0, scale: [1, 1, 1] },
    { id: "oblique", angle: 30, tilt: 45, roll: 65, scale: [1, 1, 1] },
    {
      id: "nonuniform-oblique",
      angle: 35,
      tilt: 35,
      roll: 55,
      scale: [1.6, 0.65, 1.2],
    },
    {
      id: "negative-scale-oblique",
      angle: 35,
      tilt: 35,
      roll: 55,
      scale: [-1.6, 0.65, 1.2],
    },
  ];
  const buffers = [
      new Uint16Array(256 * 256 * 4),
      new Uint16Array(256 * 256 * 4),
    ],
    rows = [],
    groups = [],
    cpuChecks = [],
    exports = [],
    fallbacks = [],
    referenceGroups = [],
    referenceConvergence = [];
  const opticalDepthBuffer = new Uint16Array(256 * 256 * 4);
  let pixelsRead = 0;
  const percentile = (a, p) =>
    [...a].sort((x, y) => x - y)[
      Math.min(a.length - 1, Math.ceil(a.length * p) - 1)
    ];
  function clip(poly, axis, bound, greater) {
    const result = [];
    let previous = poly.at(-1),
      insidePrevious = greater
        ? previous[axis] >= bound
        : previous[axis] <= bound;
    for (const point of poly) {
      const inside = greater ? point[axis] >= bound : point[axis] <= bound;
      if (inside !== insidePrevious) {
        const u = (bound - previous[axis]) / (point[axis] - previous[axis]);
        result.push([
          previous[0] + (point[0] - previous[0]) * u,
          previous[1] + (point[1] - previous[1]) * u,
        ]);
      }
      if (inside) result.push(point);
      previous = point;
      insidePrevious = inside;
    }
    return result;
  }
  function pixelArea(poly, x, y) {
    let p = clip(poly, 0, x, true);
    if (!p.length) return 0;
    p = clip(p, 0, x + 1, false);
    if (!p.length) return 0;
    p = clip(p, 1, y, true);
    if (!p.length) return 0;
    p = clip(p, 1, y + 1, false);
    if (!p.length) return 0;
    let a = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++)
      a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
    return Math.abs(a) * 0.5;
  }
  function makeReference(radius, setup, phase, kernel, samples = 64) {
    const result = new Float32Array(256 * 256),
      n = setup.normal,
      t = { x: -n.y, y: n.x },
      length = setup.projectedLength;
    const paint = (offset, weight) => {
      const center = { x: n.x * (phase + offset), y: n.y * (phase + offset) },
        poly = [
          [-1, -1],
          [-1, 1],
          [1, 1],
          [1, -1],
        ].map(([u, v]) => [
          center.x + t.x * u * length * 0.5 + n.x * v * radius,
          center.y + t.y * u * length * 0.5 + n.y * v * radius,
        ]),
        minX = Math.max(
          0,
          Math.floor(Math.min(...poly.map((p) => p[0])) + 128),
        ),
        maxX = Math.min(
          255,
          Math.floor(Math.max(...poly.map((p) => p[0])) + 128),
        ),
        minY = Math.max(
          0,
          Math.floor(Math.min(...poly.map((p) => p[1])) + 128),
        ),
        maxY = Math.min(
          255,
          Math.floor(Math.max(...poly.map((p) => p[1])) + 128),
        ),
        normalHalf = 0.5 * (Math.abs(n.x) + Math.abs(n.y)),
        tangentHalf = 0.5 * (Math.abs(t.x) + Math.abs(t.y));
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const dx = x + 0.5 - 128 - center.x,
            dy = y + 0.5 - 128 - center.y;
          if (
            Math.abs(dx * n.x + dy * n.y) > radius + normalHalf ||
            Math.abs(dx * t.x + dy * t.y) > length * 0.5 + tangentHalf
          )
            continue;
          result[y * 256 + x] += pixelArea(poly, x - 128, y - 128) * weight;
        }
    };
    if (kernel === "box") paint(0, 1);
    else
      for (let i = 0; i < samples; i++)
        paint(((i + 0.5) / samples - 0.5) * 0.6, 1 / samples);
    return result;
  }
  function aliasStatic(gpu, reference, area) {
    let total = 0;
    for (let p = 0; p < reference.length; p++) {
      if (!gpu[p * 4 + 3] && !reference[p]) continue;
      total += Math.abs(
        THREE.DataUtils.fromHalfFloat(gpu[p * 4 + 3]) - reference[p],
      );
    }
    return total / area;
  }
  function aliasMotion(previous, current, a, b, area) {
    let total = 0;
    for (let p = 0; p < a.length; p++) {
      if (!previous[p * 4 + 3] && !current[p * 4 + 3] && !a[p] && !b[p])
        continue;
      total += Math.abs(
        THREE.DataUtils.fromHalfFloat(current[p * 4 + 3]) -
          THREE.DataUtils.fromHalfFloat(previous[p * 4 + 3]) -
          (b[p] - a[p]),
      );
    }
    return total / area;
  }
  function shape(radius, projection) {
    const angle = THREE.MathUtils.degToRad(projection.angle),
      tilt = THREE.MathUtils.degToRad(projection.tilt),
      roll = THREE.MathUtils.degToRad(projection.roll),
      scale = new THREE.Vector3(...projection.scale),
      t = new THREE.Vector3(
        Math.sin(angle) * Math.cos(tilt),
        Math.cos(angle) * Math.cos(tilt),
        Math.sin(tilt),
      ),
      w = new THREE.Vector3(
        Math.cos(angle),
        -Math.sin(angle),
        0,
      ).applyAxisAngle(t, roll),
      n = new THREE.Vector3().crossVectors(w, t).normalize(),
      tw = t.clone().multiply(scale),
      length = 160 / Math.hypot(tw.x, tw.y),
      half = radius / w.clone().multiply(scale).length(),
      width = w.clone().multiplyScalar(half),
      a = geometry.attributes;
    for (let sample = 0; sample <= 8; sample++)
      for (let side = 0; side < 2; side++) {
        const point = t
            .clone()
            .multiplyScalar((sample / 8 - 0.5) * length)
            .addScaledVector(width, side === 0 ? -1 : 1),
          i = sample * 2 + side;
        a.position.setXYZ(i, point.x, point.y, point.z);
        a.normal.setXYZ(i, n.x, n.y, n.z);
        a.furWidth.setXYZ(i, width.x, width.y, width.z);
        a.uv.setXY(i, side, sample / 8);
      }
    for (const name of ["position", "normal", "furWidth", "uv"])
      a[name].needsUpdate = true;
    mesh.scale.copy(scale);
    mesh.position.set(0, 0, 0);
    const normal = new THREE.Vector2(tw.y, -tw.x).normalize();
    return {
      normal,
      expectedArea: 2 * radius * 160,
      projectedLength: 160,
      physicalRadius: radius,
      cpu: Object.fromEntries(
        ["position", "normal", "furWidth"].map((name) => [
          name,
          Array.from(a[name].array),
        ]),
      ),
    };
  }
  function draw(buffer, phase, normal, forceRibbon = false, longitudinal = 0) {
    mesh.position.set(
      normal.x * phase - normal.y * longitudinal,
      normal.y * phase + normal.x * longitudinal,
      0,
    );
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    mesh.visible = activeFilter === "legacy" || forceRibbon;
    preview.mesh.visible = false;
    if (!mesh.visible) {
      preview.sync();
      if (!preview.mesh.matrix.equals(mesh.matrix))
        throw Error("Proxy failed to follow source transform");
      lastBackend = { mode: "segments", ...preview.getInfo() };
    } else lastBackend = { mode: "ribbons" };
    renderer.setRenderTarget(target);
    renderer.setClearColor(0, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(
      target,
      0,
      0,
      256,
      256,
      buffer,
      undefined,
      0,
    );
    renderer.readRenderTargetPixels(
      target,
      0,
      0,
      256,
      256,
      opticalDepthBuffer,
      undefined,
      1,
    );
    pixelsRead++;
    let alpha = 0,
      energy = 0,
      resolvedCoverage = 0,
      resolvedWhiteEnergy = 0;
    for (let i = 0; i < buffer.length; i += 4) {
      if (!buffer[i + 3]) continue;
      alpha += THREE.DataUtils.fromHalfFloat(buffer[i + 3]);
      const premultiplied =
        (THREE.DataUtils.fromHalfFloat(buffer[i]) +
          THREE.DataUtils.fromHalfFloat(buffer[i + 1]) +
          THREE.DataUtils.fromHalfFloat(buffer[i + 2])) /
        3;
      energy += premultiplied;
      const opacity =
        1 - Math.exp(-THREE.DataUtils.fromHalfFloat(opticalDepthBuffer[i]));
      resolvedCoverage += opacity;
      resolvedWhiteEnergy +=
        (premultiplied / THREE.DataUtils.fromHalfFloat(buffer[i + 3])) *
        opacity;
    }
    return { alpha, energy, resolvedCoverage, resolvedWhiteEnergy };
  }
  function delta(a, b, expectedEnergy) {
    let difference = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (!a[i + 3] && !b[i + 3]) continue;
      for (let c = 0; c < 3; c++)
        difference +=
          Math.abs(
            THREE.DataUtils.fromHalfFloat(a[i + c]) -
              THREE.DataUtils.fromHalfFloat(b[i + c]),
          ) / 3;
    }
    return difference / expectedEnergy;
  }
  try {
    setFilter("box");
    const calibrationShape = shape(4, projections[0]),
      calibration = draw(buffers[0], 0.31, calibrationShape.normal),
      whitePerArea = calibration.energy / calibration.alpha;
    for (const radius of [0.03, 0.07, 0.15, 0.4, 1])
      for (const projection of projections) {
        const setup = shape(radius, projection),
          referenceMaps = {};
        if (
          [0.03, 0.15, 1].includes(radius) &&
          ["0", "45", "nonuniform-oblique"].includes(projection.id)
        ) {
          for (const kind of ["box", "compact"])
            referenceMaps[kind] = Array.from({ length: 17 }, (_, i) =>
              makeReference(radius, setup, i / 16, kind),
            );
          const a = makeReference(radius, setup, 0.3125, "compact", 32),
            b = referenceMaps.compact[5];
          let l1 = 0;
          for (let i = 0; i < a.length; i++) l1 += Math.abs(a[i] - b[i]);
          referenceConvergence.push({
            radius,
            projection: projection.id,
            samples: [32, 64],
            normalizedL1: l1 / setup.expectedArea,
          });
        }

        for (const filter of ["legacy", "box", "compact"]) {
          setFilter(filter);
          const phaseRows = [];
          let previous, previousRow;
          for (let phaseIndex = 0; phaseIndex <= 16; phaseIndex++) {
            const buffer = buffers[phaseIndex % 2],
              phase = phaseIndex / 16,
              frame = draw(buffer, phase, setup.normal);
            const row = {
              kind: "straight",
              filter,
              radius,
              projection: projection.id,
              modelScale: projection.scale,
              phase,
              ...frame,
              expectedArea: setup.expectedArea,
              whitePerArea,
              areaBias: frame.alpha / setup.expectedArea - 1,
              whiteEnergyBias:
                frame.energy / (setup.expectedArea * whitePerArea) - 1,
            };
            row.alias = {};
            for (const kind of filter === "legacy"
              ? ["box", "compact"]
              : [filter])
              if (referenceMaps[kind])
                row.alias[kind] = {
                  staticL1: aliasStatic(
                    buffer,
                    referenceMaps[kind][phaseIndex],
                    setup.expectedArea,
                  ),
                };
            if (previous) {
              previousRow.jitterL1 = delta(
                previous,
                buffer,
                setup.expectedArea * whitePerArea,
              );
              for (const kind of Object.keys(previousRow.alias))
                previousRow.alias[kind].residualL1 = aliasMotion(
                  previous,
                  buffer,
                  referenceMaps[kind][phaseIndex - 1],
                  referenceMaps[kind][phaseIndex],
                  setup.expectedArea,
                );
              rows.push(previousRow);
              phaseRows.push(previousRow);
            }
            previous = buffer;
            previousRow = row;
          }
          groups.push({
            kind: "straight",
            filter,
            radius,
            projection: projection.id,
            meanL1: mean(phaseRows.map((r) => r.jitterL1)),
            p95L1: percentile(
              phaseRows.map((r) => r.jitterL1),
              0.95,
            ),
            maxL1: Math.max(...phaseRows.map((r) => r.jitterL1)),
            maxAreaBias: Math.max(
              ...phaseRows.map((r) => Math.abs(r.areaBias)),
            ),
            maxWhiteEnergyBias: Math.max(
              ...phaseRows.map((r) => Math.abs(r.whiteEnergyBias)),
            ),
          });
          for (const kind of filter === "legacy"
            ? ["box", "compact"]
            : [filter])
            if (referenceMaps[kind])
              referenceGroups.push({
                filter,
                reference: kind,
                radius,
                projection: projection.id,
                meanStaticL1: mean(
                  phaseRows.map((r) => r.alias[kind].staticL1),
                ),
                p95StaticL1: percentile(
                  phaseRows.map((r) => r.alias[kind].staticL1),
                  0.95,
                ),
                meanResidualL1: mean(
                  phaseRows.map((r) => r.alias[kind].residualL1),
                ),
                p95ResidualL1: percentile(
                  phaseRows.map((r) => r.alias[kind].residualL1),
                  0.95,
                ),
              });
          backendChecks.push({
            kind: "straight",
            filter,
            radius,
            projection: projection.id,
            ...lastBackend,
          });
          cpuChecks.push({
            filter,
            radius,
            projection: projection.id,
            unchanged: ["position", "normal", "furWidth"].every((name) =>
              Array.from(geometry.attributes[name].array).every(
                (value, i) => value === setup.cpu[name][i],
              ),
            ),
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    const fallbackShape = shape(0.07, projections.at(-1));
    setFilter("legacy");
    const referenceFallback = draw(buffers[0], 0.3125, fallbackShape.normal);
    const referencePixels = buffers[0].slice();
    for (const axis of ["missing", "zero"]) {
      if (axis === "missing") geometry.deleteAttribute("furFilterAxis");
      else
        geometry.setAttribute(
          "furFilterAxis",
          new THREE.BufferAttribute(new Int8Array(18), 1),
        );
      for (const filter of ["box", "compact"]) {
        setFilter(filter);
        const frame = draw(buffers[1], 0.3125, fallbackShape.normal, true);
        let changed = 0;
        for (let i = 0; i < referencePixels.length; i++)
          if (referencePixels[i] !== buffers[1][i]) changed++;
        fallbacks.push({
          axis,
          filter,
          changed,
          ...frame,
          reference: referenceFallback,
        });
      }
    }
    geometry.setAttribute(
      "furFilterAxis",
      new THREE.BufferAttribute(new Int8Array(18).fill(1), 1),
    );
    shape(1, projections.at(-1));
    for (const filter of ["legacy", "box", "compact"]) {
      setFilter(filter);
      const exportGeometry = geometry.clone();
      exportGeometry.deleteAttribute("furWidth");
      exportGeometry.deleteAttribute("furFilterAxis");
      const exportMaterial = createCatFurExportMaterial(material),
        snapshot = new THREE.Mesh(exportGeometry, exportMaterial);
      snapshot.name = "FilterWidthSnapshot";
      snapshot.position.copy(mesh.position);
      snapshot.scale.copy(mesh.scale);
      const bytes = await new GLTFExporter().parseAsync(snapshot, {
          binary: true,
        }),
        loaded = await new GLTFLoader().parseAsync(bytes, "");
      loaded.scene.updateMatrixWorld(true);
      let restored;
      loaded.scene.traverse((m) => {
        if (m.isMesh) restored = m;
      });
      const source = geometry.attributes.position,
        actual = restored.geometry.attributes.position,
        left = restored
          .getVertexPosition(0, new THREE.Vector3())
          .applyMatrix4(restored.matrixWorld),
        right = restored
          .getVertexPosition(1, new THREE.Vector3())
          .applyMatrix4(restored.matrixWorld);
      exports.push({
        filter,
        bytes: bytes.byteLength,
        positionEqual: Array.from(actual.array).every(
          (v, i) => v === source.array[i],
        ),
        worldHalfWidth: left.distanceTo(right) / 2,
        standard: restored.material.isMeshStandardMaterial,
        widthAttribute: !!restored.geometry.attributes.furWidth,
      });
      exportGeometry.dispose();
      exportMaterial.dispose();
      loaded.scene.traverse((m) => {
        if (m.isMesh) {
          m.geometry.dispose();
          for (const mat of Array.isArray(m.material)
            ? m.material
            : [m.material])
            mat.dispose();
        }
      });
    }
    const curveGeometry = new THREE.BufferGeometry(),
      curvePositions = new Float32Array(18 * 3),
      curveNormals = new Float32Array(18 * 3),
      curveWidths = new Float32Array(18 * 3),
      curveUV = new Float32Array(18 * 2),
      curveIndices = [];
    curveGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(curvePositions, 3),
    );
    curveGeometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(curveNormals, 3),
    );
    curveGeometry.setAttribute(
      "furWidth",
      new THREE.BufferAttribute(curveWidths, 3),
    );
    curveGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(18 * 3).fill(1), 3),
    );
    curveGeometry.setAttribute("uv", new THREE.BufferAttribute(curveUV, 2));
    curveGeometry.setAttribute(
      "furFilterAxis",
      new THREE.BufferAttribute(new Int8Array(18).fill(1), 1),
    );
    for (let k = 0; k < 8; k++) {
      const a = k * 2;
      curveIndices.push(
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
      );
    }
    curveGeometry.setIndex(curveIndices);
    curveGeometry.setDrawRange(0, 96);
    mesh.geometry = curveGeometry;
    mesh.scale.set(1, 1, 1);
    try {
      for (const kind of [
        "short-line",
        "medium-line",
        "short-bend",
        "micro-curl",
      ])
        for (const angle of [0, 45])
          for (const radius of [0.03, 0.15, 0.4])
            for (const longitudinal of [0, 0.25, 0.5, 0.75]) {
              const theta = THREE.MathUtils.degToRad(angle),
                rotation = new THREE.Quaternion().setFromAxisAngle(
                  new THREE.Vector3(0, 0, 1),
                  theta,
                ),
                centers = [];
              let projectedLength = 0;
              for (let sample = 0; sample <= 8; sample++) {
                const t = sample / 8,
                  length = ["medium-line", "short-bend"].includes(kind) ? 8 : 4,
                  x = kind.endsWith("line")
                    ? 0
                    : kind === "short-bend"
                      ? 0.35 * Math.sin(Math.PI * t) +
                        0.1 * Math.sin(2 * Math.PI * t)
                      : 0.35 * Math.sin(2 * Math.PI * t),
                  dx = kind.endsWith("line")
                    ? 0
                    : kind === "short-bend"
                      ? 0.35 * Math.PI * Math.cos(Math.PI * t) +
                        0.2 * Math.PI * Math.cos(2 * Math.PI * t)
                      : 0.7 * Math.PI * Math.cos(2 * Math.PI * t),
                  center = new THREE.Vector3(
                    x,
                    (t - 0.5) * length,
                    0,
                  ).applyQuaternion(rotation),
                  tangent = new THREE.Vector3(dx, length, 0)
                    .normalize()
                    .applyQuaternion(rotation),
                  w = new THREE.Vector3(
                    tangent.y,
                    -tangent.x,
                    0,
                  ).multiplyScalar(radius);
                centers.push(center);
                if (sample)
                  projectedLength += center.distanceTo(centers[sample - 1]);
                for (let side = 0; side < 2; side++) {
                  const i = sample * 2 + side,
                    p = center.clone().addScaledVector(w, side === 0 ? -1 : 1);
                  curvePositions.set(p.toArray(), i * 3);
                  curveNormals.set([0, 0, 1], i * 3);
                  curveWidths.set(w.toArray(), i * 3);
                  curveUV.set([side, t], i * 2);
                }
              }
              for (const name of ["position", "normal", "furWidth", "uv"])
                curveGeometry.attributes[name].needsUpdate = true;
              const normal = new THREE.Vector2(
                  Math.cos(theta),
                  Math.sin(theta),
                ),
                expectedArea = 2 * radius * projectedLength,
                before = Object.fromEntries(
                  ["position", "normal", "furWidth"].map((name) => [
                    name,
                    Array.from(curveGeometry.attributes[name].array),
                  ]),
                );
              for (const filter of ["legacy", "box", "compact"]) {
                setFilter(filter);
                const phaseRows = [];
                let previous, previousRow;
                for (let phaseIndex = 0; phaseIndex <= 16; phaseIndex++) {
                  const buffer = buffers[phaseIndex % 2],
                    phase = phaseIndex / 16,
                    frame = draw(buffer, phase, normal, false, longitudinal),
                    row = {
                      kind,
                      filter,
                      radius,
                      projection: String(angle),
                      phase,
                      longitudinal,
                      ...frame,
                      expectedArea,
                      projectedLength,
                      segments: 8,
                      whitePerArea,
                      areaBias: frame.alpha / expectedArea - 1,
                      whiteEnergyBias:
                        frame.energy / (expectedArea * whitePerArea) - 1,
                    };
                  if (
                    kind.endsWith("line") &&
                    filter !== "legacy" &&
                    longitudinal === 0
                  )
                    row.referenceStaticL1 = aliasStatic(
                      buffer,
                      makeReference(
                        radius,
                        { normal, projectedLength },
                        phase,
                        filter,
                      ),
                      expectedArea,
                    );
                  if (previous) {
                    previousRow.jitterL1 = delta(
                      previous,
                      buffer,
                      expectedArea * whitePerArea,
                    );
                    rows.push(previousRow);
                    phaseRows.push(previousRow);
                  }
                  previous = buffer;
                  previousRow = row;
                }
                groups.push({
                  kind,
                  filter,
                  radius,
                  projection: String(angle),
                  longitudinal,
                  meanL1: mean(phaseRows.map((r) => r.jitterL1)),
                  p95L1: percentile(
                    phaseRows.map((r) => r.jitterL1),
                    0.95,
                  ),
                  maxL1: Math.max(...phaseRows.map((r) => r.jitterL1)),
                  maxAreaBias: Math.max(
                    ...phaseRows.map((r) => Math.abs(r.areaBias)),
                  ),
                  maxWhiteEnergyBias: Math.max(
                    ...phaseRows.map((r) => Math.abs(r.whiteEnergyBias)),
                  ),
                });
                backendChecks.push({
                  kind,
                  filter,
                  radius,
                  projection: String(angle),
                  longitudinal,
                  ...lastBackend,
                });
                cpuChecks.push({
                  kind,
                  filter,
                  radius,
                  projection: String(angle),
                  longitudinal,
                  unchanged: ["position", "normal", "furWidth"].every((name) =>
                    Array.from(curveGeometry.attributes[name].array).every(
                      (v, i) => v === before[name][i],
                    ),
                  ),
                });
              }
            }
    } finally {
      mesh.geometry = geometry;
      curveGeometry.dispose();
    }
    return {
      rows,
      groups,
      cpuChecks,
      exports,
      backendChecks,
      fallbacks,
      referenceGroups,
      referenceConvergence,
      referenceMethod:
        "Independent CPU Sutherland-Hodgman polygon/pixel clipping; compact averages 64 physical normal offsets over [-.3,.3], with 32/64 convergence check. Motion residual removes exact reference phase-to-phase change; raw white L1 remains in every row.",
      calibration: { ...calibration, whitePerArea },
      pixelsRead,
      diagnostics: diagnostics(renderer),
    };
  } finally {
    renderer.setRenderTarget(null);
    preview.dispose();
    geometry.dispose();
    material.dispose();
    target.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
}
