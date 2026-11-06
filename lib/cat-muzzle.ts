import * as T from "three";

/** Sculpted nose leather and recessed nostrils, in local muzzle coordinates. */
export function createCatNose() {
  const group = new T.Group();
  group.name = "NoseLeather";
  const outline = new T.CatmullRomCurve3(
    [
      new T.Vector3(-0.03, 0.006, 0),
      new T.Vector3(-0.025, 0.014, 0),
      new T.Vector3(0, 0.016, 0),
      new T.Vector3(0.025, 0.014, 0),
      new T.Vector3(0.03, 0.006, 0),
      new T.Vector3(0.016, -0.007, 0),
      new T.Vector3(0, -0.02, 0),
      new T.Vector3(-0.016, -0.007, 0),
    ],
    true,
    "centripetal",
  );
  const positions: number[] = [],
    indices: number[] = [];
  const steps = 64,
    rings = 10;
  for (let ring = 0; ring <= rings; ring++)
    for (let j = 0; j <= steps; j++) {
      const t = ring / rings,
        edge = outline.getPoint(j / steps);
      positions.push(
        edge.x * t,
        -0.002 + (edge.y + 0.002) * t,
        0.005 + 0.012 * (1 - t * t) + Math.sin(j * 19 + ring * 31) * 0.00018,
      );
      if (ring < rings && j < steps) {
        const a = ring * (steps + 1) + j,
          b = a + steps + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  group.add(
    new T.Mesh(
      geometry,
      new T.MeshPhysicalMaterial({
        color: "#b17d74",
        roughness: 0.55,
        clearcoat: 0.15,
        clearcoatRoughness: 0.6,
        side: T.DoubleSide,
      }),
    ),
  );
  for (const side of [-1, 1]) {
    const nostril = new T.Mesh(
      new T.SphereGeometry(1, 20, 12),
      new T.MeshStandardMaterial({ color: "#634b43", roughness: 0.8 }),
    );
    nostril.scale.set(0.0065, 0.0025, 0.002);
    nostril.position.set(side * 0.024, 0.001, 0.01);
    nostril.rotation.z = side * 0.3;
    nostril.name = `Nostril${side}`;
    group.add(nostril);
  }
  return group;
}

export function taperedWhisker(curve: T.Curve<T.Vector3>, radius: number) {
  const vertices: number[] = [],
    indices: number[] = [],
    steps = 28,
    sides = 5;
  const frames = curve.computeFrenetFrames(steps, false);
  for (let i = 0; i <= steps; i++) {
    const point = curve.getPoint(i / steps),
      r = radius * Math.max(0.025, (1 - i / steps) ** 0.7);
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides) * Math.PI * 2;
      vertices.push(
        ...point
          .clone()
          .addScaledVector(frames.normals[i], Math.cos(angle) * r)
          .addScaledVector(frames.binormals[i], Math.sin(angle) * r)
          .toArray(),
      );
    }
    if (i < steps)
      for (let j = 0; j < sides; j++) {
        const a = i * (sides + 1) + j,
          b = a + sides + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
