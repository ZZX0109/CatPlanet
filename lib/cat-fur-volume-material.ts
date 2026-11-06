import * as THREE from "three";
import { catFurDirectLightingGLSL } from "./cat-fur-material";

export type CatFurVolumeMaterialSettings = {
  /** Accumulation needs the compositor's two linear floating-point targets. */
  renderPass?: "preview" | "accumulation";
  /** Resolved ordinary depth, from the same camera and physical viewport. */
  opaqueDepth?: THREE.Texture | null;
  /** Extinction per local scene unit; one scene unit represents about 100 mm. */
  extinctionScale?: number;
  /** Caller-owned NoColorSpace RGBA: linear root RGB * normalised kappa, kappa. */
  densityTexture?: THREE.Data3DTexture | null;
  /** Maximum kappa, in inverse scene units, used to decode texture alpha. */
  densityScale?: number;
  /** Atlas crop mapping: scale U/V, then offset U/V. Copied on configure. */
  densityUvTransform?: THREE.Vector4;
};

export type CatFurVolumeMaterialOptions = {
  /** Single-winding side slices; the shell variant remains front-sided. */
  fins?: boolean;
};

type VolumeUniforms = {
  catVolumeViewport: { value: THREE.Vector2 };
  catVolumeOpaqueDepth: { value: THREE.Texture | null };
  catVolumeHasOpaqueDepth: { value: number };
  catVolumeExtinction: { value: number };
  catVolumeDensityTexture: { value: THREE.Data3DTexture | null };
  catVolumeHasDensityTexture: { value: number };
  catVolumeDensityScale: { value: number };
  catVolumeDensityUvTransform: { value: THREE.Vector4 };
  catFurLongCoat: { value: number };
};

const uniformsFor = new WeakMap<THREE.MeshStandardMaterial, VolumeUniforms>();
const passesFor = new WeakMap<
  THREE.MeshStandardMaterial,
  "preview" | "accumulation"
>();

const vertexParameters = /* glsl */ `
attribute vec3 furBindPosition;
attribute float furVolumeDepth;
attribute float furVolumeThickness;
attribute vec3 furVolumeTangent;
attribute float furVolumeDensity;
attribute float furVolumeEnvelope;
varying vec3 vCatVolumeBind;
varying vec3 vCatVolumeTangent;
varying vec3 vCatVolumeNormal;
varying vec2 vCatVolumeUv;
#ifndef CAT_FUR_VOLUME_FINS
// Actual per-layer geometry derivative; shading direction is independent.
attribute vec3 furVolumeStep;
varying vec3 vCatVolumeStepView;
#endif
// Mid-layer depth, physical layer thickness, root density, local envelope.
varying vec4 vCatVolumeParameters;
#ifdef CAT_FUR_VOLUME_FINS
attribute float furVolumeFin;
attribute vec3 furVolumeViewNormal;
varying float vCatVolumeFin;
varying vec3 vCatVolumeViewNormal;
#endif
`;

const vertexSetup = /* glsl */ `
// Geometry already contains the posed, extruded shell. Never extrude twice.
vCatVolumeBind = furBindPosition;
vCatVolumeTangent = mat3( modelViewMatrix ) * furVolumeTangent;
vCatVolumeNormal = transformedNormal;
#ifndef CAT_FUR_VOLUME_FINS
// A displacement transforms as a vector, not a normal. Its magnitude is the
// real layer step and must survive model/view transforms and interpolation.
vCatVolumeStepView = mat3( modelViewMatrix ) * furVolumeStep;
#endif
// Original atlas UVs are required even if the base has no albedo texture.
vCatVolumeUv = uv;
vCatVolumeParameters = vec4( furVolumeDepth, furVolumeThickness,
  furVolumeDensity, furVolumeEnvelope );
#ifdef CAT_FUR_VOLUME_FINS
vCatVolumeFin = furVolumeFin;
vCatVolumeViewNormal = normalMatrix * furVolumeViewNormal;
#endif
`;

