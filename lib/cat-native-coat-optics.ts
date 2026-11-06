import * as THREE from "three";

/** Offline/live-QA surface approximation, not a single-fibre scattering model. */
export type NativeCoatOpticsSettings = {
  anisotropy: number;
  sheen: number;
  sheenRoughness: number;
  /** Compare both axes; a surface ridge's broad roughness axis is cross-ridge. */
  roughnessAxis: "along" | "across";
  diagnostic?: boolean;
  /** Attribution diagnostic; 1 preserves the original, 0 isolates mesh form. */
  normalStrength?: number;
  /** Attribution diagnostic; replace only coat albedo with 18% linear grey. */
  flatAlbedo?: boolean;
};

type MomentMip = { width: number; height: number; rgba8Data: Uint8Array };
type MaterialRegistry = {
  meshes: THREE.Mesh[];
  materials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
};

const pars = /* glsl */ `
uniform sampler2D catNativeCoatMoments;
uniform float catNativeCoatAcross;
uniform float catNativeCoatDiagnostic;
`;

const optics = /* glsl */ `
// The texture stores confidence-weighted double-angle moments in the original
// Blender UV-up basis. Its row zero already matches the GLB's image row zero.
// Decode AFTER filtering so +/- line signs cannot cancel into a false axis.
vec3 catCoatSample = texture2D(catNativeCoatMoments, vNormalMapUv).rgb;
vec2 catCoatMoment = catCoatSample.rg * 2.0 - 1.0;
float catCoatConfidence = catCoatSample.b;
float catCoatMomentLength = length(catCoatMoment);
// An RGBA8 neutral value cannot encode exact signed zero. Do not turn that
// quantisation residual into a real direction at unknown/crossing texels.
if (catCoatConfidence == 0.0 || catCoatMomentLength <= 0.00555) {
  catCoatMomentLength = 0.0;
  catCoatMoment = vec2(1.0, 0.0);
}
float catCoatTheta = 0.5 * atan(catCoatMoment.y, catCoatMoment.x);
vec2 catCoatAxis = vec2(cos(catCoatTheta), -sin(catCoatTheta));
// Recover the actual UV Jacobian: a non-square/stretching chart is not an
// orthonormal tangent frame. The minus sin term is the only UV-up -> down flip.
vec3 catCoatDx = dFdx(-vViewPosition);
vec3 catCoatDy = dFdy(-vViewPosition);
vec2 catCoatUx = dFdx(vNormalMapUv);
vec2 catCoatUy = dFdy(vNormalMapUv);
float catCoatDet = catCoatUx.x * catCoatUy.y - catCoatUx.y * catCoatUy.x;
float catCoatSafeDet = abs(catCoatDet) > 1e-12 ? catCoatDet : 1.0;
vec3 catCoatDu = (catCoatDx * catCoatUy.y - catCoatDy * catCoatUx.y) / catCoatSafeDet;
vec3 catCoatDv = (catCoatDy * catCoatUx.x - catCoatDx * catCoatUy.x) / catCoatSafeDet;
vec3 catCoatTangent = catCoatDu * catCoatAxis.x + catCoatDv * catCoatAxis.y;
catCoatTangent -= normal * dot(normal, catCoatTangent);
float catCoatTangentLength = length(catCoatTangent);
float catCoatDirectionWeight = min(catCoatConfidence, catCoatMomentLength);
if (abs(catCoatDet) <= 1e-12 || catCoatTangentLength <= 1e-8) {
  catCoatDirectionWeight = 0.0;
  vec3 catCoatFallback = abs(normal.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  catCoatTangent = normalize(cross(catCoatFallback, normal));
} else {
  catCoatTangent /= catCoatTangentLength;
}
vec3 catCoatBitangent = normalize(cross(normal, catCoatTangent));
#ifdef USE_ANISOTROPY
  material.anisotropy = saturate(length(anisotropyVector) * catCoatDirectionWeight);
  material.alphaT = mix(pow2(material.roughness), 1.0, pow2(material.anisotropy));
  material.anisotropyT = mix(catCoatTangent, catCoatBitangent, catNativeCoatAcross);
  material.anisotropyB = normalize(cross(normal, material.anisotropyT));
#endif
#ifdef USE_SHEEN
  // Keep Three's sheen energy compensation and authored colour/roughness.
  // This is a weak surface lobe, never an additive white rim or emissive boost.
  material.sheenColor *= catCoatConfidence;
#endif
`;

