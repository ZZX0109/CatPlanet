import * as THREE from "three";
import {
  configureCatFurMaterial,
  getCatFurMaterialSettings,
} from "./cat-fur-material";
import { createCatFurSegmentPreview } from "./cat-fur-segments";
import { configureCatFurVolumeMaterial } from "./cat-fur-volume-material";

export type CatFurCompositorInfo = {
  mode: "weighted" | "preview" | "opaque";
  supported: boolean;
  reason: string | null;
  width: number;
  height: number;
  opaqueSamples: number;
  geometryMode: "none" | "ribbons" | "segments" | "mixed" | "hybrid";
  segmentInstances: number;
  segmentBytes: number;
};

/**
 * Weighted blended OIT, using additive log revealage in the second attachment.
 * Only fibre meshes enter that pass. Opaque skin supplies resolved depth; final
 * composition happens in linear light before a single display transform.
 * Colour ordering remains an approximation (McGuire & Bavoil, JCGT 2013).
 */
export function createCatFurCompositor(
  renderer: THREE.WebGLRenderer,
  options: { preferOIT?: boolean } = {},
) {
  const context = renderer.getContext() as WebGL2RenderingContext;
  let supported =
    options.preferOIT !== false &&
    renderer.extensions.has("EXT_color_buffer_float") &&
    context.getParameter(context.MAX_DRAW_BUFFERS) >= 2 &&
    !renderer.capabilities.logarithmicDepthBuffer &&
    !renderer.capabilities.reversedDepthBuffer;
  let reason: string | null = supported
    ? null
    : options.preferOIT === false
      ? "disabled"
      : "float-targets-or-compatible-depth-unavailable";
  const dimensions = new THREE.Vector2();
  const viewport = new THREE.Vector4();
  const scissor = new THREE.Vector4();
  const clearColor = new THREE.Color();
  let disposed = false;
  let mode: CatFurCompositorInfo["mode"] = supported ? "weighted" : "preview";
  const samples = Math.min(4, renderer.capabilities.maxSamples);
  const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  depth.name = "CatFur_OpaqueDepth";
  depth.minFilter = depth.magFilter = THREE.NearestFilter;
  const opaque = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthTexture: depth,
    depthBuffer: true,
    stencilBuffer: false,
    samples,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  opaque.texture.name = "CatFur_OpaqueLinear";
  const fibres = new THREE.WebGLRenderTarget(1, 1, {
    count: 2,
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  fibres.textures[0].name = "CatFur_WeightedColour";
  fibres.textures[1].name = "CatFur_LogRevealage";
  const compositeMaterial = new THREE.ShaderMaterial({
    name: "CatFur_LinearComposite",
    uniforms: {
      opaqueColour: { value: opaque.texture },
      opaqueDepth: { value: depth },
      weightedColour: { value: fibres.textures[0] },
      logRevealage: { value: fibres.textures[1] },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D opaqueColour;
      uniform sampler2D opaqueDepth;
      uniform sampler2D weightedColour;
      uniform sampler2D logRevealage;
      void main() {
        vec3 base = texture2D(opaqueColour, vUv).rgb;
        vec4 weighted = texture2D(weightedColour, vUv);
        float tau = max(texture2D(logRevealage, vUv).r, 0.0);
        float alpha = 1.0 - exp(-tau);
        vec3 coat = weighted.rgb / max(weighted.a, 0.00001);
        // A literal scene Color is an unlit clear colour in Three, rather
        // than HDR radiance. Keep it unchanged across zero-fur/opaque/OIT
        // paths, including the shadow catcher's colour behind the fibres.
        bool backgroundPixel = texture2D(opaqueDepth, vUv).r >= 0.9999999;
        gl_FragColor = vec4(backgroundPixel ? coat : mix(base, coat, alpha), 1.0);
        #include <tonemapping_fragment>
        if (backgroundPixel) gl_FragColor.rgb = mix(base, gl_FragColor.rgb, alpha);
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: true,
  });
  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeometry, compositeMaterial);
  quad.frustumCulled = false;
  const compositeScene = new THREE.Scene();
  compositeScene.add(quad);
  const compositeCamera = new THREE.Camera();
  const managedMaterials = new Set<THREE.MeshStandardMaterial>();
  const segmentPreviews = new Map<
    THREE.Mesh,
    ReturnType<typeof createCatFurSegmentPreview>
  >();
  let geometryMode: CatFurCompositorInfo["geometryMode"] = "none";
  let segmentInstances = 0;
  const releaseSegments = () => {
    for (const preview of segmentPreviews.values()) preview.dispose();
    segmentPreviews.clear();
  };
  let targetsReleased = false;
  const releaseTargets = () => {
    if (targetsReleased) return;
    targetsReleased = true;
    // The opaque target owns its attached depth texture as well.
    opaque.dispose();
    fibres.dispose();
  };

  const materialsFor = (meshes: readonly THREE.Mesh[]) => {
    const result = new Set<THREE.MeshStandardMaterial>();
    for (const mesh of meshes)
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        if (
          material instanceof THREE.MeshStandardMaterial &&
          (material.userData.catFurOptics || material.userData.catFurVolume)
        ) {
          result.add(material);
          managedMaterials.add(material);
        }
    return result;
  };
  const configurePass = (
    material: THREE.MeshStandardMaterial,
    pass: "preview" | "accumulation",
    opaqueDepth: THREE.Texture | null,
  ) => {
    if (material.userData.catFurVolume) {
      configureCatFurVolumeMaterial(material, {
        renderPass: pass,
        opaqueDepth,
      });
    } else {
      const settings = getCatFurMaterialSettings(material);
      configureCatFurMaterial(material, {
        renderPass: pass,
        opaqueDepth,
        coverageFilter: settings.volumeReplacement
          ? "legacy"
          : settings.coverageFilter,
      });
    }
  };

  function preview(
    scene: THREE.Scene,
    camera: THREE.Camera,
    materials: Set<THREE.MeshStandardMaterial>,
  ) {
    mode = "preview";
    geometryMode = "ribbons";
    segmentInstances = 0;
    for (const material of materials) configurePass(material, "preview", null);
    renderer.render(scene, camera);
  }

  function render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    candidates: readonly THREE.Mesh[],
  ) {
    if (disposed) return;
    geometryMode = "none";
    segmentInstances = 0;
    const ribbons = candidates.filter(
      (mesh) =>
        (mesh.userData.furRegion || mesh.userData.furVolumeRegion) &&
        mesh.visible &&
        mesh.geometry.drawRange.count > 0,
    );
    const materials = materialsFor(ribbons);
    if (!ribbons.length || !materials.size) {
      mode = "opaque";
      renderer.render(scene, camera);
      return;
    }
    if (!supported) {
      preview(scene, camera, materials);
      return;
    }
    renderer.getDrawingBufferSize(dimensions);
    const width = Math.max(1, dimensions.x),
      height = Math.max(1, dimensions.y);
    if (opaque.width !== width || opaque.height !== height) {
      opaque.setSize(width, height);
      fibres.setSize(width, height);
    }
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    renderer.getViewport(viewport);
    renderer.getScissor(scissor);
    const previousScissorTest = renderer.getScissorTest();
    renderer.getClearColor(clearColor);
    const previousClearAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    const previousInfoReset = renderer.info.autoReset;
    const previousBackground = scene.background;
    const previousShadowAuto = renderer.shadowMap.autoUpdate;
    const previousShadowNeeds = renderer.shadowMap.needsUpdate;
    let consumedShadowNeeds = previousShadowNeeds;
    const visibility = new Map<THREE.Object3D, boolean>();
    const temporarySegments: THREE.Mesh[] = [];
    const remember = (object: THREE.Object3D, visible: boolean) => {
      if (!visibility.has(object)) visibility.set(object, object.visible);
      object.visible = visible;
    };
    const restoreVisibility = () => {
      for (const [object, visible] of visibility) object.visible = visible;
    };
    const restoreRenderer = () => {
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(previousScissorTest);
      renderer.setClearColor(clearColor, previousClearAlpha);
      renderer.autoClear = previousAutoClear;
      renderer.info.autoReset = previousInfoReset;
      renderer.shadowMap.autoUpdate = previousShadowAuto;
      // Preserve a caller's pending invalidation; do not request a second
      // expensive shadow render merely because the fur has its own pass.
      renderer.shadowMap.needsUpdate = consumedShadowNeeds;
    };
    let failure: unknown;
    try {
      renderer.autoClear = false;
      if (previousInfoReset) renderer.info.reset();
      renderer.info.autoReset = false;
      renderer.setScissorTest(false);
      for (const mesh of ribbons) remember(mesh, false);
      renderer.setRenderTarget(opaque);
      if (
        context.checkFramebufferStatus(context.FRAMEBUFFER) !==
        context.FRAMEBUFFER_COMPLETE
      )
        throw new Error("opaque-framebuffer-incomplete");
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
      consumedShadowNeeds = renderer.shadowMap.needsUpdate;

      // The resolved skin depth now exists; no opaque object is drawn into
      // the two-output hair target, and no shadow pass is repeated here.
      restoreVisibility();
      for (const material of materials)
        configurePass(material, "accumulation", depth);
      const drawMeshes: THREE.Mesh[] = [];
      let legacyCount = 0;
      for (const source of ribbons) {
        const material = Array.isArray(source.material)
          ? source.material[0]
          : source.material;
        const finite =
          material instanceof THREE.MeshStandardMaterial &&
          !material.userData.catFurVolume &&
          !getCatFurMaterialSettings(material).volumeReplacement &&
          getCatFurMaterialSettings(material).coverageFilter !== "legacy";
        if (!finite) {
          drawMeshes.push(source);
          legacyCount++;
          continue;
        }
        let preview = segmentPreviews.get(source);
        if (!preview) {
          preview = createCatFurSegmentPreview(source);
          segmentPreviews.set(source, preview);
        }
        if (!preview.sync()) continue;
        if (!source.parent) throw new Error("fur-source-parent-unavailable");
        source.parent.add(preview.mesh);
        temporarySegments.push(preview.mesh);
        remember(source, false);
        drawMeshes.push(preview.mesh);
        segmentInstances += preview.getInfo().instances;
      }
      geometryMode = ribbons.some((mesh) => mesh.userData.furVolumeRegion)
        ? "hybrid"
        : temporarySegments.length
          ? legacyCount
            ? "mixed"
            : "segments"
          : "ribbons";
      const ribbonSet = new Set<THREE.Object3D>(drawMeshes);
      scene.traverse((object) => {
        if (
          (object instanceof THREE.Mesh ||
            object instanceof THREE.Line ||
            object instanceof THREE.Points ||
            object instanceof THREE.Sprite) &&
          !ribbonSet.has(object)
        )
          remember(object, false);
      });
      scene.background = null;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.setRenderTarget(fibres);
      if (
        context.checkFramebufferStatus(context.FRAMEBUFFER) !==
        context.FRAMEBUFFER_COMPLETE
      )
        throw new Error("fur-framebuffer-incomplete");
      renderer.setClearColor(0, 0);
      renderer.clear(true, false, false);
      renderer.render(scene, camera);

      restoreVisibility();
      for (const proxy of temporarySegments) proxy.removeFromParent();
      scene.background = previousBackground;
      restoreRenderer();
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      renderer.clear(true, true, false);
      renderer.render(compositeScene, compositeCamera);
      mode = "weighted";
    } catch (error) {
      failure = error;
      supported = false;
      reason =
        error instanceof Error ? error.message : "fur-compositing-unavailable";
    } finally {
      restoreVisibility();
      for (const proxy of temporarySegments) proxy.removeFromParent();
      scene.background = previousBackground;
      restoreRenderer();
    }
    if (failure) {
      releaseTargets();
      releaseSegments();
      preview(scene, camera, materials);
    }
  }

  return {
    render,
    getInfo(): CatFurCompositorInfo {
      return {
        mode,
        supported,
        reason,
        width: opaque.width,
        height: opaque.height,
        opaqueSamples: samples,
        geometryMode,
        segmentInstances,
        segmentBytes: [...segmentPreviews.values()].reduce(
          (sum, preview) => sum + preview.getInfo().bytes,
          0,
        ),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of managedMaterials)
        configurePass(material, "preview", null);
      managedMaterials.clear();
      releaseSegments();
      releaseTargets();
      quadGeometry.dispose();
      compositeMaterial.dispose();
    },
  };
}
