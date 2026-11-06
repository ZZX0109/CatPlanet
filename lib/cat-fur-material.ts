import * as THREE from "three";
import type { CatCoatType } from "./cat-coat-profiles";

/**
 * Real-time fibre approximation: broad longitudinal lobes and limited forward
 * scattering, not a reproduction of the Chiang et al. path-traced BFSDF.
 * The original strand centreline/radius remain in CPU geometry and exports.
 */
export type CatFurMaterialSettings = {
  coatType?: CatCoatType;
  detailLevel?: number;
  /** Internal A/B inspection; no effect on stored appearance or CPU geometry. */
  sampling?: boolean;
  /** Accumulation requires the dedicated two-attachment linear-float target. */
  renderPass?: "preview" | "accumulation";
  /** Resolved ordinary (not reversed/logarithmic) opaque scene depth. */
  opaqueDepth?: THREE.Texture | null;
  /** Internal MRT-only A/B experiment; legacy remains the shipping default. */
  coverageFilter?: "legacy" | "box" | "compact";
  /** Preview only: replace eligible bulk down with the separately drawn volume. */
  volumeReplacement?: boolean;
};

type FurUniforms = {
  catFurViewport: { value: THREE.Vector2 };
  catFurLodScale: { value: number };
  catFurLongCoat: { value: number };
  catFurSampling: { value: number };
  catFurOpaqueDepth: { value: THREE.Texture | null };
  catFurUseOpaqueDepth: { value: number };
  catFurCoverageFilter: { value: number };
  catFurHasFilterAxis: { value: number };
  catFurVolumeReplacement: { value: number };
  catFurHasVolumeWeight: { value: number };
  catFurHasAnalyticTangent: { value: number };
};
const uniformsFor = new WeakMap<THREE.MeshStandardMaterial, FurUniforms>();
const requestedSampling = new WeakMap<THREE.MeshStandardMaterial, boolean>();
const requestedDetail = new WeakMap<THREE.MeshStandardMaterial, number>();
const requestedCoat = new WeakMap<THREE.MeshStandardMaterial, CatCoatType>();
const renderPassFor = new WeakMap<
  THREE.MeshStandardMaterial,
  "preview" | "accumulation"
>();
const defaultSamples = new WeakMap<THREE.WebGLRenderer, number>();

const vertexPars = /* glsl */ `
attribute vec3 furWidth;
attribute float furVolumeWeight;
// Optional unit root-to-tip derivative, normally normalized Int16 on the CPU.
attribute vec3 furTangent;
varying vec2 vCatFurCoord;
varying float vCatFurCoverage;
varying float vCatFurVolumeWeight;
varying vec3 vCatFurAnalyticTangent;
uniform float catFurHasVolumeWeight;
uniform float catFurHasAnalyticTangent;
uniform vec2 catFurViewport;
uniform float catFurLodScale;
uniform float catFurSampling;
#ifdef CAT_FUR_MRT
attribute float furFilterAxis;
uniform float catFurCoverageFilter;
uniform float catFurHasFilterAxis;
// x: physical/representative radius in pixels; y: valid filtered billboard.
varying vec2 vCatFurPrefilter;
#endif
`;

