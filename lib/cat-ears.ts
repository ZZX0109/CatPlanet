import * as THREE from "three";
import { createCoatNormal } from "./cat-coat-normal";

/** Thin, hollow feline pinna. Origin is at the ear base; front is +Z. */
export function createCatEar(side: number, coat: string): THREE.Group {
  const group = new THREE.Group();
  group.name = side < 0 ? "PinnaL" : "PinnaR";
  const outer = new THREE.Color(coat);
  const pink = new THREE.Color("#bf9890");
  const darkPink = new THREE.Color("#a67f73");
  const n = 36,
    m = 24;
  const positions: number[] = [],
    colors: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const noise = (value: number) => {
    const f = Math.sin(value * 127.1 + 313.4) * 43758.5453;
    return f - Math.floor(f);
  };
  const width = (t: number) =>
    0.096 *
    Math.pow(Math.max(0, 1 - t), 0.66) *
    (1 + 0.1 * Math.sin(t * Math.PI));
  function surface(t: number, v: number, back = false) {
    const arch = Math.sin(t * Math.PI);
    const x = v * width(t) + side * 0.009 * t * t;
    const y = 0.23 * t - 0.005 * v * v * Math.sin(t * Math.PI);
    // The front has a recessed concha, while the perimeter rolls toward the viewer.
    const bowl = -0.043 * arch * (1 - v * v);
    const fold = 0.0035 * Math.exp(-(((Math.abs(v) - 0.7) / 0.1) ** 2)) * arch;
    const rim = 0.01 * v * v * arch;
    const tipBend = -0.029 * t * t;
    const thickness = 0.012 * (1 - 0.8 * t);
    return new THREE.Vector3(
      x,
      y,
      bowl + rim + fold + tipBend - (back ? thickness : 0),
    );
  }
  const layerSize = (n + 1) * (m + 1);
  for (const back of [false, true]) {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      for (let j = 0; j <= m; j++) {
        const v = (j / m) * 2 - 1;
        positions.push(...surface(t, v, back).toArray());
        uvs.push((v + 1) / 2, t);
        const color = outer.clone();
        if (!back) {
          const inside =
            (1 - THREE.MathUtils.smoothstep(Math.abs(v), 0.54, 0.95)) *
            THREE.MathUtils.smoothstep(t, 0.025, 0.16) *
            (1 - THREE.MathUtils.smoothstep(t, 0.83, 0.99));
          const inner = pink
            .clone()
            .lerp(darkPink, Math.sin(t * Math.PI) * 0.22);
          color.lerp(inner, inside * 0.82);
        }
        color.multiplyScalar(0.98 + Math.sin(t * 8 + v * 3) * 0.015);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  for (let layer = 0; layer < 2; layer++) {
    const offset = layer * layerSize;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++) {
        const a = offset + i * (m + 1) + j,
          b = a + m + 1;
        if (layer === 0) indices.push(a, a + 1, b, a + 1, b + 1, b);
        else indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }
  // Join the two skins around the perimeter instead of leaving an open cut-out.
  const perimeter: number[] = [];
  for (let j = 0; j <= m; j++) perimeter.push(j);
  for (let i = 1; i <= n; i++) perimeter.push(i * (m + 1) + m);
  for (let j = m - 1; j >= 0; j--) perimeter.push(n * (m + 1) + j);
  for (let i = n - 1; i > 0; i--) perimeter.push(i * (m + 1));
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i],
      b = perimeter[(i + 1) % perimeter.length];
    indices.push(a, a + layerSize, b, b, a + layerSize, b + layerSize);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.91,
    sheen: 0.34,
    sheenRoughness: 0.95,
    sheenColor: "#d5c5b2",
    normalMap: createCoatNormal(),
    normalScale: new THREE.Vector2(0.12, 0.12),
    side: THREE.DoubleSide,
  });
  const pinna = new THREE.Mesh(geometry, material);
  pinna.name = "Curved pinna";
  pinna.castShadow = true;
  group.add(pinna);

  // A few tapered inner guard hairs soften the edge without making a cotton insert.
  const hairs: number[] = [],
    hairColors: number[] = [];
  const hairColor = outer.clone().lerp(new THREE.Color("#d8cbb9"), 0.65);
  for (const edge of [-1, 1]) {
    for (let i = 0; i < 105; i++) {
      const seed = i + (edge + 1) * 17;
      const guard = i < 15;
      const t = 0.1 + noise(seed + 19) * (guard ? 0.48 : 0.83);
      const start = surface(
        t,
        edge * (guard ? 0.58 + noise(seed) * 0.18 : 0.94),
      );
      start.z += 0.002;
      const length = guard
        ? 0.026 + noise(seed + 29) * 0.028
        : 0.004 + noise(seed + 29) * 0.006;
      const curve = new THREE.QuadraticBezierCurve3(
        start,
        start
          .clone()
          .add(new THREE.Vector3(-edge * length * 0.22, length * 0.68, 0.003)),
        start
          .clone()
          .add(new THREE.Vector3(-edge * length * 0.42, length, 0.005)),
      );
      for (let segment = 0; segment < 4; segment++) {
        const a = curve.getPoint(segment / 4),
          b = curve.getPoint((segment + 1) / 4);
        const wa = 0.00055 * (1 - segment / 4),
          wb = 0.00055 * (1 - (segment + 1) / 4);
        const a0 = a.clone().add(new THREE.Vector3(wa, 0, 0)),
          a1 = a.clone().add(new THREE.Vector3(-wa, 0, 0));
        const b0 = b.clone().add(new THREE.Vector3(wb, 0, 0)),
          b1 = b.clone().add(new THREE.Vector3(-wb, 0, 0));
        hairs.push(
          ...a0.toArray(),
          ...a1.toArray(),
          ...b0.toArray(),
          ...a1.toArray(),
          ...b1.toArray(),
          ...b0.toArray(),
        );
        for (let vertex = 0; vertex < 6; vertex++)
          hairColors.push(hairColor.r, hairColor.g, hairColor.b);
      }
    }
  }
  const hairGeometry = new THREE.BufferGeometry();
  hairGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(hairs, 3),
  );
  hairGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(hairColors, 3),
  );
  hairGeometry.computeVertexNormals();
  // Match the ear skin response instead of lighting every narrow ribbon as a
  // separate bright reflector. The pinna faces +Z in its local frame.
  const hairNormals = hairGeometry.getAttribute("normal");
  for (let i = 0; i < hairNormals.count; i++) hairNormals.setXYZ(i, 0, 0, 1);
  const tufts = new THREE.Mesh(
    hairGeometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      side: THREE.DoubleSide,
    }),
  );
  tufts.name = "Inner pinna guard hairs";
  group.add(tufts);
  return group;
}
