/**
 * Finite synthetic GPU measurement of the production ribbon MRT LOD path.
 * No cat/model assets, alternate shader, adaptive geometry, or optical oracle.
 * Call runFurLodOpticsFixture in a browser; bundle with the companion runner.
 */
import * as THREE from "three";
import {
  createCatFurMaterial,
  configureCatFurMaterial,
  getCatFurMaterialSettings,
} from "../../lib/cat-fur-material";

const SIZE = 256;
const STRANDS = 4096;
const SEGMENTS = 8;
const VERTICES = 18;
const INDICES = 96;
const SEED = 0x6f707469;

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function fingerprint(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function geometryFingerprint(geometry) {
  return {
    attributes: Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, a]) => [
        name,
        fingerprint(a.array),
      ]),
    ),
    index: fingerprint(geometry.index.array),
  };
}

function toBase64(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

function makeGeometry() {
  const random = randomSource(SEED);
  // One jittered root per equal-area cell, then one fixed shuffle. A prefix
  // is a deterministic spatially scattered subset, not a contiguous patch.
  const roots = [];
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      roots.push({
        x: ((x + 0.15 + 0.7 * random()) / 64 - 0.5) * 184,
        y: ((y + 0.15 + 0.7 * random()) / 64 - 0.5) * 184,
        length: 24 + 16 * random(),
        radius: 0.018 + 0.017 * random(),
      });
  for (let i = roots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [roots[i], roots[j]] = [roots[j], roots[i]];
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of [
    ["position", 3],
    ["normal", 3],
    ["color", 3],
    ["uv", 2],
    ["furWidth", 3],
  ])
    geometry.setAttribute(
      name,
      new THREE.Float32BufferAttribute(new Float32Array(STRANDS * VERTICES * size), size),
    );
  const indices = new Uint32Array(STRANDS * INDICES);
  for (let strand = 0; strand < STRANDS; strand++)
    for (let segment = 0; segment < SEGMENTS; segment++) {
      const a = strand * VERTICES + segment * 2;
      // Same complete two-sided strand block as production. Only the front
      // winding passes FrontSide culling; do not double the physical area.
      indices.set(
        [a, a + 1, a + 2, a + 1, a + 3, a + 2,
          a + 2, a + 1, a, a + 2, a + 3, a + 1],
        strand * INDICES + segment * 12,
      );
    }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, indices.length);
  function setAngle(degrees) {
    const theta = THREE.MathUtils.degToRad(degrees);
    const tangent = [Math.sin(theta), Math.cos(theta), 0];
    const transverse = [Math.cos(theta), -Math.sin(theta), 0];
    const a = geometry.attributes;
    roots.forEach((root, strand) => {
      for (let sample = 0; sample <= SEGMENTS; sample++) {
        const t = sample / SEGMENTS;
        const taper = Math.max(0.018, (1 - t) ** 0.65);
        const radius = root.radius * taper;
        const center = [
          root.x + tangent[0] * (t - 0.5) * root.length,
          root.y + tangent[1] * (t - 0.5) * root.length,
          0,
        ];
        for (let side = 0; side < 2; side++) {
          const v = strand * VERTICES + sample * 2 + side;
          a.position.setXYZ(
            v,
            center[0] + (2 * side - 1) * transverse[0] * radius,
            center[1] + (2 * side - 1) * transverse[1] * radius,
            0,
          );
          a.normal.setXYZ(v, 0, 0, 1);
          a.color.setXYZ(v, 0.5, 0.5, 0.5);
          a.uv.setXY(v, side, t);
          a.furWidth.setXYZ(v, transverse[0] * radius, transverse[1] * radius, 0);
        }
      }
    });
    for (const a of Object.values(geometry.attributes)) a.needsUpdate = true;
  }
  return { geometry, roots, setAngle };
}

function decodeReadback(raw) {
  const linear = new Float32Array(raw.length);
  const sum = [0, 0, 0, 0], min = [Infinity, Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity, -Infinity];
  let nonFiniteComponents = 0, nonzeroPixels = 0;
  for (let i = 0; i < raw.length; i += 4) {
    let nonzero = false;
    for (let c = 0; c < 4; c++) {
      const value = THREE.DataUtils.fromHalfFloat(raw[i + c]);
      linear[i + c] = value;
      sum[c] += value;
      min[c] = Math.min(min[c], value);
      max[c] = Math.max(max[c], value);
      if (!Number.isFinite(value)) nonFiniteComponents++;
      if (value !== 0) nonzero = true;
    }
    if (nonzero) nonzeroPixels++;
  }
  return {
    linear,
    stats: { sumRGBA: sum, minRGBA: min, maxRGBA: max, nonFiniteComponents,
      nonzeroPixels, rawHalfFNV1a32: fingerprint(raw) },
  };
}