const vertexCoverage = /* glsl */ `
vCatFurCoord = uv;
vCatFurCoverage = 1.0;
vCatFurVolumeWeight = catFurHasVolumeWeight > 0.5 ? furVolumeWeight : 0.0;
// A curve direction transforms with the model-view linear map, not the inverse
// transpose used by surface normals. Normalize after fragment interpolation.
vCatFurAnalyticTangent = catFurHasAnalyticTangent > 0.5
  ? ( modelViewMatrix * vec4( furTangent, 0.0 ) ).xyz : vec3( 0.0 );
#ifdef CAT_FUR_MRT
vCatFurPrefilter = vec2( 0.0 );
#endif
// furWidth is the unexpanded half-width vector, shared by the two vertices.
// Work on clip position only: view-space position still describes the actual
// fibre, allowing fragment derivatives to recover its geometric tangent.
float furSide = uv.x * 2.0 - 1.0;
vec3 furCenter = transformed - furSide * furWidth;
vec4 furCenterView = modelViewMatrix * vec4( furCenter, 1.0 );
vec4 furCenterClip = projectionMatrix * furCenterView;
if ( catFurSampling > 0.5 && furCenterClip.w > 0.00001 && gl_Position.w > 0.00001 ) {
  vec2 furViewport = max( catFurViewport, vec2( 1.0 ) );
  vec2 furCenterNdc = furCenterClip.xy / furCenterClip.w;
  vec2 furEdgeNdc = gl_Position.xy / gl_Position.w;
  vec2 furDelta = ( furEdgeNdc - furCenterNdc ) * furViewport * 0.5;
  float furProjectedRadius = length( furDelta );
  // A physical circular cross-section does not vanish merely because the
  // authored ribbon's transverse vector happens to point towards the camera.
  vec3 furWidthView = ( modelViewMatrix * vec4( furWidth, 0.0 ) ).xyz;
  float furRadius = length( furWidthView );
  float furDepthDivisor = projectionMatrix[3][3] == 0.0 ? abs( furCenterView.z ) : 1.0;
  float furPixelsPerUnit = abs( projectionMatrix[1][1] ) * furViewport.y
    / max( 2.0 * furDepthDivisor, 0.00001 );
  float furPhysicalRadius = max( furRadius * furPixelsPerUnit, 0.000001 );
  vec2 furDirection;
  if ( furProjectedRadius > 0.00001 ) {
    furDirection = furDelta / furProjectedRadius;
  } else {
    vec3 furNormalView = normalize( normalMatrix * normal );
    vec2 furNormalProjected = furNormalView.xy;
    float furNormalLength = length( furNormalProjected );
    furDirection = furSide * ( furNormalLength > 0.00001
      ? furNormalProjected / furNormalLength : vec2( 1.0, 0.0 ) );
  }
  float furRepresentedRadius = furPhysicalRadius * catFurLodScale;
  #ifdef CAT_FUR_MRT
  // Float accumulation can retain very low coverage, without an MSAA mask's
  // four-sample quantisation or its correlated masks across overlapping hair.
  float furRasterRadius = max( furRepresentedRadius, 0.45 );
  if ( catFurCoverageFilter > 0.5 && catFurHasFilterAxis > 0.5
    && abs( furFilterAxis ) > 0.5 ) {
    // Both authored vectors are perpendicular to the centreline derivative.
    // Their cross product recovers the axis. The signed byte supplied from the
    // analytical CPU derivative keeps root-to-tip orientation consistent even
    // when a lying strand bends across its source frame. Zero excludes an
    // entire contact/near-degenerate strand from this experimental filter.
    // Recover T before applying the model transform. Crossing a transformed
    // normal with a transformed width would fail under non-uniform scale.
    vec3 furWidthDirection = furWidth / max( length( furWidth ), 0.00000001 );
    vec3 furTangentObject = cross( normalize( normal ), furWidthDirection ) * furFilterAxis;
    float furTangentMagnitude = dot( furTangentObject, furTangentObject );
    if ( furTangentMagnitude > 0.00000001 ) {
      vec3 furTangentView = ( modelViewMatrix * vec4( furTangentObject, 0.0 ) ).xyz;
      furTangentView = normalize( furTangentView );
      vec4 furTangentClip = projectionMatrix * vec4( furTangentView, 0.0 );
      // Homogeneous projection derivative. The omitted positive w^2 divisor
      // cancels when normalising its screen-space direction.
      vec2 furTangentPixels = ( furTangentClip.xy * furCenterClip.w
        - furCenterClip.xy * furTangentClip.w ) * furViewport * 0.5;
      float furScreenMagnitude = dot( furTangentPixels, furTangentPixels );
      if ( furScreenMagnitude > 0.0000000001 ) {
        vec2 furScreenTangent = furTangentPixels * inversesqrt( furScreenMagnitude );
        vec2 furScreenNormal = vec2( -furScreenTangent.y, furScreenTangent.x );
        furDirection = furSide * furScreenNormal;
        // A square pixel projects onto the normal as the convolution of
        // two boxes with widths |nx|, |ny|. Use its maximum possible support
        // for conservative strip coverage between differently oriented nodes.
        float furPixelSupport = 0.5 * ( abs( furScreenNormal.x ) + abs( furScreenNormal.y ) );
        float furFilterSupport = max( furPixelSupport, 0.7071067812 )
          + ( catFurCoverageFilter < 1.5 ? 0.0 : 0.3 );
        // Curved strip endpoints use smooth analytical tangents, whereas a
        // triangle spans the chord. Overscan protects that chord's filter
        // support; it is discarded before lighting, never extra opaque width.
        furRasterRadius = ( furRepresentedRadius + furFilterSupport ) * 1.2 + 0.025;
        vCatFurPrefilter = vec2( furRepresentedRadius, 1.0 );
      }
    }
  }
  #else
  // Four-fold bound keeps coverage >= 1/4, representable by 4x MSAA.
  // Extremely thin fibres are not expanded to a whole opaque pixel.
  float furRasterRadius = min( max( furRepresentedRadius, 0.45 ),
    furRepresentedRadius * 4.0 );
  #endif
  vCatFurCoverage = clamp( furRepresentedRadius / max( furRasterRadius, 0.000001 ), 0.0, 1.0 );
  vec2 furRasterNdc = furCenterNdc + furDirection * furRasterRadius * 2.0 / furViewport;
  gl_Position.xy = furRasterNdc * gl_Position.w;
}
`;

