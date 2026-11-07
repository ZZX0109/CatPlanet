import { z } from "zod";
export const HASH = z.string().regex(/^[a-f0-9]{64}$/);
export const ID = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
export const JOB_ID = z.string().regex(/^job-[a-z0-9][a-z0-9-]{0,62}$/);
export const RELATIVE_FILE = z
  .string()
  .max(240)
  .regex(/^(?!.*(?:^|\/)\.\.?(?:\/|$))[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9._-]+)+$/);
const point = z.tuple([
  z.number().finite().min(-10).max(10),
  z.number().finite().min(-10).max(10),
  z.number().finite().min(-10).max(10),
]);
export const coordinatesSchema = z.strictObject({
  units: z.literal("meter"),
  handedness: z.literal("right"),
  up: z.literal("+Y"),
  forward: z.literal("+Z"),
  origin: z.literal("floor-center"),
});
export const dimensionsSchema = z.strictObject({
  height: z.number().min(0.01).max(10),
  width: z.number().min(0.01).max(10),
  length: z.number().min(0.01).max(10),
});
export const operationSchema = z.enum([
  "model-fit",
  "local-edit",
  "groom-adjust",
  "model-validate",
  "groom-validate",
]);
export const executionBudgetSchema = z.strictObject({
  timeoutSeconds: z.number().int().min(1).max(3600),
  maxMemoryMiB: z.number().int().min(128).max(65536),
  device: z.enum(["cpu", "gpu", "auto"]),
  maxGpuMemoryMiB: z.number().int().min(0).max(49152),
});
export const budgetsSchema = z.strictObject({
  maxVertices: z.number().int().min(1).max(2500000),
  maxTriangles: z.number().int().min(1).max(5000000),
  maxJoints: z.number().int().min(0).max(256),
  maxTextureBytes: z.number().int().min(0).max(268435456),
});
export const SHAPE_KEYS = [
  "headRound",
  "headWedge",
  "headWidth",
  "headDepth",
  "cheeks",
  "jaw",
  "muzzle",
  "muzzleWidth",
  "noseBridge",
  "eyeSize",
  "eyeSpacing",
  "eyeTilt",
  "earSize",
  "earTilt",
  "headFurDensity",
  "headFurLength",
  "ruffFurDensity",
  "ruffFurLength",
  "bodyFurDensity",
  "bodyFurLength",
];
const shape = z.strictObject(
  Object.fromEntries(SHAPE_KEYS.map((k) => [k, z.number().min(0).max(100)])),
);
export const appearanceSchema = z.strictObject({
  designSchemaVersion: z.literal(5),
  templateId: z.literal("cat-foundation-v1"),
  coatType: z.enum(["long", "short", "hairless"]),
  coatMode: z.enum(["source", "groom"]),
  shape,
});
export const licenseSchema = z.strictObject({
  status: z.literal("verified"),
  identifier: z.string().min(1).max(128),
  localReviewAllowed: z.literal(true),
  trainingAllowed: z.boolean(),
  publicDistributionAllowed: z.boolean(),
});
const referenceSchema = z.strictObject({
  path: RELATIVE_FILE,
  sha256: HASH,
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  provenance: z.strictObject({
    source: z.enum([
      "user-provided",
      "repository-original",
      "licensed-third-party",
    ]),
    creator: z.string().min(1).max(256),
    evidence: z.string().min(1).max(1024),
  }),
  license: licenseSchema,
  ownerConsent: z.literal(true),
});
const guide = z.strictObject({
  rootBinding: z.strictObject({
    node: ID,
    triangleIndex: z.number().int().min(0),
    barycentric: z.tuple([
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
    ]),
  }),
  points: z.array(point).min(2).max(64),
  radiusMeters: z.number().min(0.000001).max(0.01),
});
export const groomSchema = z.strictObject({
  groomSchemaVersion: z.literal(1),
  topologyVersion: ID,
  bodySurface: z.strictObject({ node: ID }),
  representation: z.enum(["none", "guides"]),
  guides: z.array(guide).max(100000),
});
export const featuresSchema = z.strictObject({
  landmarks: z
    .array(
      z.strictObject({
        name: z.enum([
          "nose",
          "eyeL",
          "eyeR",
          "earL",
          "earR",
          "pawFL",
          "pawFR",
          "pawBL",
          "pawBR",
        ]),
        position: point,
        source: z.enum(["measured", "user-confirmed", "inferred"]),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(9),
});
export const requestSchema = z.strictObject({
  requestVersion: z.literal(1),
  jobId: JOB_ID,
  operation: operationSchema,
  modelId: ID,
  modelRevision: HASH,
  templateId: z.literal("cat-foundation-v1"),
  topologyVersion: ID,
  modelLicense: licenseSchema,
  references: z.array(referenceSchema).max(32),
  coordinates: coordinatesSchema,
  dimensions: dimensionsSchema,
  budgets: budgetsSchema,
  executionBudget: executionBudgetSchema,
  appearance: appearanceSchema,
  groom: groomSchema,
  features: featuresSchema,
});
const file = z.strictObject({
  path: RELATIVE_FILE.or(
    z.enum([
      "appearance.json",
      "model.glb",
      "groom.json",
      "validation.json",
      "preview.png",
      "features.json",
    ]),
  ),
  sha256: HASH,
  bytes: z.number().int().min(1).max(268435456),
});
const moduleBase = {
  interfaceVersion: z.literal(1),
  requestSha256: HASH,
  modelId: ID,
  modelRevision: HASH,
  topologyVersion: ID,
  coordinates: coordinatesSchema,
};
export const morphologySchema = z.strictObject({
  ...moduleBase,
  module: z.literal("A-morphology"),
  state: z.enum(["unavailable", "validated-output"]),
  appearance: appearanceSchema,
  model: file.nullable(),
  features: featuresSchema,
});
export const coatPatternSchema = z.strictObject({
  ...moduleBase,
  module: z.literal("B-coat-pattern"),
  state: z.enum(["unavailable", "validated-output"]),
  uvLayoutRevision: HASH.nullable(),
  pattern: z.strictObject({
    patternVersion: z.literal(1),
    kind: z.enum(["unchanged", "solid", "tabby", "bicolor"]),
    source: z.enum(["user-confirmed", "model-inference"]),
    textures: z.array(file).max(8),
  }),
});
export const groomModuleSchema = z.strictObject({
  ...moduleBase,
  module: z.literal("C-groom"),
  state: z.enum(["unavailable", "validated-output"]),
  groom: groomSchema,
});
export const manifestSchema = z.strictObject({
  manifestVersion: z.literal(1),
  jobId: JOB_ID,
  requestSha256: HASH,
  operation: operationSchema,
  modelId: ID,
  modelRevision: HASH,
  templateId: z.literal("cat-foundation-v1"),
  designSchemaVersion: z.literal(5),
  assetRevision: HASH,
  topologyVersion: ID,
  groomSchemaVersion: z.literal(1),
  coordinates: coordinatesSchema,
  dimensions: dimensionsSchema,
  budgets: budgetsSchema,
  executionBudget: executionBudgetSchema,
  rendererCompatibility: z.strictObject({
    interfaceVersion: z.literal(1),
    gltfVersion: z.literal("2.0"),
    threeRevision: ID.nullable(),
    blenderVersion: ID.nullable(),
    verification: z.literal("unverified"),
    nativeHairPortable: z.literal(false),
  }),
  license: licenseSchema,
  modules: z.strictObject({
    A: z.enum(["unavailable", "validated-output"]),
    B: z.enum(["unavailable", "validated-output"]),
    C: z.enum(["unavailable", "validated-output"]),
  }),
  files: z.strictObject({
    "appearance.json": file,
    "model.glb": file,
    "groom.json": file,
    "features.json": file,
    "preview.png": file,
    "validation.json": file,
  }),
  capabilities: z.strictObject({
    bodySurfaceNode: ID,
    morphTargets: z.array(ID),
    bones: z.array(ID),
    animationClips: z.array(z.string().min(1)),
    eyeControlTargets: z.array(ID),
    eyeControlsVerification: z.literal("unrun"),
    materialNames: z.array(z.string()),
    textureImages: z.array(
      z.strictObject({
        name: ID,
        sha256: HASH,
        bytes: z.number().int().positive(),
      }),
    ),
    rootBinding: z.strictObject({
      node: ID,
      topologyVersion: ID,
      verification: z.literal("unrun"),
    }),
    groomRepresentation: z.enum(["none", "guides", "mesh", "cards"]),
  }),
  productionEvidence: z.strictObject({
    visualAcceptance: z.enum(["unreviewed", "failed", "passed"]),
    reviewId: z.string().min(1).nullable(),
    licenseEvidence: z.string().min(1),
    userPublishConfirmation: z.literal(false),
  }),
});
export const capabilitiesSchema = z.strictObject({
  vertices: z.number().int().nonnegative(),
  triangles: z.number().int().nonnegative(),
  joints: z.number().int().nonnegative(),
  textureBytes: z.number().int().nonnegative(),
  textureImages: z.array(
    z.strictObject({
      name: z.string(),
      bytes: z.number().int().positive(),
      sha256: HASH,
    }),
  ),
  meshNodeNames: z.array(z.string()),
  meshNodeTriangleCounts: z.record(z.string(), z.number().int().nonnegative()),
  explicitBodySurfaceNodes: z.array(z.string()),
  morphTargets: z.array(z.string()),
  bones: z.array(z.string()),
  animationClips: z.array(z.string()),
  materials: z.array(z.string()),
  semanticsVerified: z.literal(false),
  visualVerified: z.literal(false),
  licenseVerified: z.literal(false),
  coordinateSemanticsVerified: z.literal(false),
});
export const validationSchema = z.strictObject({
  validationVersion: z.literal(1),
  jobId: JOB_ID,
  requestSha256: HASH,
  state: z.enum(["valid", "failed", "missing-private-assets", "unavailable"]),
  checks: z.array(
    z.strictObject({
      name: z.string().min(1),
      state: z.enum(["passed", "failed", "missing", "unrun"]),
      details: z.string(),
    }),
  ),
  errors: z.array(z.strictObject({ code: z.string(), message: z.string() })),
  assetRevision: HASH.nullable(),
  capabilities: capabilitiesSchema.nullable(),
});
export const schemas = {
  request: requestSchema,
  appearance: appearanceSchema,
  groom: groomSchema,
  features: featuresSchema,
  manifest: manifestSchema,
  validation: validationSchema,
  "module-a-morphology": morphologySchema,
  "module-b-coat-pattern": coatPatternSchema,
  "module-c-groom": groomModuleSchema,
};
export function parseContract(kind, value) {
  const schema = schemas[kind];
  if (!schema)
    throw Object.assign(Error("Unknown contract: " + kind), {
      code: "CONTRACT_UNKNOWN",
    });
  const result = schema.safeParse(value);
  if (!result.success)
    throw Object.assign(
      Error(
        result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      ),
      { code: "CONTRACT_INVALID" },
    );
  const v = result.data;
  const appearance =
    kind === "request"
      ? v.appearance
      : kind === "appearance"
        ? v
        : kind === "module-a-morphology"
          ? v.appearance
          : null;
  if (
    appearance &&
    appearance.shape.headRound + appearance.shape.headWedge > 100
  )
    throw Object.assign(Error("headRound + headWedge must not exceed 100"), {
      code: "CONTRACT_INVALID",
    });
  if (
    kind === "features" &&
    new Set(v.landmarks.map((l) => l.name)).size !== v.landmarks.length
  )
    throw Object.assign(Error("Duplicate landmark names"), {
      code: "CONTRACT_INVALID",
    });
  if (
    kind === "module-a-morphology" &&
    ((v.state === "unavailable" && v.model !== null) ||
      (v.state === "validated-output" && v.model === null))
  )
    throw Object.assign(Error("Module A availability/output mismatch"), {
      code: "CONTRACT_INVALID",
    });
  if (
    kind === "module-b-coat-pattern" &&
    v.state === "validated-output" &&
    v.uvLayoutRevision === null
  )
    throw Object.assign(Error("Module B output requires UV revision"), {
      code: "CONTRACT_INVALID",
    });
  if (kind === "request") {
    if (
      v.executionBudget.device === "cpu" &&
      v.executionBudget.maxGpuMemoryMiB !== 0
    )
      throw Object.assign(
        Error("CPU execution budget must reserve zero GPU memory"),
        { code: "CONTRACT_INVALID" },
      );
    if (v.operation === "model-fit" && !v.references.length)
      throw Object.assign(
        Error("model-fit requires at least one authorized reference"),
        { code: "REFERENCE_REQUIRED" },
      );
    if (v.groom.topologyVersion !== v.topologyVersion)
      throw Object.assign(Error("Groom topology does not match request"), {
        code: "TOPOLOGY_MISMATCH",
      });
    if (new Set(v.references.map((r) => r.path)).size !== v.references.length)
      throw Object.assign(Error("Duplicate reference paths"), {
        code: "CONTRACT_INVALID",
      });
    if (
      new Set(v.features.landmarks.map((l) => l.name)).size !==
      v.features.landmarks.length
    )
      throw Object.assign(Error("Duplicate landmark names"), {
        code: "CONTRACT_INVALID",
      });
  }
  const groom =
    kind === "request"
      ? v.groom
      : kind === "groom"
        ? v
        : kind === "module-c-groom"
          ? v.groom
          : null;
  if (groom) {
    if (groom.representation === "none" && groom.guides.length)
      throw Object.assign(
        Error("No-groom representation cannot carry guides"),
        { code: "CONTRACT_INVALID" },
      );
    for (const g of groom.guides)
      if (
        Math.abs(g.rootBinding.barycentric.reduce((a, b) => a + b, 0) - 1) >
          1e-6 ||
        g.rootBinding.node !== groom.bodySurface.node
      )
        throw Object.assign(
          Error("Invalid guide surface binding or barycentric sum"),
          { code: "CONTRACT_INVALID" },
        );
  }
  return v;
}
