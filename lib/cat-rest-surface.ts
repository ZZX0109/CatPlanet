import * as THREE from "three";

type RestPoint = { point: THREE.Vector3; weight: number };
type Polynomial = { a: number; b: number; c: number };

/**
 * Construct a canonical full-rest surface for all four limbs.
 *
 * Input neutral coordinates choose the continuous anatomical collar; morphed
 * coordinates and the deformed rest joints define the edited cat's geometry.
 * Returned points are in the same world-like local space as a dropped body.
 * The caller can inverse-skin this target to create a pose-space corrective.
 */
export function createRestSurface(rest: THREE.Vector3[], drop: number) {
  const clamp = THREE.MathUtils.clamp;
  const smooth = THREE.MathUtils.smoothstep;
  const identity = new THREE.Quaternion();
  const xAxis = new THREE.Vector3(1, 0, 0);
  function polynomial(
    hip: number,
    knee: number,
    paw: number,
    middle: number,
  ): Polynomial {
    const difference = paw - hip;
    const a = (knee - hip - difference * middle) / (middle * middle - middle);
    return { a, b: difference - a, c: hip };
  }
  const limbs = Array.from({ length: 4 }, (_, limb) => {
    const top = 5 + limb * 3,
      front = limb % 2 === 0;
    const hip = rest[top].clone(),
      knee = rest[top + 1].clone(),
      paw = rest[top + 2].clone();
    const height = Math.max(0.1, hip.y - paw.y);
    const middle = clamp((hip.y - knee.y) / height, 0.1, 0.9);
    const sourceX = polynomial(hip.x, knee.x, paw.x, middle);
    const sourceZ = polynomial(hip.z, knee.z, paw.z, middle);
    const start = hip.clone();
    start.y -= drop;
    const end = paw.clone();
    // The padded forepaws lie ahead of the chest, while the rear pads stay
    // beneath the haunch. Paw height stays tied to the edited rest shape.
    end.z += front ? 0.11 : -0.04;
    // A relaxed loaf draws both pairs of pads inward under the chest/haunch.
    // The paws remain whole rigid endpoints; only their placement changes.
    end.x *= 0.78;
    const control1 = start.clone();
    control1.x = THREE.MathUtils.lerp(start.x, end.x, 0.35);
    control1.y = THREE.MathUtils.lerp(start.y, end.y, front ? 0.81 : 0.65);
    // Forearm leaves the chest down-and-back, then folds forward onto its pad.
    // The rear curve stays broad rather than doubling back through a tiny hock.
    control1.z += front ? -0.09 : 0.01;
    const control2 = end.clone();
    control2.x += Math.sign(end.x) * 0.004;
    control2.y += front ? 0.02 : 0.09;
    control2.z -= front ? 0.2 : 0.04;
    const curve = new THREE.CubicBezierCurve3(start, control1, control2, end);
    return { front, hip, paw, height, sourceX, sourceZ, end, curve };
  });
  const center = new THREE.Vector3(),
    tangent = new THREE.Vector3();
  const offset = new THREE.Vector3(),
    rotation = new THREE.Quaternion();
  const pawTarget = new THREE.Vector3();
  return (neutral: THREE.Vector3, morphed: THREE.Vector3): RestPoint => {
    const front = neutral.z >= 0;
    const limb = limbs[(neutral.x < 0 ? 0 : 2) + (front ? 0 : 1)];
    const rootCollar = 1 - smooth(neutral.y, 0.64, front ? 0.93 : 0.98);
    const sideMask = smooth(Math.abs(neutral.x), 0.03, 0.1);
    const lengthMask = front
      ? smooth(neutral.z, 0.25, 0.41)
      : smooth(-neutral.z, 0.35, 0.52);
    const weight = rootCollar * sideMask * lengthMask;
    const point = morphed.clone();
    point.y -= drop;
    if (weight < 0.00001) {
      point.y = Math.max(0.005, point.y);
      return { point, weight: 0 };
    }

    const s = clamp((limb.hip.y - morphed.y) / limb.height, 0, 1);
    const sourceX = (limb.sourceX.a * s + limb.sourceX.b) * s + limb.sourceX.c;
    const sourceY = limb.hip.y - s * limb.height;
    const sourceZ = (limb.sourceZ.a * s + limb.sourceZ.b) * s + limb.sourceZ.c;
    const sourceTangentZ = 2 * limb.sourceZ.a * s + limb.sourceZ.b;
    const sourceAngle = Math.atan2(-sourceTangentZ, limb.height);
    limb.curve.getPoint(s, center);
    limb.curve.getTangent(s, tangent);
    const targetAngle = Math.atan2(-tangent.z, -tangent.y);
    let angle = targetAngle - sourceAngle;
    angle = Math.atan2(Math.sin(angle), Math.cos(angle));
    rotation.setFromAxisAngle(xAxis, angle);
    // Start with the dropped neutral frame at the root. A single transported
    // frame avoids the cancellation/renormalisation seam between two segments.
    rotation.slerp(identity, 1 - smooth(s, 0, 0.14));
    offset
      .set(morphed.x - sourceX, morphed.y - sourceY, morphed.z - sourceZ)
      .applyQuaternion(rotation);
    point.copy(center).add(offset);

    // Preserve the complete pad/toe ellipsoid as a rigid translated endpoint.
    // Blend positions, never opposing radial vectors followed by setLength().
    pawTarget.copy(morphed).sub(limb.paw).add(limb.end);
    const pawBlend =
      1 - smooth(morphed.y, limb.paw.y + 0.03, limb.paw.y + 0.15);
    point.lerp(pawTarget, pawBlend);

    // A smooth floor constraint leaves the pad flat without a discontinuous cut.
    const floorDelta = point.y - 0.005;
    point.y =
      0.005 +
      0.5 * (floorDelta + Math.sqrt(floorDelta * floorDelta + 0.000001));
    return { point, weight };
  };
}