const fragmentPars = /* glsl */ `
varying vec2 vCatFurCoord;
varying float vCatFurCoverage;
varying float vCatFurVolumeWeight;
varying vec3 vCatFurAnalyticTangent;
uniform float catFurHasAnalyticTangent;
uniform float catFurVolumeReplacement;
uniform float catFurLongCoat;
#ifdef CAT_FUR_MRT
layout(location = 1) out highp vec4 catFurOpticalDepth;
uniform sampler2D catFurOpaqueDepth;
uniform float catFurUseOpaqueDepth;
uniform vec2 catFurViewport;
uniform float catFurCoverageFilter;
varying vec2 vCatFurPrefilter;

float catFurTwoBoxCdf( float x, float a, float b ) {
  // a >= b >= 0. Symmetry and the trapezoid's linear centre avoid subtracting
  // nearly equal positive-part squares when the normal is almost axis-aligned.
  float support = 0.5 * ( a + b );
  if ( x <= -support ) return 0.0;
  if ( x >= support ) return 1.0;
  if ( b < 0.0000001 ) return clamp( 0.5 + x / a, 0.0, 1.0 );
  float t = support - abs( x );
  float tail = t < b ? t * t / ( 2.0 * a * b ) : ( t - 0.5 * b ) / a;
  tail = clamp( tail, 0.0, 0.5 );
  return x < 0.0 ? tail : 1.0 - tail;
}

float catFurCubeDifference( float t, float c ) {
  // (positive(t)^3 - positive(t-c)^3) / c, including its exact c->0
  // limit. Eliminating c analytically keeps the three-box CDF stable at axes.
  if ( t <= 0.0 ) return 0.0;
  if ( c <= 0.0 ) return 3.0 * t * t;
  if ( t < c ) return t * t * ( t / c );
  return 3.0 * t * t - 3.0 * t * c + c * c;
}

float catFurThreeBoxCdf( float x, float a, float b, float c ) {
  // Sorted a >= b >= c. Here a,b are at least .6, so the remaining divisor
  // is well conditioned even when the original pixel normal has a zero axis.
  float support = 0.5 * ( a + b + c );
  if ( x <= -support ) return 0.0;
  if ( x >= support ) return 1.0;
  float t = support - abs( x );
  float tail = ( catFurCubeDifference( t, c )
    - catFurCubeDifference( t - a, c )
    - catFurCubeDifference( t - b, c )
    + catFurCubeDifference( t - a - b, c ) ) / ( 6.0 * a * b );
  tail = clamp( tail, 0.0, 0.5 );
  return x < 0.0 ? tail : 1.0 - tail;
}

float catFurFilterCdf( float x, vec2 pixelNormal ) {
  vec2 widths = abs( pixelNormal );
  float a = max( widths.x, widths.y );
  float b = min( widths.x, widths.y );
  // True integration over a square pixel: its transverse kernel is the
  // convolution of the two projected unit-pixel axes, not a fixed 1D box.
  if ( catFurCoverageFilter < 1.5 ) return catFurTwoBoxCdf( x, a, b );
  // Add a unit-mass .6px transverse box before pixel integration. Its small
  // compact footprint softens sampling without changing physical hair width.
  return catFurThreeBoxCdf( x, a, max( b, 0.6 ), min( b, 0.6 ) );
}

float catFurFilteredCoverage() {
  // This condition is uniform across the draw, so the legacy path avoids
  // extra derivative/filter work without divergent-derivative ambiguity.
  if ( catFurCoverageFilter < 0.5 ) return clamp( vCatFurCoverage, 0.0, 1.0 );
  // Evaluate derivatives before the per-fragment validity branch.
  vec2 gradient = vec2( dFdx( vCatFurCoord.x ), dFdy( vCatFurCoord.x ) );
  float magnitude = length( gradient );
  if ( vCatFurPrefilter.y > 0.999
    && magnitude > 0.000001 ) {
    // Gradient is perpendicular to the projected U=.5 centreline even
    // when a curved strip's transverse span is slightly oblique.
    float distance = ( vCatFurCoord.x - 0.5 ) / magnitude;
    vec2 pixelNormal = gradient / magnitude;
    float radius = max( vCatFurPrefilter.x, 0.0 );
    // Convolution of the real interval [-r,r] with a unit-mass pixel
    // filter. Its integrated area is 2r, with no brightness multiplier.
    return clamp( catFurFilterCdf( distance + radius, pixelNormal )
      - catFurFilterCdf( distance - radius, pixelNormal ), 0.0, 1.0 );
  }
  return clamp( vCatFurCoverage, 0.0, 1.0 );
}
#endif

vec3 catFurTangent() {
  // C1 curve derivatives avoid a different highlight axis on every rendered
  // triangle chord. Missing/degenerate attributes retain the legacy fallback.
  float analyticMagnitude = dot( vCatFurAnalyticTangent, vCatFurAnalyticTangent );
  if ( catFurHasAnalyticTangent > 0.5 && analyticMagnitude > 1e-18 ) {
    return vCatFurAnalyticTangent * inversesqrt( analyticMagnitude );
  }
  // Invert the local screen-space UV Jacobian. The transverse derivative is
  // eliminated, so random ribbon roll does not determine the hair highlight.
  vec3 px = dFdx( -vViewPosition );
  vec3 py = dFdy( -vViewPosition );
  vec2 ux = dFdx( vCatFurCoord );
  vec2 uy = dFdy( vCatFurCoord );
  float determinant = ux.x * uy.y - ux.y * uy.x;
  vec3 tangent = py * ux.x - px * uy.x;
  float magnitude = dot( tangent, tangent );
  if ( magnitude > 1e-18 && abs( determinant ) > 1e-12 ) {
    return tangent * inversesqrt( magnitude ) * sign( determinant );
  }
  vec3 fallback = cross( normalize( vViewPosition ), vec3( 1.0, 0.0, 0.0 ) );
  return dot( fallback, fallback ) > 1e-12 ? normalize( fallback ) : vec3( 0.0, 1.0, 0.0 );
}
`;

