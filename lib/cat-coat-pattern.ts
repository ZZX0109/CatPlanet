import * as THREE from "three";
import type { CatDesign } from "./cat-studio";

const clamp = THREE.MathUtils.clamp;
const smooth = (value: number, from: number, to: number) => {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};
const bell = (distance: number, width: number) =>
  Math.exp(-((distance / width) ** 2));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function lattice(x: number, y: number, z: number) {
  let n =
    Math.imul(x, 374761393) ^
    Math.imul(y, 668265263) ^
    Math.imul(z, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

// Smooth value noise: finite spatial differences change the coat gradually,
// including at patch edges. All coordinates are in the neutral model space.
function noise(x: number, y: number, z: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = smooth(x - ix, 0, 1),
    fy = smooth(y - iy, 0, 1),
    fz = smooth(z - iz, 0, 1);
  const low = mix(
    mix(lattice(ix, iy, iz), lattice(ix + 1, iy, iz), fx),
    mix(lattice(ix, iy + 1, iz), lattice(ix + 1, iy + 1, iz), fx),
    fy,
  );
  const high = mix(
    mix(lattice(ix, iy, iz + 1), lattice(ix + 1, iy, iz + 1), fx),
    mix(lattice(ix, iy + 1, iz + 1), lattice(ix + 1, iy + 1, iz + 1), fx),
    fy,
  );
  return mix(low, high, fz);
}

type Palette = {
  base: THREE.Color;
  markings: THREE.Color;
  white: THREE.Color;
  undercoat: THREE.Color;
};
const palettes = new WeakMap<CatDesign, Palette>();
function palette(design: CatDesign) {
  let result = palettes.get(design);
  if (!result) {
    const base = new THREE.Color(design.coat);
    const white = new THREE.Color("#ece8dd");
    result = {
      base,
      white,
      markings: new THREE.Color(design.markings),
      undercoat: base.clone().lerp(white, 0.16),
    };
    palettes.set(design, result);
  }
  return result;
}

const flankStripes = [
  [-0.76, 0.02],
  [-0.55, 0.025],
  [-0.33, 0.019],
  [-0.13, 0.029],
  [0.105, 0.022],
  [0.31, 0.024],
  [0.49, 0.018],
] as const;

/**
 * Portable vertex albedo for the neutral short-hair cat. This separates narrow,
 * interrupted mackerel flank markings from the spine, face and tail instead of
 * applying one sinusoid as equally spaced rings around the whole animal.
 */
export function sampleCoat(
  point: THREE.Vector3,
  design: CatDesign,
): THREE.Color {
  const { x, y, z } = point;
  const absX = Math.abs(x);
  const colors = palette(design);
  const result = colors.base.clone();

  const headFront = smooth(z, 0.91, 1.025);
  const head = smooth(y, 1.2, 1.36) * smooth(z, 0.65, 0.84);
  const torso = smooth(z, -1.0, -0.83) * (1 - smooth(z, 0.55, 0.69));
  const macro = noise(x * 5.3 + 1.2, y * 4.7, z * 4.1);

  if (design.pattern === "tabby") {
    // A little pale undercoat is strongest on the lower flank and muzzle. It
    // lightens the user's selected coat without replacing its hue with orange.
    const ventral = (1 - smooth(y, 0.82, 1.19)) * torso;
    const muzzleCream =
      bell(x, 0.17) * bell(y - 1.29, 0.09) * bell(z - 1.09, 0.1);
    result.lerp(colors.undercoat, Math.max(ventral * 0.75, muzzleCream * 0.45));

    let flank = 0;
    for (let i = 0; i < flankStripes.length; i++) {
      const [center, width] = flankStripes[i];
      const path =
        center +
        Math.sin(y * 7.2 + i * 1.7) * 0.027 +
        Math.sin(x * 12 + i) * 0.013;
      const taper = 0.72 + 0.28 * Math.sin(y * 8.7 + i * 2.1);
      flank = Math.max(flank, bell(z - path, width * taper));
    }
    const flankMask = smooth(absX, 0.1, 0.24) * bell(y - 1.02, 0.34) * torso;
    const broken =
      0.18 + 0.82 * smooth(noise(x * 9, y * 13, z * 6 + 3.7), 0.26, 0.64);
    flank *= flankMask * broken;

    const back = smooth(y, 1.18, 1.34) * torso;
    const spine =
      (bell(x, 0.024) * 0.7 + bell(absX - 0.085, 0.014) * 0.25) * back;

    // The forehead M is four curved stems above the eye sockets, rather than a
    // sharp repeated bar code. Coordinates match the shorter v2 head.
    const foreheadY = clamp((y - 1.54) / 0.12, 0, 1);
    const outerM = bell(absX - (0.15 - 0.055 * foreheadY), 0.014);
    const innerM = bell(absX - 0.095 * foreheadY, 0.013);
    const forehead =
      Math.max(outerM, innerM) * bell(y - 1.6, 0.075) * headFront;
    const nasal = bell(x, 0.017) * bell(y - 1.47, 0.12) * headFront;
    const cheekArea = bell(absX - 0.205, 0.075) * smooth(z, 0.88, 1.0);
    const cheekOne = bell(y - (1.405 - 0.38 * (absX - 0.16)), 0.009);
    const cheekTwo = bell(y - (1.33 - 0.18 * (absX - 0.16)), 0.008);
    const cheeks = Math.max(cheekOne, cheekTwo) * cheekArea;

    const limb =
      (1 - smooth(y, 0.62, 0.87)) *
      smooth(y, 0.16, 0.32) *
      smooth(absX, 0.13, 0.2);
    const limbBands =
      Math.pow(Math.max(0, Math.sin(y * 29 + z * 4 + x * 2)), 7) * limb;
    const tail = smooth(-z, 0.97, 1.12);
    const tailBands =
      Math.pow(Math.max(0, Math.sin((z + 0.93) * 35 + x * 5)), 6) * tail;

    const marking = Math.max(
      flank * 0.43,
      spine * 0.4,
      forehead * 0.47,
      nasal * 0.2,
      cheeks * 0.43,
      limbBands * 0.28,
      tailBands * 0.45,
    );
    result.lerp(colors.markings, clamp(marking * (0.9 + macro * 0.15), 0, 0.6));
  } else if (design.pattern === "calico") {
    // Separate low-frequency fields create organic orange and dark patches
    // against a cream base, without a regular checkerboard or hard contour.
    const orange = smooth(noise(x * 4.7 + 2.1, y * 4.1, z * 3.6), 0.42, 0.62);
    const dark =
      smooth(noise(x * 5.4 - 4.3, y * 3.7 + 5.8, z * 3.9 - 2.7), 0.56, 0.74) *
      (1 - orange * 0.55);
    result
      .copy(colors.white)
      .lerp(colors.base, orange)
      .lerp(colors.markings, dark);
  }

  if (design.pattern !== "solid") {
    const chin = bell(x, 0.145) * bell(y - 1.245, 0.064) * bell(z - 1.075, 0.1);
    const muzzle =
      bell(x, 0.16) * bell(y - 1.295, 0.065) * bell(z - 1.105, 0.085);
    const bib = bell(x, 0.17) * bell(y - 1.04, 0.32) * bell(z - 0.74, 0.2);
    const sockHeight = 0.135 + Math.sin(z * 8 + x * 11) * 0.012;
    const socks = 1 - smooth(y, sockHeight - 0.035, sockHeight + 0.035);
    const blaze =
      bell(x, 0.045) * bell(z - 1.05, 0.12) * bell(y - 1.38, 0.15) * head;
    const mask =
      design.pattern === "bicolor"
        ? Math.max(chin, muzzle * 0.9, bib, socks, blaze * 0.82)
        : Math.max(chin, muzzle * 0.48, bib * 0.58, socks * 0.64);
    result.lerp(colors.white, clamp(mask, 0, 1));
  }

  // Subtle continuous value variation, kept below visible white speckle levels.
  const micro = noise(x * 83, y * 37, z * 71);
  const brightness = 0.975 + macro * 0.035 + micro * 0.018;
  result.multiplyScalar(brightness);
  result.r = clamp(result.r, 0, 1);
  result.g = clamp(result.g, 0, 1);
  result.b = clamp(result.b, 0, 1);
  return result;
}
