import * as THREE from "three";
import type { CatCoatType } from "./cat-coat-profiles";
import {
  configureCatFurMaterial,
  createCatFurMaterial,
} from "./cat-fur-material";
import {
  attachNativeHairSourceOptics,
  type NativeHairSourceSettings,
} from "./cat-native-hair-material";
import {
  NATIVE_CURVE_POINTS,
  NATIVE_CURVE_TEXELS,
  NATIVE_CURVE_PREFIX_POINTS,
  NATIVE_CURVE_PREFIX_TEXELS,
  NATIVE_CURVE_PREFIX_LAYOUT,
  NATIVE_CURVE_POINT_COLOR_TEXELS,
  NATIVE_CURVE_POINT_COLOR_LAYOUT,
  getNativeCurvePointCount,
  type PackedNativeCurveData,
} from "./cat-native-curve-data";

const nativePars = /* glsl */ `
attribute float nativeCurveIndex;
uniform sampler2D catNativeCurveTexture;
uniform int catNativeCurveTextureWidth;
uniform int catNativeCurvePoints;
uniform int catNativeCurveTexels;
uniform int catNativeCurvePointColors;
uniform mat3 catNativeViewToObject;

vec4 catNativeFetch( int index ) {
  return texelFetch( catNativeCurveTexture,
    ivec2( index % catNativeCurveTextureWidth, index / catNativeCurveTextureWidth ), 0 );
}

void catNativeSample( float t, out vec3 center, out vec3 tangent,
  out float radius, out vec3 rootColor ) {
  int base = int( nativeCurveIndex + 0.5 ) * catNativeCurveTexels;
  vec4 colorRecord = catNativeFetch( base + catNativeCurvePoints );
  int pointCount = catNativeCurvePoints == 17 ? int( colorRecord.a + 0.5 ) : catNativeCurvePoints;
  float segmentCount = float( pointCount - 1 );
  float s = clamp( t, 0.0, 1.0 ) * segmentCount;
  int segment = min( pointCount - 2, int( floor( s ) ) );
  float u = s - float( segment );
  vec4 p0 = catNativeFetch( base + max( 0, segment - 1 ) );
  vec4 p1 = catNativeFetch( base + segment );
  vec4 p2 = catNativeFetch( base + segment + 1 );
  vec4 p3 = catNativeFetch( base + min( pointCount - 1, segment + 2 ) );
  vec3 a = -p0.xyz + p2.xyz;
  vec3 b = 2.0 * p0.xyz - 5.0 * p1.xyz + 4.0 * p2.xyz - p3.xyz;
  vec3 c = -p0.xyz + 3.0 * p1.xyz - 3.0 * p2.xyz + p3.xyz;
  center = 0.5 * ( 2.0 * p1.xyz + a * u + b * u * u + c * u * u * u );
  tangent = 0.5 * ( a + 2.0 * b * u + 3.0 * c * u * u ) * segmentCount;
  radius = max( mix( p1.w, p2.w, u ), 0.0 );
  rootColor = colorRecord.rgb;
  if ( catNativeCurvePointColors > 0 ) {
    int colorBase = base + catNativeCurvePoints + 1;
    rootColor = mix( catNativeFetch( colorBase + segment ).rgb,
      catNativeFetch( colorBase + segment + 1 ).rgb, u );
  }
}
`;