export const catFurDirectLightingGLSL = /* glsl */ `
void RE_Direct_CatFur( const in IncidentLight directLight,
  const in vec3 geometryPosition, const in vec3 geometryNormal,
  const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal,
  const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  vec3 T = catFurTangent();
  vec3 L = directLight.direction;
  vec3 V = geometryViewDir;
  float tl = clamp( dot( T, L ), -1.0, 1.0 );
  float tv = clamp( dot( T, V ), -1.0, 1.0 );
  float cosLight = sqrt( max( 1.0 - tl * tl, 0.0 ) );
  float cosView = sqrt( max( 1.0 - tv * tv, 0.0 ) );
  float skinFacing = clamp( ( dot( geometryNormal, L ) + 0.35 ) / 1.35, 0.0, 1.0 );
  float cylinderDiffuse = cosLight * ( 0.38 + 0.62 * skinFacing );
  // Broad longitudinal R / TRT-like lobes. The two roughnesses are deliberately
  // wide to avoid isolated white pins on subpixel strands under a studio key.
  float sigma = mix( 0.34, 0.28, catFurLongCoat );
  float longitudinal = tl + tv;
  float firstLobe = exp( -0.5 * pow( ( longitudinal - 0.045 ) / sigma, 2.0 ) );
  float secondLobe = exp( -0.5 * pow( ( longitudinal + 0.12 ) / ( sigma * 1.65 ), 2.0 ) );
  vec3 lightPlane = L - T * tl;
  vec3 viewPlane = V - T * tv;
  float planeCos = clamp( dot( lightPlane, viewPlane ) / max( cosLight * cosView, 0.001 ), -1.0, 1.0 );
  float azimuth = 0.35 + 0.65 * sqrt( max( 0.0, 0.5 + 0.5 * planeCos ) );
  float fresnel = 0.045 + 0.10 * pow( 1.0 - cosView, 5.0 );
  vec3 albedo = material.diffuseColor;
  float luminance = dot( albedo, vec3( 0.2126, 0.7152, 0.0722 ) );
  float forwardScatter = pow( max( dot( -L, V ), 0.0 ), 4.0 )
    * ( 0.06 + 0.12 * sqrt( max( luminance, 0.0 ) ) ) * cosLight;
  reflectedLight.directDiffuse += directLight.color * albedo * RECIPROCAL_PI
    * ( 0.90 * cylinderDiffuse + forwardScatter );
  // The broad lobes cover a large solid angle: use the same radiance scale
  // as the diffuse term rather than treating each strand as a white emitter.
  // This is a bounded real-time approximation, not a normalised hair BSDF.
  reflectedLight.directSpecular += directLight.color * RECIPROCAL_PI * cosLight * azimuth
    * ( vec3( fresnel * firstLobe ) + sqrt( max( albedo, vec3( 0.0 ) ) ) * 0.055 * secondLobe );
}
#undef RE_Direct
#define RE_Direct RE_Direct_CatFur
`;