const fragmentParameters = /* glsl */ `
varying vec3 vCatVolumeBind;
varying vec3 vCatVolumeTangent;
varying vec3 vCatVolumeNormal;
varying vec2 vCatVolumeUv;
#ifndef CAT_FUR_VOLUME_FINS
varying vec3 vCatVolumeStepView;
#endif
varying vec4 vCatVolumeParameters;
uniform vec2 catVolumeViewport;
uniform sampler2D catVolumeOpaqueDepth;
uniform float catVolumeHasOpaqueDepth;
uniform float catVolumeExtinction;
uniform highp sampler3D catVolumeDensityTexture;
uniform float catVolumeHasDensityTexture;
uniform float catVolumeDensityScale;
uniform vec4 catVolumeDensityUvTransform;
uniform float catFurLongCoat;
// Set once in main, before alpha and lighting. RGB is linear root albedo
// multiplied by A; A stores normalised extinction, never shell opacity.
vec4 catVolumeBakedSample;
#ifdef CAT_FUR_VOLUME_FINS
varying float vCatVolumeFin;
varying vec3 vCatVolumeViewNormal;
#endif
#ifdef CAT_FUR_VOLUME_MRT
layout(location = 1) out highp vec4 catVolumeOpticalDepth;
#endif

vec3 catFurTangent() {
  float tangentLength = dot( vCatVolumeTangent, vCatVolumeTangent );
  return tangentLength > 1e-16
    ? vCatVolumeTangent * inversesqrt( tangentLength )
    : vec3( 0.0, 1.0, 0.0 );
}

float catVolumeSinc( float x ) {
  // Taylor limit avoids 0/0 at front-facing, locally constant coordinates.
  return abs( x ) < 0.001 ? 1.0 - x * x / 6.0 : sin( x ) / x;
}

float catVolumeFilteredWave( vec3 p, vec3 frequency, float phase ) {
  float argument = dot( p, frequency ) + phase;
  // Integrate this analytic density mode over the local pixel footprint.
  // Unresolved variation converges to its mean instead of producing freckles.
  float integral = catVolumeSinc( 0.5 * dFdx( argument ) )
    * catVolumeSinc( 0.5 * dFdy( argument ) );
  return sin( argument ) * integral;
}

float catVolumeDensity() {
  float h = clamp( vCatVolumeParameters.x, 0.0, 1.0 );
  // The fixed reference position prevents density swimming during animation.
  // Coherent depth shear makes this a 3D medium, rather than unrelated dots
  // on each layer. This is procedural microdensity, not a baked curve field.
  vec3 p = vCatVolumeBind + h * vec3( 0.006, -0.004, 0.009 );
  float coarse = catVolumeFilteredWave( p, vec3( 113.0, 71.0, -53.0 ), 0.4 );
  float fineA = catVolumeFilteredWave( p, vec3( -481.0, 719.0, 337.0 ), 1.7 );
  float fineB = catVolumeFilteredWave( p, vec3( 887.0, 293.0, -613.0 ), 4.1 );
  float profile = pow( max( 1.0 - h, 0.0 ), 0.8 );
  float microdensity = max( 0.15, 1.0 + 0.22 * coarse + 0.16 * fineA + 0.12 * fineB );
  return clamp( vCatVolumeParameters.z, 0.0, 1.0 ) * profile * microdensity;
}

float catVolumeViewOpticalDepth() {
  vec3 N = normalize( vCatVolumeNormal );
  vec3 V = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
  float skinCosine = abs( dot( N, V ) );
  // Both variants use the same skin frame. Shells represent front-facing
  // medium; side slices gradually replace them close to the silhouette.
  // This is a view-dependent partition, not an exact volumetric reconstruction.
  float finShare = 1.0 - smoothstep( 0.16, 0.46, skinCosine );
  float representationWeight = 1.0 - finShare;
  float pathCosine = max( skinCosine, 0.2 );
  float normalStep = max( vCatVolumeParameters.y, 0.0 );
  #ifndef CAT_FUR_VOLUME_FINS
    // Use the actual current shell surface, including envelope slopes and
    // shear. Normal maps and the separate fibre direction do not change this
    // geometric integration metric. Evaluate derivatives before any discard.
    vec3 surfaceCross = cross( dFdx( -vViewPosition ), dFdy( -vViewPosition ) );
    float surfaceMagnitude = dot( surfaceCross, surfaceCross );
    vec3 shellNormal = surfaceMagnitude > 1e-24
      ? surfaceCross * inversesqrt( surfaceMagnitude ) : N;
    normalStep = abs( dot( vCatVolumeStepView, shellNormal ) );
    pathCosine = max( abs( dot( V, shellNormal ) ), 0.2 );
  #endif
  #ifdef CAT_FUR_VOLUME_FINS
    vec3 finNormal = vCatVolumeViewNormal;
    float finLength = dot( finNormal, finNormal );
    float finCosine = finLength > 1e-16
      ? abs( dot( finNormal * inversesqrt( finLength ), V ) ) : 0.0;
    float finFacing = smoothstep( 0.04, 0.26, finCosine );
    float isFin = step( 0.5, vCatVolumeFin );
    representationWeight = mix( representationWeight, finShare * finFacing, isFin );
    pathCosine = mix( pathCosine, max( finCosine, 0.2 ), isFin );
  #endif
  // Shells project their actual layer step onto their own geometric normal.
  // Fins keep their source-edge transverse spacing and fin-view normal path.
  // The grazing-angle clamp is a shell approximation, not exact ray marching.
  float extinction;
  if ( catVolumeHasDensityTexture > 0.5 ) {
    // The bake already contains the depth profile and individual-curve field.
    // Region/user density is applied once here, independently of resolution.
    extinction = clamp( catVolumeBakedSample.a, 0.0, 1.0 ) * catVolumeDensityScale
      * clamp( vCatVolumeParameters.z, 0.0, 1.0 );
  } else {
    extinction = catVolumeExtinction * catVolumeDensity();
  }
  return extinction * normalStep
    * representationWeight / pathCosine;
}

float catVolumeLightVisibility( vec3 N, vec3 L ) {
  float h = clamp( vCatVolumeParameters.x, 0.0, 1.0 );
  float remainingHeight = max( vCatVolumeParameters.w, 0.0 ) * ( 1.0 - h );
  float lightCosine = max( abs( dot( N, L ) ), 0.3 );
  float tau = catVolumeExtinction * remainingHeight
    * clamp( vCatVolumeParameters.z, 0.0, 1.0 ) * 0.45 / lightCosine;
  if ( catVolumeHasDensityTexture > 0.5 ) {
    // Still a local shadow estimate, not integration through the full bake.
    tau = clamp( catVolumeBakedSample.a, 0.0, 1.0 ) * catVolumeDensityScale
      * remainingHeight * clamp( vCatVolumeParameters.z, 0.0, 1.0 ) * 0.45 / lightCosine;
  }
  // Bounded local attenuation leaves room for unmodelled multiple scattering.
  // Only direct light is affected; no uniform dark coat/extra light is added.
  // A real light-space optical-depth field can replace this local estimate.
  return 0.72 + 0.28 * exp( -min( tau, 12.0 ) );
}
`;