const nativeBegin = /* glsl */ `
vec3 catNativeCenter, catNativeTangent, catNativeColor;
float catNativeRadius;
catNativeSample( uv.y, catNativeCenter, catNativeTangent, catNativeRadius, catNativeColor );
vec3 catNativeCenterView = ( modelViewMatrix * vec4( catNativeCenter, 1.0 ) ).xyz;
vec3 catNativeTangentView = ( modelViewMatrix * vec4( catNativeTangent, 0.0 ) ).xyz;
float catNativeTangentMagnitude = dot( catNativeTangentView, catNativeTangentView );
catNativeTangentView = catNativeTangentMagnitude > 1e-18
  ? catNativeTangentView * inversesqrt( catNativeTangentMagnitude ) : vec3( 0.0, 1.0, 0.0 );
vec3 catNativeViewDirection = projectionMatrix[3][3] == 0.0
  ? -catNativeCenterView / max( length( catNativeCenterView ), 1e-9 ) : vec3( 0.0, 0.0, 1.0 );
vec3 catNativeSpanView = cross( catNativeTangentView, catNativeViewDirection );
if ( dot( catNativeSpanView, catNativeSpanView ) < 1e-12 ) {
  vec3 axis = abs( catNativeTangentView.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
  catNativeSpanView = cross( catNativeTangentView, axis );
}
catNativeSpanView = normalize( catNativeSpanView );
// Inverse-transform a view-facing transverse direction, then normalise in
// model coordinates. The physical radius is defined in those same coordinates.
vec3 catNativeSpanObject = catNativeViewToObject * catNativeSpanView;
catNativeSpanObject /= max( length( catNativeSpanObject ), 1e-9 );
furWidth = catNativeSpanObject * catNativeRadius;
vec3 catNativeNormalView = normalize( cross( catNativeSpanView, catNativeTangentView ) );
// Normal transformation is covariant, unlike the position/tangent vectors.
vec3 catNativeNormalObject = normalize( transpose( mat3( modelViewMatrix ) ) * catNativeNormalView );
`;

export type NativeCurveRendererOptions = {
  /** Raster subdivisions of each stored curve, not new hairs or new guides. */
  segments?: number;
  coatType?: CatCoatType;
  name?: string;
  /** Private source R+T direct evaluation; absent keeps existing optics. */
  sourceHairOptics?: NativeHairSourceSettings;
};

/**
 * Static, private data-only preview. Consumes existing captured curves only.
 * The small CPU mesh is a shader template, NOT a portable groom or GLB export.
 * No skin/morph transport is implemented. Keep this material on legacy ribbon
 * coverage: finite-segment CPU proxies cannot read the GPU control-point data.
 */