/**
 * Live preview requires uv(side,t) and furWidth(real half-width vector).
 *
 * Preview alpha-to-coverage writes fractional alpha to covered MSAA samples. Render to
 * an actually opaque WebGL context, or resolve through a final opaque pass,
 * before browser compositing. Otherwise the browser adds the page background
 * through the resolved fractional alpha and turns ordinary fur into white
 * streaks. Check getContextAttributes().alpha; a renderer's constructor flag
 * is not proof (Three r186 creates an alpha-enabled context internally).
 * Coverage is bounded for 4x MSAA; correlated sample masks across overlapping
 * strands still lose coverage. This is not order-independent transparency or
 * a claim of energy conservation across all hair layers.
 *
 * Accumulation is a separate, one-draw, additive two-target pass. It writes
 * (linear RGB * alpha, alpha) and logarithmic revealage respectively. The
 * compositor owns the depth texture and must perform the final opaque resolve
 * and display transform; never draw this mode straight into the canvas.
 * Experimental transverse filters additionally require an unnormalised signed
 * byte `furFilterAxis`: +/-1 orients the recovered tangent, zero keeps the
 * whole strand on legacy coverage. Missing attributes also keep legacy mode.
 */
export function createCatFurMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: "white",
    roughness: 0.86,
    metalness: 0,
    side: THREE.FrontSide,
    alphaToCoverage: true,
    alphaTest: 0.001,
    depthWrite: true,
    transparent: false,
  });
  material.name = "CatFur_FibreOptics";
  material.userData.catFurOptics = {
    version: 5,
    lighting: "broad-longitudinal-fibre-approximation",
    coverage: "MSAA-preview-or-additive-log-revealage-MRT",
    coverageFilter: "legacy",
    volumeReplacement: false,
    export: "standard-PBR-on-original-geometry",
    tangent: "optional-analytic-derivative-with-legacy-UV-Jacobian-fallback",
  };
  const uniforms: FurUniforms = {
    catFurViewport: { value: new THREE.Vector2(1, 1) },
    catFurLodScale: { value: 1 },
    catFurLongCoat: { value: 0 },
    catFurSampling: { value: 1 },
    catFurOpaqueDepth: { value: null },
    catFurUseOpaqueDepth: { value: 0 },
    catFurCoverageFilter: { value: 0 },
    catFurHasFilterAxis: { value: 0 },
    catFurVolumeReplacement: { value: 0 },
    catFurHasVolumeWeight: { value: 0 },
    catFurHasAnalyticTangent: { value: 0 },
  };
  uniformsFor.set(material, uniforms);
  requestedSampling.set(material, true);
  requestedDetail.set(material, 1);
  requestedCoat.set(material, "short");
  renderPassFor.set(material, "preview");
  const viewport = new THREE.Vector4();
  material.onBeforeRender = (renderer, _scene, _camera, geometry) => {
    renderer.getCurrentViewport(viewport);
    uniforms.catFurViewport.value.set(viewport.z, viewport.w);
    // A disabled/missing vertex array can inherit a previous GL constant.
    // Guard explicitly instead of trusting its implicit generic value.
    uniforms.catFurHasFilterAxis.value = geometry.hasAttribute("furFilterAxis")
      ? 1
      : 0;
    uniforms.catFurHasVolumeWeight.value = geometry.hasAttribute(
      "furVolumeWeight",
    )
      ? 1
      : 0;
    const analyticTangent = geometry.getAttribute("furTangent");
    uniforms.catFurHasAnalyticTangent.value =
      analyticTangent?.itemSize === 3 ? 1 : 0;
    const target = renderer.getRenderTarget();
    let samples = target?.samples ?? defaultSamples.get(renderer);
    if (samples === undefined) {
      const context = renderer.getContext();
      samples = Number(context.getParameter(context.SAMPLES)) || 0;
      defaultSamples.set(renderer, samples);
    }
    // The float accumulation target represents coverage without MSAA. A
    // direct canvas preview needs MSAA; otherwise retain original geometry.
    uniforms.catFurSampling.value =
      requestedSampling.get(material) &&
      (renderPassFor.get(material) === "accumulation" || samples > 1)
        ? 1
        : 0;
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${vertexPars}`)
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>\n${vertexCoverage}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <lights_physical_pars_fragment>",
        `#include <lights_physical_pars_fragment>\n${fragmentPars}\n${catFurDirectLightingGLSL}`,
      )
      .replace(
        "#include <alphatest_fragment>",
        `
        diffuseColor.a *= 1.0 - catFurVolumeReplacement * vCatFurVolumeWeight;
        #ifdef CAT_FUR_MRT
          diffuseColor.a *= catFurFilteredCoverage();
        #else
          diffuseColor.a *= clamp( vCatFurCoverage, 0.0, 1.0 );
        #endif
        // The ordinary texture alpha-test smoothstep would turn fractional
        // area coverage back to full opacity, so retain our coverage directly.
        #ifdef CAT_FUR_MRT
          if ( diffuseColor.a <= 0.0 ) discard;
          if ( catFurUseOpaqueDepth > 0.5 ) {
            vec2 furDepthUv = gl_FragCoord.xy / max( catFurViewport, vec2( 1.0 ) );
            float furOpaqueDepth = texture2D( catFurOpaqueDepth, furDepthUv ).r;
            // Ordinary depth from the same camera/physical viewport. The
            // small bias tolerates depth-texture quantisation at the skin.
            if ( gl_FragCoord.z > furOpaqueDepth + 0.000001 ) discard;
          }
        #else
          if ( diffuseColor.a < 0.00001 ) discard;
        #endif
      `,
      )
      .replace(
        "#include <opaque_fragment>",
        `
        // Short undercoat has little exposed root depth. Retain a mild root
        // attenuation without painting every tiny root as a dark freckle.
        float furRootLight = mix( 0.93, 0.88, catFurLongCoat );
        outgoingLight *= mix( furRootLight, 1.0, smoothstep( 0.0, 0.55, vCatFurCoord.y ) );
        #include <opaque_fragment>
      `,
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        #ifdef CAT_FUR_MRT
          float furAlpha = clamp( diffuseColor.a, 0.0, 1.0 );
          // Constant weight is the neutral weighted-blended special case.
          // Avoid the huge weights used for other content: dense fur can
          // overflow half-float accumulation long before an opaque surface.
          gl_FragColor = vec4( max( gl_FragColor.rgb, vec3( 0.0 ) ) * furAlpha, furAlpha );
          // Sum -log(1-a), then exp(-sum) at resolve: equivalent to multiplying
          // revealage, using the same ONE/ONE blending as colour accumulation.
          catFurOpticalDepth = vec4( -log( max( 1.0 - furAlpha, 0.0001 ) ), 0.0, 0.0, 0.0 );
        #endif
      `,
      );
  };
  material.customProgramCacheKey = () =>
    `cat-fur-fibre-optics-v5-${renderPassFor.get(material) ?? "preview"}`;
  return material;
}

export function configureCatFurMaterial(
  material: THREE.MeshStandardMaterial,
  settings: CatFurMaterialSettings,
): void {
  const uniforms = uniformsFor.get(material);
  if (!uniforms) return;
  if (settings.coatType !== undefined) {
    uniforms.catFurLongCoat.value = settings.coatType === "long" ? 1 : 0;
    requestedCoat.set(material, settings.coatType);
  }
  if (settings.sampling !== undefined)
    requestedSampling.set(material, settings.sampling);
  if (settings.volumeReplacement !== undefined) {
    uniforms.catFurVolumeReplacement.value = settings.volumeReplacement ? 1 : 0;
    material.userData.catFurOptics.volumeReplacement =
      settings.volumeReplacement;
  }
  if (settings.coverageFilter !== undefined) {
    uniforms.catFurCoverageFilter.value =
      settings.coverageFilter === "compact"
        ? 2
        : settings.coverageFilter === "box"
          ? 1
          : 0;
    material.userData.catFurOptics.coverageFilter = settings.coverageFilter;
  }
  if (settings.opaqueDepth !== undefined) {
    uniforms.catFurOpaqueDepth.value = settings.opaqueDepth;
    uniforms.catFurUseOpaqueDepth.value = settings.opaqueDepth ? 1 : 0;
  }
  if (
    settings.renderPass !== undefined &&
    settings.renderPass !== renderPassFor.get(material)
  ) {
    const accumulation = settings.renderPass === "accumulation";
    renderPassFor.set(material, settings.renderPass);
    const defines = (material.defines ??= {});
    if (accumulation) defines.CAT_FUR_MRT = 1;
    else delete defines.CAT_FUR_MRT;
    material.alphaToCoverage = !accumulation;
    material.depthWrite = !accumulation;
    material.transparent = false;
    material.premultipliedAlpha = false;
    material.blending = accumulation
      ? THREE.CustomBlending
      : THREE.NormalBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneFactor;
    // Switching pass is an infrequent compositor setup/fallback operation.
    // Changing coat, density, LOD or depth texture does not compile a program.
    material.needsUpdate = true;
  }
  if (settings.detailLevel !== undefined) {
    const detail = THREE.MathUtils.clamp(settings.detailLevel, 0.18, 1);
    requestedDetail.set(material, detail);
    // Representative-strand LOD width compensation is a preview compromise,
    // never a mutation of the user's physical strand widths or saved geometry.
    uniforms.catFurLodScale.value = Math.min(2.4, 1 / Math.sqrt(detail));
  }
}

/** Runtime-only state for the compositor; portable exports never copy it. */
export function getCatFurMaterialSettings(
  material: THREE.MeshStandardMaterial,
): Required<CatFurMaterialSettings> {
  const uniforms = uniformsFor.get(material);
  const metadataFilter = material.userData.catFurOptics?.coverageFilter;
  const filter =
    metadataFilter === "legacy" ||
    metadataFilter === "box" ||
    metadataFilter === "compact"
      ? metadataFilter
      : uniforms?.catFurCoverageFilter.value === 2
        ? "compact"
        : uniforms?.catFurCoverageFilter.value === 1
          ? "box"
          : "legacy";
  return {
    coatType: requestedCoat.get(material) ?? "short",
    detailLevel: requestedDetail.get(material) ?? 1,
    sampling: requestedSampling.get(material) ?? true,
    volumeReplacement:
      material.userData.catFurOptics?.volumeReplacement === true,
    coverageFilter: filter,
    renderPass: renderPassFor.get(material) ?? "preview",
    opaqueDepth: uniforms?.catFurOpaqueDepth.value ?? null,
  };
}

/** No preview shader / sampling flags leak into a portable static GLB. */
export function createCatFurExportMaterial(
  source: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: source.vertexColors,
    color: source.color.clone(),
    roughness: source.roughness,
    metalness: source.metalness,
    side: source.side,
    opacity: 1,
    alphaTest: 0,
    alphaToCoverage: false,
    transparent: false,
    depthWrite: true,
  });
  material.name = `${source.name}_PortablePBR`;
  material.userData.catFurExportFallback =
    "standard-PBR-original-strand-geometry";
  return material;
}