const volumeDirectLighting = catFurDirectLightingGLSL
  .replaceAll("directLight.color", "catVolumeDirectColour")
  .replace(
    "vec3 V = geometryViewDir;",
    `vec3 V = geometryViewDir;
  vec3 catVolumeDirectColour = directLight.color
    * catVolumeLightVisibility( normalize( vCatVolumeNormal ), L );`,
  );

/**
 * Experimental shell medium, using actual posed shell geometry and original UVs.
 * Required attributes are declared above. Shells additionally require an
 * unnormalised model-space furVolumeStep = dP/dh / layerCount. Fins never read
 * that attribute: their thickness remains the source-edge transverse spacing.
 * Without a density texture, the procedural density is not a reconstruction
 * of individual animal hairs. Optional density textures must contain linear
 * root RGB multiplied by normalised kappa, followed by that normalised kappa
 * in alpha, indexed by optionally remapped native UV and h. Filtering that premultiplied density
 * field preserves root colour at transitions into empty voxels.
 * Its shell sampling, local shadow estimate and weighted colour are approximate.
 * The material borrows all textures, including caller-owned density textures;
 * disposing it never disposes textures. The caller sets texture format, linear
 * filtering and NoColorSpace before binding this linear numerical field;
 * neither RGB nor kappa must undergo an additional sRGB transfer conversion.
 */