function compare(actual, reference) {
  const attachments = [];
  for (let attachment = 0; attachment < 2; attachment++) {
    const a = actual.decoded[attachment], b = reference.decoded[attachment];
    const l1 = [0, 0, 0, 0], max = [0, 0, 0, 0];
    let changedHalfComponents = 0;
    for (let i = 0; i < a.linear.length; i++) {
      const c = i % 4, delta = Math.abs(a.linear[i] - b.linear[i]);
      l1[c] += delta;
      max[c] = Math.max(max[c], delta);
      if (actual.raw[attachment][i] !== reference.raw[attachment][i])
        changedHalfComponents++;
    }
    attachments.push({
      attachment,
      sumRatioRGBA: a.stats.sumRGBA.map((v, c) =>
        b.stats.sumRGBA[c] !== 0 ? v / b.stats.sumRGBA[c] : null),
      relativeSumBiasRGBA: a.stats.sumRGBA.map((v, c) =>
        b.stats.sumRGBA[c] !== 0 ? v / b.stats.sumRGBA[c] - 1 : null),
      normalizedPixelL1RGBA: l1.map((v, c) =>
        b.stats.sumRGBA[c] !== 0 ? v / Math.abs(b.stats.sumRGBA[c]) : null),
      maxPixelAbsDifferenceRGBA: max,
      changedHalfComponents,
    });
  }
  return { attachments };
}

