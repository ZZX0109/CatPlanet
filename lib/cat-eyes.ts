import * as THREE from "three";

export type CatEyeOptions = {
  radius: number;
  color: string;
  coat: string;
  side: number;
};

// A photograph-like iris is painted in UV space so it survives GLB export.
// The pupil belongs to the iris image; nothing floats above the eye as a black bead.
function irisTexture(color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(512, 512);
  const base = new THREE.Color(color).convertLinearToSRGB();
  const noise = (n: number) => {
    const f = Math.sin(n * 127.13 + 78.23) * 43758.5453;
    return f - Math.floor(f);
  };
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const dx = x - 256,
        dy = y - 256;
      const length = Math.hypot(dx, dy),
        radial = length / 195;
      const angle = Math.atan2(dy, dx);
      const i = (y * 512 + x) * 4;
      let red = 0.3,
        green = 0.29,
        blue = 0.25;
      if (radial < 1) {
        const fine = Math.sin(
          angle * 143 + Math.sin(angle * 31) * 2.1 + radial * 7,
        );
        const fibers = Math.sin(
          angle * 291 + Math.sin(angle * 73) * 1.8 + radial * 12,
        );
        const irregular = noise(
          Math.floor(angle * 240) * 9 + Math.floor(radial * 60),
        );
        const brightness = 0.7 + fine * 0.1 + fibers * 0.055 + irregular * 0.12;
        const limbus = 1 - THREE.MathUtils.smoothstep(radial, 0.87, 1) * 0.65;
        const inner = Math.exp(-(((radial - 0.38) / 0.15) ** 2));
        red = (base.r * brightness + inner * 0.075) * limbus;
        green = (base.g * brightness + inner * 0.03) * limbus;
        blue = base.b * brightness * limbus;
        const pupil = (dx / 58) ** 2 + (dy / 148) ** 2;
        const pupilEdge = THREE.MathUtils.smoothstep(pupil, 0.96, 1.1);
        red = THREE.MathUtils.lerp(0.018, red, pupilEdge);
        green = THREE.MathUtils.lerp(0.025, green, pupilEdge);
        blue = THREE.MathUtils.lerp(0.02, blue, pupilEdge);
      }
      image.data[i] = Math.round(THREE.MathUtils.clamp(red, 0, 1) * 255);
      image.data[i + 1] = Math.round(THREE.MathUtils.clamp(green, 0, 1) * 255);
      image.data[i + 2] = Math.round(THREE.MathUtils.clamp(blue, 0, 1) * 255);
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.name = "Feline radial iris";
  return texture;
}

