import * as THREE from "three";
import { catFurDirectLightingGLSL } from "./cat-fur-material";
import { NATIVE_LEGACY_HAIR_GLSL } from "./cat-native-hair-optics";

export type NativeHairSourceSettings = {
  /** Actual source UI values; this adapter supports the shared-colour R+T Add. */
  roughnessUV: readonly [number, number];
  offsetRadians: number;
  /** Projected circular cross-section approximation, not multiple scattering. */
  crossSection?: "center" | "round4" | "round";
};

const directSource = /* glsl */ `
varying vec3 vCatNativeSourceTangent;
uniform vec2 catNativeHairRoughness;
uniform float catNativeHairOffset;
uniform float catNativeHairRoundSection;
${NATIVE_LEGACY_HAIR_GLSL}

float catNativeHairClosureSum( vec3 N, vec3 T, vec3 V, vec3 L ) {
  return catNativeLegacyHairEval( 0, N, T, V, L,
      catNativeHairRoughness, catNativeHairOffset ).x
    + catNativeLegacyHairEval( 1, N, T, V, L,
      catNativeHairRoughness, catNativeHairOffset ).x;
}

void RE_Direct_CatFur( const in IncidentLight directLight,
  const in vec3 geometryPosition, const in vec3 geometryNormal,
  const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal,
  const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  vec3 T = normalize( vCatNativeSourceTangent );
  vec3 V = geometryViewDir;
  vec3 L = directLight.direction;
  vec3 centerNormal = V - T * dot( T, V );
  float n2 = dot( centerNormal, centerNormal );
  if ( n2 < 1e-12 ) return;
  centerNormal *= inversesqrt( n2 );
  float response;
  if ( catNativeHairRoundSection > 1.5 ) {
    vec3 B = normalize( cross( T, V ) );
    float a = dot( centerNormal, L ), b = dot( B, L );
    float transverseLight = length( vec2( a, b ) );
    // Exact projected-width average of the legacy closure's N.L sign gate
    // on this local cylinder. N is otherwise unused by the source lobes.
    float reflectionFraction = transverseLight > 1e-12
      ? clamp( 0.5 * ( 1.0 + a / transverseLight ), 0.0, 1.0 ) : 0.5;
    float reflection = catNativeLegacyHairEval( 0, L, T, V, L,
      catNativeHairRoughness, catNativeHairOffset ).x;
    float transmission = catNativeLegacyHairEval( 1, -L, T, V, L,
      catNativeHairRoughness, catNativeHairOffset ).x;
    response = reflectionFraction * reflection + ( 1.0 - reflectionFraction ) * transmission;
  } else if ( catNativeHairRoundSection > 0.5 ) {
    vec3 B = normalize( cross( T, V ) );
    // Four-point Gauss-Legendre average over projected width x in [-1,1].
    // These are local cylinder normals, not a round-curve visibility solver.
    float a = 0.8611363115940526, b = 0.3399810435848563;
    float wa = 0.1739274225687269, wb = 0.3260725774312731;
    float za = sqrt( 1.0 - a * a ), zb = sqrt( 1.0 - b * b );
    response = wa * ( catNativeHairClosureSum( centerNormal * za + B * a, T, V, L )
      + catNativeHairClosureSum( centerNormal * za - B * a, T, V, L ) )
      + wb * ( catNativeHairClosureSum( centerNormal * zb + B * b, T, V, L )
      + catNativeHairClosureSum( centerNormal * zb - B * b, T, V, L ) );
  } else {
    response = catNativeHairClosureSum( centerNormal, T, V, L );
  }
  // Cycles returns closure evaluation INCLUDING its cosine convention. The
  // active source adds R and T at full shared colour, without a .5 Mix.
  // No extra N.L, 1/pi, Fresnel, broad diffuse or empirical brightness gain.
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor * response;
}
#undef RE_Direct
#define RE_Direct RE_Direct_CatFur
`;

/** Opt-in private source evaluator. Existing material/compositor hooks survive. */
export function attachNativeHairSourceOptics(
  material: THREE.MeshStandardMaterial,
  settings: NativeHairSourceSettings,
) {
  if (
    settings.roughnessUV.length !== 2 ||
    !settings.roughnessUV.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) ||
    !Number.isFinite(settings.offsetRadians) ||
    (settings.crossSection !== undefined && !["center", "round4", "round"].includes(settings.crossSection))
  ) throw new Error("Native Hair source parameters must match a supported source closure.");
  const uniforms = {
    catNativeHairRoughness: { value: new THREE.Vector2(...settings.roughnessUV) },
    catNativeHairOffset: { value: settings.offsetRadians },
    catNativeHairRoundSection: { value: settings.crossSection === "round" ? 2 : settings.crossSection === "round4" ? 1 : 0 },
  };
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey.bind(material);
  const rootAttenuation = "outgoingLight *= mix( furRootLight, 1.0, smoothstep( 0.0, 0.55, vCatFurCoord.y ) );";
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    if (!shader.fragmentShader.includes(catFurDirectLightingGLSL) ||
        !shader.fragmentShader.includes(rootAttenuation) ||
        !shader.vertexShader.includes("catNativeTangentView") ||
        !shader.vertexShader.includes("#include <begin_vertex>"))
      throw new Error("Native source optics requires the native renderer's shader hooks.");
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCatNativeSourceTangent;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCatNativeSourceTangent = catNativeTangentView;");
    shader.fragmentShader = shader.fragmentShader
      .replace(catFurDirectLightingGLSL, directSource)
      .replace(rootAttenuation, "// Original per-point root colour already contains the source Intercept ramp.");
  };
  material.customProgramCacheKey = () => `${cacheKey()}|source-legacy-hair-v1:${JSON.stringify(settings)}`;
  material.userData.nativeHairSourceOptics = {
    mode: "blender-3.6-legacy-R-plus-T-shared-colour-direct-evaluation",
    parameters: { ...settings },
    tangent: "analytic-native-curve-view-tangent",
    roundSection: settings.crossSection ?? "center",
    extraRootAttenuation: false,
    indirectLighting: "existing-Three-Lambert-approximation; use direct-only fixture to isolate source evaluator",
    limits: ["No source path tracing, self-shadow, multiple scattering or BSDF sampling", "Projected local cylinder normal averaging does not reproduce actual round-curve intersection/visibility"],
  };
}
