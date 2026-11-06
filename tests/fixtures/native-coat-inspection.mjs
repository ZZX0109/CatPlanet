/** Install read-only, actual Object3D draw observation into the live studio. */
export function installNativeCoatInspection() {
  function locate() {
    const canvas = document.querySelector("canvas");
    let fiber =
      canvas[Object.keys(canvas).find((key) => key.startsWith("__reactFiber"))];
    while (
      fiber &&
      (!fiber.memoizedProps?.model || !fiber.memoizedProps?.design)
    )
      fiber = fiber.return;
    if (!fiber) throw Error("Live creator model not found");
    return { canvas, ...fiber.memoizedProps };
  }
  const { model } = locate();
  window.__nativeCoatDraws = [];
  window.__nativeCoatAnalyticDraws = [];
  model.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const original = mesh.onBeforeRender;
    mesh.onBeforeRender = function (...args) {
      original.apply(this, args);
      const geometry = args[3],
        maximum = geometry.index?.count ?? geometry.attributes.position.count;
      const effectiveCount = Math.max(
        0,
        Math.min(geometry.drawRange.count, maximum - geometry.drawRange.start),
      );
      if (effectiveCount === 0) return;
      window.__nativeCoatDraws.push({
        uuid: mesh.uuid,
        name: mesh.name,
        native: model.meshes.includes(mesh),
        furRegion: mesh.userData.furRegion ?? null,
        volumeRegion: mesh.userData.furVolumeRegion ?? null,
        undercoat: !!mesh.userData.undercoat,
        pass: args[0].getRenderTarget()?.texture?.name ?? "screen",
        drawRange: { ...args[3].drawRange },
        effectiveCount,
      });
    };
    const originalAfter = mesh.onAfterRender;
    mesh.onAfterRender = function (...args) {
      if (["head", "ruff", "body"].includes(mesh.userData.furRegion)) {
        const renderer = args[0], gl = renderer.getContext();
        const program = gl.getParameter(gl.CURRENT_PROGRAM);
        if (program) {
          const location = gl.getUniformLocation(program, "catFurHasAnalyticTangent");
          if (location !== null) window.__nativeCoatAnalyticDraws.push({
            uuid: mesh.uuid, region: mesh.userData.furRegion,
            pass: renderer.getRenderTarget()?.texture?.name ?? "screen",
            uniform: gl.getUniform(program, location),
            rasterAxisUniform: (() => {
              const axis = gl.getUniformLocation(program, "catFurCurveRasterAxis");
              return axis === null ? null : gl.getUniform(program, axis);
            })(),
            receiveShadowUniform: (() => {
              const shadow = gl.getUniformLocation(program, "receiveShadow");
              return shadow === null ? null : gl.getUniform(program, shadow);
            })(),
            opticalLodScale: (() => {
              const lod = gl.getUniformLocation(program, "catFurOpticalLodScale");
              return lod === null ? null : gl.getUniform(program, lod);
            })(),
            widthLodScale: (() => {
              const lod = gl.getUniformLocation(program, "catFurLodScale");
              return lod === null ? null : gl.getUniform(program, lod);
            })(),
          });
        }
      }
      originalAfter.apply(this, args);
    };
  });
  window.__nativeCoatCapture = async () => {
    const live = locate();
    if (live.model !== model)
      throw Error("Model replaced during native-coat observation");
    const deadline = performance.now() + 15000;
    while (!model.scene.__r3f?.root) {
      if (performance.now() > deadline) throw Error("Ready model never attached to the actual R3F renderer");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const state = model.scene.__r3f.root.getState();
    window.__nativeCoatDraws = [];
    window.__nativeCoatAnalyticDraws = [];
    state.invalidate();
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
    );
    const gl = state.gl.getContext();
    const textureHashes = {},
      hashedTextures = new Map();
    for (const mesh of model.meshes)
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
        if (!material.userData.catNativeCoat) continue;
        for (const slot of [
          "map",
          "normalMap",
          "roughnessMap",
          "metalnessMap",
        ]) {
          const texture = material[slot];
          if (!texture?.image) continue;
          if (!hashedTextures.has(texture)) {
            const image = texture.image;
            let bytes;
            if (ArrayBuffer.isView(image.data))
              bytes = new Uint8Array(
                image.data.buffer,
                image.data.byteOffset,
                image.data.byteLength,
              );
            else {
              const canvas = document.createElement("canvas");
              canvas.width = image.width;
              canvas.height = image.height;
              const context = canvas.getContext("2d");
              context.drawImage(image, 0, 0);
              bytes = context.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              ).data;
            }
            const hash = Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
            )
              .map((n) => n.toString(16).padStart(2, "0"))
              .join("");
            hashedTextures.set(texture, hash);
          }
          textureHashes[`${mesh.name}/${material.name}/${slot}`] =
            hashedTextures.get(texture);
        }
      }
    return {
      design: locate().design,
      mode: document.querySelector("[data-creator-coat-mode]")?.dataset
        .creatorCoatMode,
      rendererMode: live.canvas.dataset.furRenderer,
      rendererGeometry: live.canvas.dataset.furGeometry,
      stats: model.fur?.stats() ?? null,
      preparedGroom: model.fur?.preparedGroom ?? null,
      textureContentHashes: textureHashes,
      resources: (model.fur?.meshes ?? []).map((mesh) => ({
        name: mesh.name,
        region: mesh.userData.furRegion ?? null,
        undercoat: !!mesh.userData.undercoat,
        volumeRegion: mesh.userData.furVolumeRegion ?? null,
        visible: mesh.visible,
        drawRange: { ...mesh.geometry.drawRange },
        intended: mesh.userData.strandCount ?? null,
        preview: mesh.userData.previewStrands ?? null,
        furTangent: (() => {
          const a = mesh.geometry.getAttribute("furTangent");
          if (!a) return null;
          const active = Math.min(a.count, (mesh.userData.previewStrands ?? mesh.userData.strandCount ?? 0) * (mesh.userData.strandVertices ?? 0));
          const lengths = [];
          for (let i = 0; i < Math.min(64, active); i++) {
            const index = Math.floor(i * (active - 1) / Math.max(1, Math.min(64, active) - 1));
            lengths.push(Math.hypot(a.getX(index), a.getY(index), a.getZ(index)));
          }
          return { type: a.array.constructor.name, normalized: a.normalized, itemSize: a.itemSize, count: a.count, activeVertices: active, samples: lengths.length, sampledUnitMin: lengths.length ? Math.min(...lengths) : null, sampledUnitMax: lengths.length ? Math.max(...lengths) : null, sampledNonfinite: lengths.filter(x => !Number.isFinite(x)).length };
        })(),
      })),
      analyticTangentDraws: [...new Map(window.__nativeCoatAnalyticDraws.map(draw => [draw.uuid + draw.pass, draw])).values()],
      draws: [
        ...new Map(
          window.__nativeCoatDraws.map((draw) => [draw.uuid + draw.pass, draw]),
        ).values(),
      ],
      materials: model.meshes.flatMap((mesh) =>
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(
          (material) => ({
            mesh: mesh.name,
            material: material.name,
            map: material.map?.uuid ?? null,
            normalMap: material.normalMap?.uuid ?? null,
            normalScale: material.normalScale?.toArray() ?? null,
            roughness: material.roughness,
            metalness: material.metalness,
            clearcoat: material.clearcoat ?? null,
            role: material.userData.creatorRole ?? null,
            nativeCoat: material.userData.catNativeCoat ?? null,
          }),
        ),
      ),
      camera: {
        position: state.camera.position.toArray(),
        projection: state.camera.projectionMatrix.toArray(),
        target: state.controls?.target.toArray() ?? null,
      },
      modelWorld: model.scene.matrixWorld.toArray(),
      canvas: {
        width: live.canvas.width,
        height: live.canvas.height,
        rect: live.canvas.getBoundingClientRect().toJSON(),
      },
      context: {
        alpha: gl.getContextAttributes().alpha,
        samples: gl.getParameter(gl.SAMPLES),
        error: gl.getError(),
        toneMapping: state.gl.toneMapping,
        exposure: state.gl.toneMappingExposure,
        programs: state.gl.info.programs.map((p) => ({
          runnable: p.diagnostics?.runnable ?? true,
          log: p.diagnostics?.programLog ?? "",
        })),
      },
    };
  };
}