export function createCatFurVolumeMaterial(
  base: THREE.MeshStandardMaterial,
  options: CatFurVolumeMaterialOptions = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial().copy(base);
  const fins = options.fins === true;
  material.name = fins
    ? "CatFur_ContinuousUndercoat_Fins"
    : "CatFur_ContinuousUndercoat";
  material.userData = {
    catFurVolume: {
      version: 7,
      geometry: fins ? "silhouette-fins" : "shells",
      integrationMetric: fins
        ? "source-edge-spacing-and-fin-normal"
        : "projected-geometry-layer-step-and-shell-normal",
      density: "reference-bound-filtered-procedural-prototype",
      sampleMode: "procedural",
      textureEncoding: "linear-root-rgb-times-normalised-kappa-and-kappa",
      textureColourSpace: "NoColorSpace-linear-data",
      densityUvTransform: [1, 1, 0, 0],
      coverage: "shell-optical-depth",
      shadow: "bounded-local-approximation",
      export: "preview-only-original-strands-remain-authoritative",
    },
  };
  material.roughness = Math.max(base.roughness, 0.86);
  material.metalness = 0;
  // Preserve the base's real coat normal detail; source vectors are copied,
  // while texture objects are borrowed and remain owned by the live model.
  material.side = fins ? THREE.DoubleSide : THREE.FrontSide;
  const defines = (material.defines ??= {});
  if (fins) defines.CAT_FUR_VOLUME_FINS = 1;
  else delete defines.CAT_FUR_VOLUME_FINS;
  material.alphaTest = 0;
  material.alphaToCoverage = false;
  material.depthWrite = false;
  material.depthTest = true;
  material.transparent = true;
  material.premultipliedAlpha = false;
  material.blending = THREE.NormalBlending;

  const uniforms: VolumeUniforms = {
    catVolumeViewport: { value: new THREE.Vector2(1, 1) },
    catVolumeOpaqueDepth: { value: null },
    catVolumeHasOpaqueDepth: { value: 0 },
    catVolumeExtinction: { value: 120 },
    catVolumeDensityTexture: { value: null },
    catVolumeHasDensityTexture: { value: 0 },
    catVolumeDensityScale: { value: 1 },
    catVolumeDensityUvTransform: { value: new THREE.Vector4(1, 1, 0, 0) },
    catFurLongCoat: { value: 1 },
  };
  uniformsFor.set(material, uniforms);
  passesFor.set(material, "preview");
  const viewport = new THREE.Vector4();
  material.onBeforeRender = (renderer) => {
    renderer.getCurrentViewport(viewport);
    uniforms.catVolumeViewport.value.set(viewport.z, viewport.w);
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${vertexParameters}`)
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>\n${vertexSetup}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <lights_physical_pars_fragment>",
        `#include <lights_physical_pars_fragment>\n${fragmentParameters}\n${volumeDirectLighting}`,
      )
      .replace(
        "#include <map_fragment>",
        `
        catVolumeBakedSample = vec4( 0.0 );
        if ( catVolumeHasDensityTexture > 0.5 ) {
          // Do not multiply this root colour by the original surface map or
          // material tint again. Recover root albedo after trilinear filtering
          // of RGB*kappa and kappa, avoiding black fringes at empty voxels.
          catVolumeBakedSample = texture( catVolumeDensityTexture,
            vec3( clamp( vCatVolumeUv * catVolumeDensityUvTransform.xy
              + catVolumeDensityUvTransform.zw, vec2( 0.0 ), vec2( 1.0 ) ),
              clamp( vCatVolumeParameters.x, 0.0, 1.0 ) ) );
          if ( catVolumeBakedSample.a > 0.00000001 ) {
            diffuseColor.rgb = max( catVolumeBakedSample.rgb, vec3( 0.0 ) )
              / catVolumeBakedSample.a;
          }
        } else {
          #include <map_fragment>
        }
      `,
      )
      .replace(
        "#include <color_fragment>",
        `if ( catVolumeHasDensityTexture < 0.5 ) {
          #include <color_fragment>
        }`,
      )
      .replace(
        "#include <alphatest_fragment>",
        `
        // Retain actual partial opacity; alpha testing or A2C would turn the
        // sampled medium into hard dots. Evaluate derivatives before discard.
        float catVolumeTau = catVolumeViewOpticalDepth()
          * clamp( diffuseColor.a, 0.0, 1.0 );
        diffuseColor.a = 1.0 - exp( -min( catVolumeTau, 20.0 ) );
        if ( diffuseColor.a <= 0.000001 ) discard;
        if ( catVolumeHasOpaqueDepth > 0.5 ) {
          vec2 depthUv = gl_FragCoord.xy / max( catVolumeViewport, vec2( 1.0 ) );
          if ( gl_FragCoord.z > texture2D( catVolumeOpaqueDepth, depthUv ).r + 0.000001 ) discard;
        }
      `,
      )
      .replace(
        "#include <normal_fragment_begin>",
        `
        // Two-sided fin rasterization must not flip the outward skin shading
        // frame according to the arbitrary winding of a side-slice polygon.
        #ifdef CAT_FUR_VOLUME_FINS
          #undef DOUBLE_SIDED
        #endif
        #include <normal_fragment_begin>
      `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        #ifdef CAT_FUR_VOLUME_FINS
          #define DOUBLE_SIDED
        #endif
      `,
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        #ifdef CAT_FUR_VOLUME_MRT
          float volumeAlpha = clamp( diffuseColor.a, 0.0, 1.0 );
          gl_FragColor = vec4( max( gl_FragColor.rgb, vec3( 0.0 ) ) * volumeAlpha, volumeAlpha );
          // Unlike independent segment coverage, this is sampled medium
          // extinction. Sum the per-slab optical depths directly.
          catVolumeOpticalDepth = vec4( min( catVolumeTau, 20.0 ), 0.0, 0.0, 0.0 );
        #endif
      `,
      );
  };
  material.customProgramCacheKey = () =>
    `cat-fur-continuous-undercoat-v7-${fins ? "fins" : "shells"}-${passesFor.get(material) ?? "preview"}`;
  return material;
}