export function createNativeCurveRenderer(
  packed: PackedNativeCurveData,
  options: NativeCurveRendererOptions = {},
) {
  const segments = options.segments ?? 16;
  if (!Number.isInteger(segments) || segments < 8 || segments > 128)
    throw new Error(
      "Native curve raster segments must be an integer from 8 to 128.",
    );
  if (
    !Number.isInteger(packed.width) ||
    packed.width < 1 ||
    !Number.isInteger(packed.height) ||
    packed.height < 1 ||
    !Number.isInteger(packed.curveCount) ||
    packed.curveCount < 0 ||
    !(
      (packed.pointsPerCurve === NATIVE_CURVE_POINTS &&
        packed.texelsPerCurve === NATIVE_CURVE_TEXELS &&
        (packed.layout === undefined ||
          packed.layout === "native-curve9-v1")) ||
      (packed.pointsPerCurve === NATIVE_CURVE_PREFIX_POINTS &&
        packed.texelsPerCurve === NATIVE_CURVE_PREFIX_TEXELS &&
        packed.layout === NATIVE_CURVE_PREFIX_LAYOUT) ||
      (packed.pointsPerCurve === NATIVE_CURVE_PREFIX_POINTS &&
        packed.texelsPerCurve === NATIVE_CURVE_POINT_COLOR_TEXELS &&
        packed.layout === NATIVE_CURVE_POINT_COLOR_LAYOUT)
    ) ||
    packed.data.length !== packed.width * packed.height * 4 ||
    packed.curveCount * packed.texelsPerCurve > packed.width * packed.height ||
    !packed.data.every(Number.isFinite) ||
    ![...packed.bounds.min, ...packed.bounds.max].every(Number.isFinite) ||
    packed.bounds.min.some((value, axis) => value > packed.bounds.max[axis])
  )
    throw new Error(
      "Native curve renderer received an invalid packed texture or bounds.",
    );
  for (let curve = 0; curve < packed.curveCount; curve++) {
    const base = curve * packed.texelsPerCurve * 4;
    const valid = getNativeCurvePointCount(packed, curve);
    for (let node = 0; node < packed.pointsPerCurve; node++)
      if (packed.data[base + node * 4 + 3] < 0)
        throw new Error("Native curve radii cannot be negative.");
    if (packed.pointsPerCurve === NATIVE_CURVE_PREFIX_POINTS)
      for (let node = valid; node < packed.pointsPerCurve; node++)
        for (let axis = 0; axis < 3; axis++)
          if (
            packed.data[base + node * 4 + axis] !==
            packed.data[base + (valid - 1) * 4 + axis]
          )
            throw new Error(
              "Native17 unused XYZ slots must repeat the last valid point.",
            );
    for (let channel = 0; channel < 3; channel++)
      if (packed.data[base + packed.pointsPerCurve * 4 + channel] < 0)
        throw new Error("Native curve linear colours cannot be negative.");
    if (packed.layout === NATIVE_CURVE_POINT_COLOR_LAYOUT) {
      const start = base + NATIVE_CURVE_PREFIX_TEXELS * 4;
      for (let node = 0; node < packed.pointsPerCurve; node++)
        for (let channel = 0; channel < 3; channel++) {
          const value = packed.data[start + node * 4 + channel];
          if (value < 0)
            throw new Error("Native point colours cannot be negative.");
          if (
            node >= valid &&
            value !== packed.data[start + (valid - 1) * 4 + channel]
          )
            throw new Error(
              "Native17 unused point colours must repeat the real tip colour.",
            );
        }
    }
  }

  // Only own resources are allocated. The caller's packed buffers and bindings
  // remain unchanged and can be reused after this preview has been disposed.
  const texture = new THREE.DataTexture(
    packed.data.slice(),
    packed.width,
    packed.height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.name = "NativeCurve_ControlPoints_RGBA32F";
  texture.internalFormat = "RGBA32F";
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;

  const geometry = new THREE.InstancedBufferGeometry();
  const vertices = (segments + 1) * 2;
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3).fill(1);
  const uv = new Float32Array(vertices * 2);
  const indices = new Uint16Array(segments * 6);
  for (let node = 0; node <= segments; node++) {
    for (let side = 0; side < 2; side++) {
      const vertex = node * 2 + side;
      uv.set([side, node / segments], vertex * 2);
      normals[vertex * 3 + 2] = 1;
    }
    if (node < segments) {
      const left = node * 2;
      indices.set(
        [left, left + 1, left + 2, left + 1, left + 3, left + 2],
        node * 6,
      );
    }
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute(
    "nativeCurveIndex",
    new THREE.InstancedBufferAttribute(
      Float32Array.from({ length: packed.curveCount }, (_, index) => index),
      1,
    ),
  );
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.instanceCount = packed.curveCount;
  geometry.setDrawRange(0, indices.length);
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(...packed.bounds.min),
    new THREE.Vector3(...packed.bounds.max),
  );
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(
    new THREE.Sphere(),
  );
  geometry.userData.nativeCurveShaderTemplate = true;
  geometry.userData.portableGroomExport = false;

  const material = createCatFurMaterial();
  configureCatFurMaterial(material, {
    coatType: options.coatType ?? "short",
    detailLevel: 1,
    coverageFilter: "legacy",
  });
  material.name = "NativeCurve_FibreOptics_StaticPreview";
  material.userData.catFurOptics.export = "unsupported-GPU-template-only";
  const viewToObject = new THREE.Matrix3();
  const nativeUniforms = {
    catNativeCurveTexture: { value: texture },
    catNativeCurveTextureWidth: { value: packed.width },
    catNativeCurvePoints: { value: packed.pointsPerCurve },
    catNativeCurveTexels: { value: packed.texelsPerCurve },
    catNativeCurvePointColors: {
      value: packed.layout === NATIVE_CURVE_POINT_COLOR_LAYOUT ? 1 : 0,
    },
    catNativeViewToObject: { value: viewToObject },
  };
  const factoryCompile = material.onBeforeCompile;
  const factoryRender = material.onBeforeRender;
  const factoryKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function (shader, renderer) {
    factoryCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, nativeUniforms);
    const required = [
      "#include <common>",
      "void main() {",
      "#include <color_vertex>",
      "#include <beginnormal_vertex>",
      "#include <begin_vertex>",
      "attribute vec3 furWidth;",
    ];
    for (const token of required)
      if (!shader.vertexShader.includes(token))
        throw new Error(`Native curve shader hook is missing: ${token}`);
    shader.vertexShader = shader.vertexShader
      .replace("attribute vec3 furWidth;", "vec3 furWidth;")
      .replace("#include <common>", `#include <common>\n${nativePars}`)
      .replace("void main() {", `void main() {\n${nativeBegin}`)
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
        #ifdef USE_COLOR_ALPHA
          vColor = vec4( catNativeColor, 1.0 );
        #elif defined( USE_COLOR )
          vColor.rgb = catNativeColor;
        #endif`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\nobjectNormal = catNativeNormalObject;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed = catNativeCenter + ( uv.x * 2.0 - 1.0 ) * furWidth;
        #ifdef USE_ALPHAHASH
          vPosition = transformed;
        #endif`,
      );
  };
  material.onBeforeRender = function (
    renderer,
    scene,
    camera,
    drawGeometry,
    object,
    group,
  ) {
    factoryRender.call(
      this,
      renderer,
      scene,
      camera,
      drawGeometry,
      object,
      group,
    );
    viewToObject.setFromMatrix4(object.modelViewMatrix).invert();
  };
  material.customProgramCacheKey = () =>
    `${factoryKey()}|native-curve-static-v3`;
  material.userData.nativeCurveRenderer = {
    version: 3,
    layout: packed.layout ?? "native-curve9-v1",
    pointsPerCurve: packed.pointsPerCurve,
    texelsPerCurve: packed.texelsPerCurve,
    pointColors: packed.layout === NATIVE_CURVE_POINT_COLOR_LAYOUT,
    static: true,
    skinning: false,
    morphTargets: false,
    portableGroomExport: false,
    supportedCoverageFilter: "legacy",
  };
  if (options.sourceHairOptics)
    attachNativeHairSourceOptics(material, options.sourceHairOptics);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = options.name ?? "NativeCurves_StaticPreview";
  mesh.visible = packed.curveCount > 0;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  // Raster AA can extend beyond physical bounds by a fraction of a pixel.
  mesh.frustumCulled = false;
  Object.assign(mesh.userData, {
    furRegion: "native-curves",
    nativeCurveRenderer: true,
    volumePreviewOnly: true,
    portableGroomExport: false,
  });
  let disposed = false;
  return {
    mesh,
    geometry,
    material,
    texture,
    getInfo: () => ({
      curveCount: packed.curveCount,
      layout: packed.layout ?? "native-curve9-v1",
      pointsPerCurve: packed.pointsPerCurve,
      texelsPerCurve: packed.texelsPerCurve,
      pointColors: packed.layout === NATIVE_CURVE_POINT_COLOR_LAYOUT,
      rasterSegments: segments,
      textureWidth: packed.width,
      textureHeight: packed.height,
      textureBytes: packed.data.byteLength,
      templateVertices: vertices,
      templateIndices: indices.length,
      static: true,
      skinning: false,
      morphTargets: false,
      portableGroomExport: false,
      sourceHairOptics: material.userData.nativeHairSourceOptics ?? null,
      disposed,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.visible = false;
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