function settingsValid(settings: NativeCoatOpticsSettings) {
  for (const value of [settings.anisotropy, settings.sheen, settings.sheenRoughness])
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error("Native coat optical settings must be finite, from 0 to 1.");
  if (settings.roughnessAxis !== "along" && settings.roughnessAxis !== "across")
    throw new Error("Native coat roughness axis must be along or across.");
  if (!Number.isFinite(settings.normalStrength ?? 1) || (settings.normalStrength ?? 1) < 0 || (settings.normalStrength ?? 1) > 2)
    throw new Error("Native coat normal diagnostic must be from 0 to 2.");
}

/**
 * Reversible QA adapter around the ACTUAL model materials. Borrows all source
 * maps, leaves meshes/UV/morphs/rig/lights untouched and owns only one moment
 * texture plus the replacement materials. It is intentionally not the default
 * renderer. Restore before disposing the source model; export requires either
 * a reviewed standard-material fallback or a separately baked anisotropy map.
 */
export function createNativeCoatOpticsStudy(
  model: MaterialRegistry,
  mips: readonly MomentMip[],
  initial: NativeCoatOpticsSettings,
) {
  settingsValid(initial);
  if (!mips.length) throw new Error("Native coat moment mip chain is empty.");
  let width = mips[0].width, height = mips[0].height;
  for (const mip of mips) {
    if (mip.width !== width || mip.height !== height || mip.rgba8Data.length !== width * height * 4)
      throw new Error("Invalid native coat moment mip chain.");
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
  if (mips.at(-1)!.width !== 1 || mips.at(-1)!.height !== 1)
    throw new Error("Native coat moment mip chain must end at 1x1.");
  const texture = new THREE.DataTexture(mips[0].rgba8Data, mips[0].width, mips[0].height);
  texture.name = "NativeCoat_ConfidenceWeightedDoubleAngle";
  texture.mipmaps = mips.map((mip) => ({ data: mip.rgba8Data, width: mip.width, height: mip.height }));
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  const across = { value: initial.roughnessAxis === "across" ? 1 : 0 };
  const diagnostic = { value: initial.diagnostic ? 1 : 0 };
  const normalStrength = { value: initial.normalStrength ?? 1 };
  const flatAlbedo = { value: initial.flatAlbedo ?? false };
  const replacements = new Map<THREE.Material, THREE.MeshPhysicalMaterial>();
  const registry = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  let disposed = false;

  function replacement(source: THREE.Material) {
    const standard = source as THREE.MeshStandardMaterial;
    if (!standard.isMeshStandardMaterial || !standard.normalMap ||
      /eye|iris|cornea|pupil/i.test(String(source.userData.creatorRole ?? "") + source.name) ||
      source.userData.creatorEyeSide !== undefined)
      return source;
    if (replacements.has(source)) return replacements.get(source)!;
    if (standard.normalMap.channel !== 0 || standard.normalMap.rotation !== 0 ||
      standard.normalMap.offset.lengthSq() !== 0 ||
      standard.normalMap.repeat.x !== 1 || standard.normalMap.repeat.y !== 1)
      throw new Error("Native coat study requires the reviewed identity UV0 mapping.");
    const material = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(material, standard);
    material.defines = { STANDARD: "", PHYSICAL: "" };
    material.name = `${source.name}_NativeCoatOpticsStudy`;
    material.sheenColor.setRGB(1, 1, 1);
    material.sheenColorMap = standard.map;
    material.clearcoat = material.transmission = material.iridescence = 0;
    const originalCompile = source.onBeforeCompile;
    const originalKey = source.customProgramCacheKey.call(source);
    material.onBeforeCompile = function (shader, renderer) {
      originalCompile.call(this, shader, renderer);
      shader.uniforms.catNativeCoatMoments = { value: texture };
      shader.uniforms.catNativeCoatAcross = across;
      shader.uniforms.catNativeCoatDiagnostic = diagnostic;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${pars}`)
        .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>\n${optics}`)
        .replace("#include <opaque_fragment>", "outgoingLight = mix(outgoingLight, vec3(catCoatConfidence), catNativeCoatDiagnostic);\n#include <opaque_fragment>");
    };
    material.customProgramCacheKey = () => `${originalKey}|native-coat-optics-study-v1`;
    material.onBeforeRender = function (renderer, scene, camera, geometry, object, group) {
      source.onBeforeRender.call(this, renderer, scene, camera, geometry, object, group);
      // The existing model's tuner keeps owning the borrowed scalar settings.
      material.normalScale.copy(standard.normalScale).multiplyScalar(normalStrength.value);
      material.roughness = standard.roughness;
      material.metalness = standard.metalness;
      if (flatAlbedo.value) material.color.setRGB(.18, .18, .18);
      else material.color.copy(standard.color);
    };
    replacements.set(source, material);
    return material;
  }

  function restore() {
    for (const [mesh, original] of registry) {
      const current = model.materials.get(mesh);
      if (Array.isArray(current) ? current.some((m) => [...replacements.values()].includes(m as THREE.MeshPhysicalMaterial)) : current && [...replacements.values()].includes(current as THREE.MeshPhysicalMaterial))
        model.materials.set(mesh, original);
      const owned = Array.isArray(mesh.material) ? mesh.material.some((m) => [...replacements.values()].includes(m as THREE.MeshPhysicalMaterial)) : [...replacements.values()].includes(mesh.material as THREE.MeshPhysicalMaterial);
      if (owned) mesh.material = original;
    }
  }

  function update(settings: NativeCoatOpticsSettings) {
    if (disposed) return;
    settingsValid(settings);
    across.value = settings.roughnessAxis === "across" ? 1 : 0;
    diagnostic.value = settings.diagnostic ? 1 : 0;
    normalStrength.value = settings.normalStrength ?? 1;
    flatAlbedo.value = settings.flatAlbedo ?? false;
    for (const [source, material] of replacements) {
      const map = flatAlbedo.value ? null : (source as THREE.MeshStandardMaterial).map;
      if (material.map !== map) {
        material.map = map;
        material.needsUpdate = true;
      }
      // Keep an anisotropic shader variant for the checked derivative frame,
      // including the zero-strength control capture (uniform strength is zero).
      material.anisotropy = Math.max(settings.anisotropy, 1e-8);
      material.sheen = settings.sheen;
      material.sheenRoughness = settings.sheenRoughness;
      material.userData.nativeCoatOpticsStudy = { ...settings, approximation: "source-surface-only; not fibre BSDF or volumetric fur" };
    }
  }
  try {
    for (const mesh of model.meshes) {
      const original = model.materials.get(mesh);
      if (!original) continue;
      const changed = Array.isArray(original) ? original.map(replacement) : replacement(original);
      if (Array.isArray(original) ? original.every((m, i) => m === (changed as THREE.Material[])[i]) : original === changed) continue;
      registry.set(mesh, original);
      model.materials.set(mesh, changed);
      if (mesh.material === original) mesh.material = changed;
    }
    update(initial);
  } catch (error) {
    restore();
    for (const material of replacements.values()) material.dispose();
    texture.dispose();
    throw error;
  }
  return {
    materials: [...replacements.values()],
    texture,
    update,
    dispose() {
      if (disposed) return;
      restore();
      disposed = true;
      for (const material of replacements.values()) material.dispose();
      texture.dispose();
      registry.clear();
      replacements.clear();
    },
  };
}