export function configureCatFurVolumeMaterial(
  material: THREE.MeshStandardMaterial,
  settings: CatFurVolumeMaterialSettings,
): void {
  const uniforms = uniformsFor.get(material);
  if (!uniforms) return;
  if (settings.densityUvTransform !== undefined) {
    const transform = settings.densityUvTransform;
    if (
      [transform.x, transform.y, transform.z, transform.w].every(
        Number.isFinite,
      )
    ) {
      uniforms.catVolumeDensityUvTransform.value.copy(transform);
      material.userData.catFurVolume.densityUvTransform = transform.toArray();
    }
  }
  if (settings.densityTexture !== undefined) {
    uniforms.catVolumeDensityTexture.value = settings.densityTexture;
    uniforms.catVolumeHasDensityTexture.value = settings.densityTexture ? 1 : 0;
    material.userData.catFurVolume.sampleMode = settings.densityTexture
      ? "baked-strand-density"
      : "procedural";
    material.userData.catFurVolume.density = settings.densityTexture
      ? "caller-owned-linear-kappa-premultiplied-root-colour-and-normalised-extinction"
      : "reference-bound-filtered-procedural-prototype";
  }
  if (settings.densityScale !== undefined) {
    if (Number.isFinite(settings.densityScale))
      uniforms.catVolumeDensityScale.value = THREE.MathUtils.clamp(
        settings.densityScale,
        0,
        1_000_000,
      );
  }
  if (settings.extinctionScale !== undefined) {
    if (Number.isFinite(settings.extinctionScale))
      uniforms.catVolumeExtinction.value = THREE.MathUtils.clamp(
        settings.extinctionScale,
        0,
        1000,
      );
  }
  if (settings.opaqueDepth !== undefined) {
    uniforms.catVolumeOpaqueDepth.value = settings.opaqueDepth;
    uniforms.catVolumeHasOpaqueDepth.value = settings.opaqueDepth ? 1 : 0;
  }
  if (
    settings.renderPass !== undefined &&
    settings.renderPass !== passesFor.get(material)
  ) {
    const accumulation = settings.renderPass === "accumulation";
    passesFor.set(material, settings.renderPass);
    const defines = (material.defines ??= {});
    if (accumulation) defines.CAT_FUR_VOLUME_MRT = 1;
    else delete defines.CAT_FUR_VOLUME_MRT;
    material.transparent = !accumulation;
    material.depthTest = !accumulation;
    material.depthWrite = false;
    material.alphaToCoverage = false;
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
    // Only pass changes compile. Density, layer thickness, colour and depth
    // updates keep the program and borrowed textures alive.
    material.needsUpdate = true;
  }
}
