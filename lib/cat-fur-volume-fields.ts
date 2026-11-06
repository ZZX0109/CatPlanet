/** Reference-skin envelope from the existing down groom, not a learned fur map. */
type Root = {
  a: number;
  b: number;
  c: number;
  u: number;
  v: number;
  w: number;
  hairKind: string;
  kind: number;
  trunkWeight: number;
  longLength: number;
  flowLength: number;
  variation: number;
  layer: number;
  hairLift: number;
  backLay: number;
  downDepth: number;
  appendageLay: number;
};
type RegionName = "body" | "ruff";
type Region = { name: RegionName; roots: readonly Root[]; curve: Float32Array };
type Sample = { value: readonly number[]; t2: number };
type Observation = { height: number; sweep: number; weight: number };

export function buildCatFurVolumeFields(input: {
  vertexCount: number;
  normals: Float32Array;
  regions: readonly Region[];
  samples: readonly Sample[];
  masks: Record<RegionName, Float32Array>;
  neighbours: readonly number[][];
  seamGroups: readonly number[][];
  tangentGain: number;
  gravity: number;
  flyawayShare: number;
}) {
  const envelope = {
    body: new Float32Array(input.vertexCount),
    ruff: new Float32Array(input.vertexCount),
  };
  const sweep = {
    body: new Float32Array(input.vertexCount),
    ruff: new Float32Array(input.vertexCount),
  };
  const counts = { body: 0, ruff: 0 };
  for (const region of input.regions) {
    const observations: Observation[][] = Array.from(
      { length: input.vertexCount },
      () => [],
    );
    for (let i = 0; i < region.roots.length; i++) {
      const r = region.roots[i];
      if (r.hairKind !== "down" || r.kind !== 0 || r.trunkWeight < 0.001)
        continue;
      let ny =
        input.normals[r.a * 3 + 1] * r.u +
        input.normals[r.b * 3 + 1] * r.v +
        input.normals[r.c * 3 + 1] * r.w;
      const nx =
        input.normals[r.a * 3] * r.u +
        input.normals[r.b * 3] * r.v +
        input.normals[r.c * 3] * r.w;
      const nz =
        input.normals[r.a * 3 + 2] * r.u +
        input.normals[r.b * 3 + 2] * r.v +
        input.normals[r.c * 3 + 2] * r.w;
      ny /= Math.hypot(nx, ny, nz) || 1;
      const scale =
        r.longLength *
        r.flowLength *
        (region.name === "ruff" ? 0.7 : 1) *
        (0.84 + r.variation * 0.17) *
        (r.layer > 1 - input.flyawayShare ? 1.12 : 1);
      const gain =
        r.hairLift *
        (region.name === "body"
          ? (1 - 0.2 * r.backLay) *
            (1 - r.trunkWeight * (1 - (0.4 + 0.6 * r.downDepth ** 2))) *
            r.appendageLay
          : 1);
      let crest = 0,
        crestSweep = 0;
      for (const sample of input.samples) {
        let n = 0,
          t = 0;
        for (let k = 0; k < 4; k++) {
          n += region.curve[i * 12 + k * 3] * sample.value[k + 1];
          t += region.curve[i * 12 + k * 3 + 1] * sample.value[k + 1];
        }
        const height =
          scale * (n * gain + Math.max(0, -ny) * input.gravity * sample.t2);
        if (height > crest) {
          crest = height;
          crestSweep = scale * Math.max(0, t * input.tangentGain);
        }
      }
      if (!(crest > 0) || !Number.isFinite(crest + crestSweep)) continue;
      counts[region.name]++;
      for (const [vertex, weight] of [
        [r.a, r.u],
        [r.b, r.v],
        [r.c, r.w],
      ])
        if (input.masks[region.name][vertex] > 0.001 && weight > 0.001)
          observations[vertex].push({
            height: crest,
            sweep: crestSweep,
            weight,
          });
    }
    const h = envelope[region.name],
      s = sweep[region.name],
      mask = input.masks[region.name];
    for (let v = 0; v < observations.length; v++) {
      const list = observations[v];
      if (!list.length) continue;
      list.sort((a, b) => a.height - b.height);
      const target = list.reduce((sum, sample) => sum + sample.weight, 0) * 0.8;
      let weight = 0;
      for (const sample of list) {
        weight += sample.weight;
        if (weight >= target) {
          h[v] = sample.height;
          s[v] = sample.sweep;
          break;
        }
      }
    }
    // Fill only within the same anatomical surface, then smooth local estimates.
    // This is an envelope statistic; the procedural microdensity is separate.
    for (let pass = 0; pass < 10; pass++) {
      const nextH = h.slice(),
        nextS = s.slice();
      let missing = 0;
      for (let v = 0; v < h.length; v++) {
        if (mask[v] < 0.001 || (pass < 8 && h[v] > 0)) continue;
        let sumH = 0,
          sumS = 0,
          total = 0;
        for (const neighbour of input.neighbours[v]) {
          if (mask[neighbour] < 0.001 || h[neighbour] <= 0) continue;
          const alignment =
            input.normals[v * 3] * input.normals[neighbour * 3] +
            input.normals[v * 3 + 1] * input.normals[neighbour * 3 + 1] +
            input.normals[v * 3 + 2] * input.normals[neighbour * 3 + 2];
          const w = Math.max(0, alignment) * mask[neighbour];
          sumH += h[neighbour] * w;
          sumS += s[neighbour] * w;
          total += w;
        }
        if (total > 0) {
          nextH[v] =
            h[v] > 0 ? 0.6 * h[v] + (0.4 * sumH) / total : sumH / total;
          nextS[v] =
            h[v] > 0 ? 0.6 * s[v] + (0.4 * sumS) / total : sumS / total;
        } else if (h[v] <= 0) missing++;
      }
      for (const group of input.seamGroups) {
        let sumH = 0,
          sumS = 0,
          total = 0;
        for (const v of group)
          if (mask[v] > 0.001 && nextH[v] > 0) {
            sumH += nextH[v];
            sumS += nextS[v];
            total++;
          }
        if (total)
          for (const v of group)
            if (mask[v] > 0.001) {
              nextH[v] = sumH / total;
              nextS[v] = sumS / total;
            }
      }
      h.set(nextH);
      s.set(nextS);
      if (!missing && pass < 7) pass = 7;
    }
  }
  return { envelope, sweep, counts };
}
