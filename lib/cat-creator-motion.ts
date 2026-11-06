import * as THREE from "three";

export type CreatorPose = "stand" | "rest";
export type CreatorMotionFrame = {
  changed: boolean;
  blink: number;
  transitioning: boolean;
  pose: CreatorPose;
};
export type CreatorMotion = {
  setPose(pose: CreatorPose, immediate?: boolean): void;
  setBreathing(enabled: boolean): void;
  setIdleBlink(enabled: boolean): void;
  update(
    elapsedSeconds: number,
    options?: { reducedMotion?: boolean },
  ): CreatorMotionFrame;
  reset(): void;
  dispose(): void;
};

type Transform = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
};
const UP = new THREE.Vector3(0, 1, 0);
const point = (bone: THREE.Object3D) =>
  bone.getWorldPosition(new THREE.Vector3());

/** Absolute transforms avoid accumulating animation drift over long visits. */
export function createCreatorMotion(
  scene: THREE.Group,
  baseId: "norwegian" | "sphynx",
): CreatorMotion {
  const bones = new Map<string, THREE.Bone>();
  const meshes: THREE.SkinnedMesh[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (node instanceof THREE.Bone) bones.set(node.name, node);
    if (node instanceof THREE.SkinnedMesh) meshes.push(node);
  });
  const standing = new Map<THREE.Bone, Transform>();
  const standingWorld = new Map<
    THREE.Bone,
    { position: THREE.Vector3; quaternion: THREE.Quaternion }
  >();
  for (const bone of bones.values()) {
    standingWorld.set(bone, {
      position: point(bone),
      quaternion: bone.getWorldQuaternion(new THREE.Quaternion()),
    });
    standing.set(bone, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    });
  }
  const pelvis = bones.get(
    baseId === "norwegian" ? "PantherPelvis" : "PelvisSkinJnt",
  );
  if (!pelvis) throw new Error("猫咪缺少身体姿态骨架。");

  function restore() {
    for (const [bone, transform] of standing) {
      bone.position.copy(transform.position);
      bone.quaternion.copy(transform.quaternion);
      bone.scale.copy(transform.scale);
    }
    scene.updateMatrixWorld(true);
  }
  function positionWorld(bone: THREE.Bone, value: THREE.Vector3) {
    bone.position.copy(bone.parent!.worldToLocal(value.clone()));
    bone.updateMatrixWorld(true);
  }
  function rotationWorld(bone: THREE.Bone, value: THREE.Quaternion) {
    bone.quaternion.copy(
      bone
        .parent!.getWorldQuaternion(new THREE.Quaternion())
        .invert()
        .multiply(value),
    );
    bone.updateMatrixWorld(true);
  }
  function aimChild(
    bone: THREE.Bone,
    child: THREE.Bone,
    desired: THREE.Vector3,
  ) {
    const origin = point(bone);
    const actual = point(child).sub(origin).normalize();
    const target = desired.clone().sub(origin).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(actual, target);
    rotationWorld(
      bone,
      delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion())),
    );
  }
  function solveChain(
    start: THREE.Bone,
    middle: THREE.Bone,
    end: THREE.Bone,
    target: THREE.Vector3,
    pole: THREE.Vector3,
  ) {
    const origin = point(start),
      mid = point(middle),
      terminal = point(end);
    const firstLength = origin.distanceTo(mid),
      secondLength = mid.distanceTo(terminal);
    const direction = target.clone().sub(origin);
    const distance = THREE.MathUtils.clamp(
      direction.length(),
      Math.abs(firstLength - secondLength) + 0.002,
      firstLength + secondLength - 0.002,
    );
    direction.normalize();
    const parallel =
      (firstLength * firstLength -
        secondLength * secondLength +
        distance * distance) /
      (2 * distance);
    const height = Math.sqrt(
      Math.max(0, firstLength * firstLength - parallel * parallel),
    );
    const lateral = pole
      .clone()
      .sub(origin)
      .addScaledVector(direction, -pole.clone().sub(origin).dot(direction))
      .normalize();
    const desiredMid = origin
      .clone()
      .addScaledVector(direction, parallel)
      .addScaledVector(lateral, height);
    aimChild(start, middle, desiredMid);
    aimChild(middle, end, origin.clone().addScaledVector(direction, distance));
  }

  type Leg = {
    start: THREE.Bone;
    middle: THREE.Bone;
    end: THREE.Bone;
    toe?: THREE.Bone;
    target: THREE.Vector3;
    pole: THREE.Vector3;
    endRotation: THREE.Quaternion;
    toeRotation?: THREE.Quaternion;
    toeFloorY?: number;
  };
  const legs: Leg[] = [];
  function leg(
    startName: string,
    middleName: string,
    endName: string,
    toeName: string | undefined,
    front: boolean,
  ) {
    const start = bones.get(startName),
      middle = bones.get(middleName),
      end = bones.get(endName);
    if (!start || !middle || !end) return;
    const toe = toeName ? bones.get(toeName) : undefined;
    const target = point(end);
    // In a resting cat the metacarpal/hock segment lies along the floor rather
    // than retaining the standing ankle's upright orientation.
    const toeFloorY = toe ? point(toe).y : undefined;
    if (toeFloorY !== undefined) target.y = toeFloorY + (front ? 0.02 : 0.065);
    target.z += front ? (baseId === "norwegian" ? 0.62 : 1.18) : 0.3;
    target.x =
      Math.sign(target.x) *
      (front ? (baseId === "norwegian" ? 0.33 : 0.29) : 0.46);
    const pole = point(start).add(
      new THREE.Vector3(
        front ? 0 : Math.sign(target.x) * (baseId === "sphynx" ? 0.55 : 0.38),
        front || baseId === "norwegian" ? -0.6 : -0.1,
        front ? -1.2 : 0.9,
      ),
    );
    legs.push({
      start,
      middle,
      end,
      toe,
      target,
      pole,
      endRotation: end.getWorldQuaternion(new THREE.Quaternion()),
      toeRotation: toe?.getWorldQuaternion(new THREE.Quaternion()),
      toeFloorY,
    });
  }
  if (baseId === "norwegian") {
    for (const side of ["L", "R"]) {
      leg(
        `Panther${side}Leg1_(1)`,
        `Panther${side}Leg2_(1)`,
        `Panther${side}LegPalm_(1)`,
        `Panther${side}LegDigit01_(1)`,
        true,
      );
      leg(
        `Panther${side}Leg1`,
        `Panther${side}Leg2`,
        `Panther${side}LegPalm`,
        `Panther${side}LegDigit01`,
        false,
      );
    }
  } else {
    for (const side of ["Left", "Right"]) {
      leg(
        `${side}FrontHipSkinJnt`,
        `${side}FrontKneeSkinJnt`,
        `${side}FrontAnkleSkinJnt`,
        `${side}FrontToeSkinJnt`,
        true,
      );
      leg(
        `${side}BackHipSkinJnt`,
        `${side}BackKneeSkinJnt`,
        `${side}BackAnkleSkinJnt`,
        `${side}BackToeSkinJnt`,
        false,
      );
    }
  }
  const head = bones.get(baseId === "norwegian" ? "head" : "HeadSkinJnt");
  const headRotation = head?.getWorldQuaternion(new THREE.Quaternion());
  const neck = bones.get(baseId === "norwegian" ? "neck_01" : "Neck1SkinJnt");

  restore();
  positionWorld(
    pelvis,
    point(pelvis).addScaledVector(UP, baseId === "norwegian" ? -0.69 : -1.22),
  );
  if (neck)
    positionWorld(
      neck,
      point(neck).addScaledVector(UP, baseId === "norwegian" ? -0.24 : -0.03),
    );
  for (const item of legs) {
    solveChain(item.start, item.middle, item.end, item.target, item.pole);
    if (item.toe) {
      const floorDirection = item.target
        .clone()
        .add(
          new THREE.Vector3(0, 0, point(item.end).distanceTo(point(item.toe))),
        );
      if (item.toeFloorY !== undefined) floorDirection.y = item.toeFloorY;
      aimChild(item.end, item.toe, floorDirection);
    } else rotationWorld(item.end, item.endRotation);
    if (item.toe && item.toeRotation) rotationWorld(item.toe, item.toeRotation);
  }
  if (head && headRotation) rotationWorld(head, headRotation);
  const tail = [...bones.values()].filter((bone) =>
    baseId === "norwegian"
      ? /^PantherTail[1-5]$/.test(bone.name)
      : /^Tail[1-8]SkinJnt$/.test(bone.name),
  );
  tail.sort(
    (a, b) =>
      Number(a.name.match(/\d+/)?.[0]) - Number(b.name.match(/\d+/)?.[0]),
  );
  for (let i = 0; i < tail.length - 1; i++) {
    const bone = tail[i],
      child = tail[i + 1],
      origin = point(bone),
      length = origin.distanceTo(point(child));
    const direction = new THREE.Vector3(
      -0.15 - (0.2 * i) / tail.length,
      origin.y > 0.3 ? -0.6 : 0,
      -0.95,
    ).normalize();
    const destination = origin.clone().addScaledVector(direction, length);
    destination.y = Math.max(0.15, destination.y);
    aimChild(bone, child, destination);
  }
  if (tail.length > 1) {
    const tip = tail[tail.length - 1],
      before = tail[tail.length - 2];
    const original = standingWorld.get(tip)!,
      previous = standingWorld.get(before)!;
    const localAxis = original.position
      .clone()
      .sub(previous.position)
      .normalize()
      .applyQuaternion(original.quaternion.clone().invert());
    const rotation = tip.getWorldQuaternion(new THREE.Quaternion());
    const actualAxis = localAxis.applyQuaternion(rotation);
    const delta = new THREE.Quaternion().setFromUnitVectors(
      actualAxis,
      new THREE.Vector3(-0.3, 0, -0.95).normalize(),
    );
    rotationWorld(tip, delta.multiply(rotation));
    // The last Sphynx skin segment extends beyond its terminal joint. A small
    // lift keeps that actual weighted tip above the floor without moving paws.
    if (baseId === "sphynx")
      positionWorld(tip, point(tip).addScaledVector(UP, 0.025));
  }
  scene.updateMatrixWorld(true);
  const resting = new Map<THREE.Bone, Transform>();
  const restingWorld = new Map<
    THREE.Bone,
    { position: THREE.Vector3; quaternion: THREE.Quaternion }
  >();
  for (const bone of bones.values()) {
    restingWorld.set(bone, {
      position: point(bone),
      quaternion: bone.getWorldQuaternion(new THREE.Quaternion()),
    });
    resting.set(bone, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    });
  }
  restore();

  const breathingBones = [...bones.values()].filter((bone) =>
    baseId === "norwegian"
      ? /^PantherSpine[345]$/.test(bone.name)
      : /^Belly[123]SkinJnt$/.test(bone.name),
  );
  let requested: CreatorPose = "stand",
    amount = 0,
    breathing = false,
    idleBlink = false,
    lastTime: number | undefined,
    lastSignature = "";
  let immediate = false,
    disposed = false;
  const result: CreatorMotion = {
    setPose(pose, instant = false) {
      requested = pose;
      immediate = instant;
    },
    setBreathing(enabled) {
      breathing = enabled;
    },
    setIdleBlink(enabled) {
      idleBlink = enabled;
    },
    update(time, options = {}) {
      if (disposed)
        return {
          changed: false,
          blink: 0,
          transitioning: false,
          pose: requested,
        };
      const dt =
        lastTime === undefined
          ? 0
          : THREE.MathUtils.clamp(time - lastTime, 0, 0.1);
      lastTime = time;
      const target = requested === "rest" ? 1 : 0;
      if (immediate || options.reducedMotion) amount = target;
      else amount = THREE.MathUtils.damp(amount, target, 5.5, dt);
      if (Math.abs(amount - target) < 0.0005) amount = target;
      immediate = false;
      const blend = amount * amount * (3 - 2 * amount);
      const wave =
        breathing && !options.reducedMotion
          ? Math.sin(time * Math.PI * 0.54) * 0.0035
          : 0;
      const signature = `${blend.toFixed(6)}:${wave.toFixed(6)}`;
      const changed = signature !== lastSignature;
      if (changed) {
        for (const [bone, start] of standing) {
          const end = resting.get(bone)!;
          bone.position.copy(start.position).lerp(end.position, blend);
          bone.quaternion.copy(start.quaternion).slerp(end.quaternion, blend);
          bone.scale.copy(start.scale).lerp(end.scale, blend);
        }
        for (const bone of breathingBones)
          bone.scale.multiply(new THREE.Vector3(1 + wave, 1, 1 + wave));
        scene.updateMatrixWorld(true);
        if ((blend > 0 && blend < 1) || Math.abs(wave) > 1e-8) {
          // Plant the actual toe trajectory while the body settles. Merely
          // blending local rotations would swing paws through the floor.
          for (const item of legs) {
            if (!item.toe) continue;
            const toeStart = standingWorld.get(item.toe)!,
              toeEnd = restingWorld.get(item.toe)!;
            const toeTarget = toeStart.position
              .clone()
              .lerp(toeEnd.position, blend);
            const rotation = standingWorld
              .get(item.end)!
              .quaternion.clone()
              .slerp(restingWorld.get(item.end)!.quaternion, blend);
            const offset = item.toe.position
              .clone()
              .multiply(item.end.getWorldScale(new THREE.Vector3()))
              .applyQuaternion(rotation);
            const target = toeTarget.sub(offset),
              pole = point(item.middle);
            solveChain(item.start, item.middle, item.end, target, pole);
            rotationWorld(item.end, rotation);
            rotationWorld(
              item.toe,
              toeStart.quaternion.clone().slerp(toeEnd.quaternion, blend),
            );
          }
          scene.updateMatrixWorld(true);
        }
        meshes.forEach((mesh) => mesh.skeleton.update());
        lastSignature = signature;
      }
      const cycle = time % 6.1;
      const blink =
        idleBlink && !options.reducedMotion && cycle > 0.3 && cycle < 0.6
          ? Math.sin(((cycle - 0.3) / 0.3) * Math.PI) ** 1.4
          : 0;
      return {
        changed,
        blink,
        transitioning: amount !== target,
        pose: requested,
      };
    },
    reset() {
      restore();
      amount = 0;
      requested = "stand";
      lastTime = undefined;
      lastSignature = "";
    },
    dispose() {
      if (disposed) return;
      result.reset();
      disposed = true;
    },
  };
  return result;
}