export function createCatEye({ radius: r, color, coat, side }: CatEyeOptions) {
  const group = new THREE.Group();
  group.name = side < 0 ? "EyeL" : "EyeR";
  const texture = irisTexture(color);
  const lidMaterial = new THREE.MeshPhysicalMaterial({
    color: coat,
    roughness: 0.94,
    sheen: 0.3,
    sheenRoughness: 1,
    side: THREE.DoubleSide,
  });
  const tearMaterial = new THREE.MeshStandardMaterial({
    color: "#48392e",
    roughness: 0.52,
    side: THREE.DoubleSide,
  });
  const irisMaterial = new THREE.MeshPhysicalMaterial({
    map: texture,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.055,
    ior: 1.376,
  });
  const tilt = side * 0.065;
  const upper = (x: number) =>
    0.63 * r * Math.pow(Math.max(0, 1 - (x / r) ** 2), 0.72) + tilt * x;
  const lower = (x: number) =>
    -0.47 * r * Math.pow(Math.max(0, 1 - (x / r) ** 2), 0.78) + tilt * x;
  const meet = (x: number) =>
    -0.1 * r * Math.max(0, 1 - (x / r) ** 2) + tilt * x;
  const cap = (x: number, y: number) =>
    r * 0.33 - (0.15 * x * x) / r - (0.16 * y * y) / r;
  const normal = (x: number, y: number) =>
    new THREE.Vector3((0.3 * x) / r, (0.32 * y) / r, 1).normalize();
  type Position = (u: number, v: number) => THREE.Vector3;
  // Optional closing positions are relative morph targets, rather than scaling the eyeball.
  function patch(
    name: string,
    nx: number,
    ny: number,
    position: Position,
    material: THREE.Material,
    closed?: Position,
  ) {
    const positions: number[] = [],
      normals: number[] = [],
      uv: number[] = [],
      indices: number[] = [];
    const closing: number[] = [],
      closingNormals: number[] = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const p = position(i / nx, j / ny),
          n = normal(p.x, p.y);
        positions.push(p.x, p.y, p.z);
        normals.push(n.x, n.y, n.z);
        uv.push(0.5 + p.x / (2 * r), 0.5 + p.y / (2 * r));
        if (closed) {
          const q = closed(i / nx, j / ny),
            qn = normal(q.x, q.y);
          closing.push(q.x - p.x, q.y - p.y, q.z - p.z);
          closingNormals.push(qn.x - n.x, qn.y - n.y, qn.z - n.z);
        }
      }
    }
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i,
          b = a + nx + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    if (closed) {
      const attribute = new THREE.Float32BufferAttribute(closing, 3);
      attribute.name = "eyelidClosure";
      geometry.morphAttributes.position = [attribute];
      geometry.morphAttributes.normal = [
        new THREE.Float32BufferAttribute(closingNormals, 3),
      ];
      geometry.morphTargetsRelative = true;
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  }
  patch(
    "Corneal aperture",
    48,
    16,
    (u, v) => {
      const x = (u * 2 - 1) * r,
        y = THREE.MathUtils.lerp(lower(x), upper(x), v);
      return new THREE.Vector3(x, y, cap(x, y));
    },
    irisMaterial,
  );
  const shutters: THREE.Mesh[] = [];
  for (const isUpper of [true, false]) {
    const edge = isUpper ? upper : lower;
    // Soft eyelid margin wraps from the eye opening back into the furred face.
    patch(
      isUpper ? "Upper orbital rim" : "Lower orbital rim",
      48,
      5,
      (u, v) => {
        const x = (u * 2 - 1) * r;
        const arch = Math.pow(Math.max(0, 1 - (x / r) ** 2), 0.6);
        const y = edge(x) + (isUpper ? 1 : -1) * v * r * 0.16 * arch;
        return new THREE.Vector3(
          x * (1 + v * 0.09),
          y,
          cap(x, edge(x)) + r * 0.026 - v * r * 0.22,
        );
      },
      lidMaterial,
    );
    const shutter =
      (closure: number): Position =>
      (u, v) => {
        const x = (u * 2 - 1) * r,
          outer = edge(x);
        const arch = Math.max(0, 1 - (x / r) ** 2);
        const inner = THREE.MathUtils.lerp(outer, meet(x), closure);
        // A tiny non-degenerate open margin has valid normals and a soft lash line.
        const y = THREE.MathUtils.lerp(
          outer,
          inner + (isUpper ? -1 : 1) * 0.006 * r * arch,
          v,
        );
        return new THREE.Vector3(x, y, cap(x, y) + r * 0.035);
      };
    shutters.push(
      patch(
        isUpper ? "Upper eyelid" : "Lower eyelid",
        48,
        8,
        shutter(0),
        lidMaterial,
        shutter(1),
      ),
    );
    const tearline =
      (closure: number): Position =>
      (u, v) => {
        const x = (u * 2 - 1) * r;
        const arch = Math.pow(Math.max(0, 1 - (x / r) ** 2), 0.5);
        const y =
          THREE.MathUtils.lerp(edge(x), meet(x), closure) +
          (v - 0.5) * r * 0.028 * arch;
        return new THREE.Vector3(x, y, cap(x, y) + r * 0.042);
      };
    shutters.push(
      patch(
        isUpper ? "Upper wet margin" : "Lower wet margin",
        48,
        2,
        tearline(0),
        tearMaterial,
        tearline(1),
      ),
    );
  }
  return {
    group,
    setClosure(amount: number) {
      const closure = THREE.MathUtils.clamp(amount, 0, 1);
      for (const mesh of shutters) mesh.morphTargetInfluences![0] = closure;
    },
    dispose() {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      irisMaterial.dispose();
      lidMaterial.dispose();
      tearMaterial.dispose();
      texture.dispose();
    },
  };
}