export async function runFurLodOpticsFixture({ includeRaw = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.append(renderer.domElement);
  const gl = renderer.getContext();
  if (!renderer.extensions.has("EXT_color_buffer_float"))
    throw Error("Production MRT fixture needs EXT_color_buffer_float");
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    count: 2, type: THREE.HalfFloatType, depthBuffer: false,
    stencilBuffer: false, minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  for (const texture of target.textures) texture.colorSpace = THREE.NoColorSpace;
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  const camera = new THREE.OrthographicCamera(-128, 128, 128, -128, 0.1, 1000);
  camera.position.set(0, 0, 500);
  camera.lookAt(0, 0, 0);
  const material = createCatFurMaterial();
  const defaultSettings = getCatFurMaterialSettings(material);
  const data = makeGeometry();
  const mesh = new THREE.Mesh(data.geometry, material);
  mesh.frustumCulled = false;
  mesh.userData = {
    furRegion: "body", norwegianFur: true, strandSegments: SEGMENTS,
    strandVertices: VERTICES, strandIndices: INDICES,
    strandCount: STRANDS, capacity: STRANDS,
  };
  scene.add(mesh);
  let compiledUniforms;
  const productionCompile = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    productionCompile.call(this, shader, renderer);
    compiledUniforms = shader.uniforms;
  };
  const rows = [], angleFingerprints = {}, structuralFailures = [];
  const record = (condition, message) => { if (!condition) structuralFailures.push(message); };
  const maxRadius = Math.max(...data.roots.map(r => r.radius));
  const read = attachment => {
    const raw = new Uint16Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, raw, undefined, attachment);
    return raw;
  };
  const draw = (angle, detail, enabled, zero = false) => {
    const drawn = zero ? 0 : Math.floor(STRANDS * detail);
    data.geometry.setDrawRange(0, drawn * INDICES);
    configureCatFurMaterial(material, {
      coatType: "long", detailLevel: detail, sampling: true,
      renderPass: "accumulation", opaqueDepth: null,
      coverageFilter: "legacy", volumeReplacement: false,
      opticalLodCompensation: enabled,
    });
    const settings = getCatFurMaterialSettings(material);
    if (settings.opticalLodCompensation !== enabled)
      throw Error("Production opticalLodCompensation API is unavailable or did not retain its requested value");
    renderer.setRenderTarget(target);
    renderer.setClearColor(0, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    const framebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    const raw = [read(0), read(1)], decoded = raw.map(decodeReadback);
    const widthLodScale = compiledUniforms?.catFurLodScale?.value;
    const opticalWeight = compiledUniforms?.catFurOpticalLodScale?.value;
    const rawAlphaUpperBound = Math.min(1, maxRadius * widthLodScale / 0.45);
    const opticalAlphaUpperBound = enabled
      ? 1 - (1 - rawAlphaUpperBound) ** opticalWeight : rawAlphaUpperBound;
    const errors = [];
    for (let i = 0; i < 16; i++) {
      const error = gl.getError();
      if (!error) break;
      errors.push(error);
    }
    let sumTransmittance = 0, sumResolvedOpacity = 0;
    for (let i = 0; i < decoded[1].linear.length; i += 4) {
      const transmittance = Math.exp(-decoded[1].linear[i]);
      sumTransmittance += transmittance;
      sumResolvedOpacity += 1 - transmittance;
    }
    const frame = {
      id: `${zero ? "zero" : "coat"}-angle${angle}-d${detail}-${enabled ? "on" : "off"}`,
      angleDegrees: angle, detailRequested: detail, opticalLodCompensation: enabled,
      actualDrawnStrands: data.geometry.drawRange.count / INDICES,
      actualDrawRange: { ...data.geometry.drawRange },
      materialSettings: settings,
      actualLODWidthScale: widthLodScale,
      actualOpticalWeight: opticalWeight,
      requestedOpticalWeight: enabled ? 1 / (detail * widthLodScale) : 1,
      actualLodUniforms: Object.fromEntries(Object.entries(compiledUniforms ?? {})
        .filter(([k]) => /catFur.*(Lod|Optical)/.test(k)).map(([k, v]) => [k, v.value])),
      rawLegacyFragmentAlphaUpperBound: rawAlphaUpperBound,
      compensatedFragmentAlphaUpperBound: opticalAlphaUpperBound,
      singleFragmentLogClampPossibleAtThisBound: opticalAlphaUpperBound >= 0.9999,
      fragmentClampHitCount: null,
      attachments: decoded.map((x, attachment) => ({ attachment, ...x.stats })),
      meanTransmittance: sumTransmittance / (SIZE * SIZE),
      sumResolvedOpacity,
      sumPremultipliedRGBOverSumAlpha: decoded[0].stats.sumRGBA.slice(0, 3)
        .map(v => decoded[0].stats.sumRGBA[3] > 0 ? v / decoded[0].stats.sumRGBA[3] : null),
      geometryFingerprint: geometryFingerprint(data.geometry),
      rendererInfo: { ...renderer.info.render },
      framebufferStatus, framebufferComplete: framebufferStatus === gl.FRAMEBUFFER_COMPLETE,
      glErrors: errors,
      materialState: { transparent: material.transparent, depthWrite: material.depthWrite,
        alphaToCoverage: material.alphaToCoverage, blending: material.blending,
        blendSrc: material.blendSrc, blendDst: material.blendDst,
        blendEquation: material.blendEquation },
    };
    record(frame.actualDrawnStrands === drawn, `${frame.id}: wrong complete-strand draw prefix`);
    record(Math.abs(widthLodScale - Math.min(2.4, 1 / Math.sqrt(detail))) <= 1e-12,
      `${frame.id}: unexpected configured width LOD scale`);
    record(Math.abs(opticalWeight - (enabled ? 1 / (detail * widthLodScale) : 1)) <= 1e-12,
      `${frame.id}: unexpected configured optical LOD weight`);
    record(frame.framebufferComplete && !errors.length, `${frame.id}: framebuffer/GL error`);
    record(decoded.every(x => x.stats.nonFiniteComponents === 0), `${frame.id}: nonfinite readback`);
    record(decoded[1].stats.minRGBA.slice(1).every(v => v === 0)
      && decoded[1].stats.maxRGBA.slice(1).every(v => v === 0),
      `${frame.id}: optical-depth attachment has nonzero unused GBA channels`);
    record(JSON.stringify(frame.geometryFingerprint) === JSON.stringify(angleFingerprints[angle]),
      `${frame.id}: LOD/optical toggle mutated physical attributes or index`);
    record(!material.depthWrite && !material.alphaToCoverage
      && material.blending === THREE.CustomBlending
      && material.blendSrc === THREE.OneFactor && material.blendDst === THREE.OneFactor,
      `${frame.id}: not production ONE/ONE MRT state`);
    if (zero)
      record(decoded.every(x => x.stats.nonzeroPixels === 0), `${frame.id}: zero draw produced nonzero attachment`);
    else record(decoded.every(x => x.stats.nonzeroPixels > 0), `${frame.id}: coat attachment empty`);
    if (includeRaw) frame.rawHalfBase64 = raw.map(toBase64);
    return { frame, raw, decoded };
  };
  try {
    record(defaultSettings.opticalLodCompensation === false,
      "Fresh production material did not default opticalLodCompensation to false");
    for (const angle of [0, 30]) {
      data.setAngle(angle);
      angleFingerprints[angle] = geometryFingerprint(data.geometry);
      let fullReference;
      for (const detail of [1, 0.5, 0.25])
        for (const enabled of [false, true]) {
          const actual = draw(angle, detail, enabled);
          if (detail === 1 && !enabled) fullReference = actual;
          actual.frame.vsOwnAngleFullOff = compare(actual, fullReference);
          if (detail === 1 && enabled)
            record(actual.frame.vsOwnAngleFullOff.attachments.every(a => a.changedHalfComponents === 0),
              `angle${angle}: d1 toggle changed raw half-float attachment`);
          rows.push(actual.frame);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    for (const enabled of [false, true]) rows.push(draw(30, 0.25, enabled, true).frame);
    const comparisons = [];
    for (const angle of [0, 30])
      for (const detail of [0.5, 0.25]) {
        const pair = rows.filter(r => r.angleDegrees === angle && r.detailRequested === detail
          && r.actualDrawnStrands > 0);
        const off = pair.find(r => !r.opticalLodCompensation), on = pair.find(r => r.opticalLodCompensation);
        const channel = (r, attachment, c) => r.vsOwnAngleFullOff.attachments[attachment].relativeSumBiasRGBA[c];
        comparisons.push({
          angleDegrees: angle, detail,
          opticalDepthSum: { offRelativeBias: channel(off, 1, 0), onRelativeBias: channel(on, 1, 0),
            absoluteBiasReduced: Math.abs(channel(on, 1, 0)) < Math.abs(channel(off, 1, 0)) },
          alphaSum: { offRelativeBias: channel(off, 0, 3), onRelativeBias: channel(on, 0, 3) },
          premultipliedRGBSum: { offRelativeBias: [0, 1, 2].map(c => channel(off, 0, c)),
            onRelativeBias: [0, 1, 2].map(c => channel(on, 0, c)) },
          meanTransmittance: { off: off.meanTransmittance, on: on.meanTransmittance },
        });
      }
    const programs = renderer.info.programs.map(p => ({
      name: p.name, runnable: p.diagnostics?.runnable ?? true,
      programLog: p.diagnostics?.programLog ?? "",
    }));
    record(programs.length > 0 && programs.every(p => p.runnable), "Production shader compilation failed");
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      version: 1, status: "measured-synthetic-production-MRT-LOD-optics-not-visual-acceptance",
      structuralChecksPass: structuralFailures.length === 0, structuralFailures,
      fixture: { strands: STRANDS, segments: SEGMENTS, verticesPerStrand: VERTICES,
        indicesPerStrand: INDICES, seed: SEED, resolution: [SIZE, SIZE],
        layout: "64x64 equal-area jittered cells followed by one deterministic shuffle; same buffer prefixes",
        orientation: "0/30deg screen-plane hair orientation; root positions and fixed orthographic camera unchanged",
        rootBounds: [-92, 92], strandLengthPixels: [24, 40], physicalRootRadiusPixels: [0.018, 0.035],
        taper: "max(.018,(1-t)^.65)", opacity: material.opacity, filter: "legacy",
        color: "constant scene-linear [.5,.5,.5], unchanged ambient illumination",
        attachmentFormat: "RGBA16F/half-float, nonpremultiplied input; production additive premultiplied output",
        attachment0: "sum of premultiplied linear RGB, sum alpha",
        attachment1: "red=sum[-log(max(1-alpha,.0001))], GBA zero",
        units: "orthographic1 scene unit=1pixel at256x256; synthetic, not animal density",
      },
      numericalPolicy: {
        hardChecks: "actual whole-strand prefix, unchanged physical attrs/index, finite/GL/FBO, zero-draw exact zero, d1-toggle raw exact, actual configured LOD scale, MRT state",
        opticalAccuracyThreshold: null,
        opticalAssessment: "Report measured off/on bias and pixel L1 per angle without predeclaring improvement or acceptance; no threshold selected to make a pass.",
        nonlinearity: "-log(1-s*alpha) is not s*-log(1-alpha); reciprocal d*s is an approximate thin-coverage total-tau budget compensation.",
      },
      limits: [
        "Sum optical depth is an integrated image-space budget, not conservation of mean transmittance or resolved pixel coverage. exp(-tau) is nonlinear and thinning rearranges overlap.",
        "Every angle uses its own d1/off baseline; no claim that differently projected angles share identical sums.",
        "Half-float accumulation/readback, raster aliasing, representative width expansion, taper and sparse prefixes contribute measurable error. Raw readbacks are retained by the runner.",
        "No BSDF/path-tracing ground truth, skin/shell occlusion, real cat geometry, perspective/poses or temporal sampling covered; real viewport A/B remains necessary.",
        "Fixture tests production ribbons with legacy coverage; segment backend, MSAA preview and portable GLB are outside these optical accuracy measurements.",
      ],
      defaultSettings, angleFingerprints, rows, comparisons, programs,
      readbackByteOrder: new Uint8Array(Uint16Array.of(0x0102).buffer)[0] === 2
        ? "little-endian" : "big-endian",
      gpu: { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
        unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        actualTargetSamples: target.samples, samples: gl.getParameter(gl.SAMPLES) },
    };
  } finally {
    renderer.setRenderTarget(null);
    target.dispose();
    data.geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
}
