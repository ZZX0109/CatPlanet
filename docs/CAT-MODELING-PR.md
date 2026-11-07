Creator v5 appearance was rejected by the room's historical v4 asset metadata. This change separates design, binary/topology, groom and renderer contracts while retaining legacy appearance migrations and pinned asset identities. Studio and room now validate actual morph buffers, skin bindings and explicit body surfaces through shared checks.

The offline cat-modeling CLI adds strict versioned request/output and A/B/C worker contracts, real local GLB inspection, immutable job logs, standard JSON errors and safe local-Blender preview handoffs. Production inference and publication explicitly return unavailable; deterministic geometry is available only through the explicit fixture engine. The Skill and public GitHub Actions tests use these interfaces.

Validation performed locally:

- 43 Node contract/CLI tests and 8 Chromium contract/draft/mobile-simulation regressions passed.
- Type checking and Next.js production build passed.
- Nine generated JSON Schemas match their runtime definitions and use distinct IDs from the fixture schemas.
- Three tracked public GLBs passed structural inspection. Missing private assets return exit 5, unconfigured inference exit 6, and unavailable production publication exit 7.

Private Norwegian/Sphynx and archived room GLBs, original Blender files and the original audit report are absent. Their actual rig/groom/action/appearance and four-stage visual acceptance remain blocked, and GitHub Actions results must be confirmed remotely. See `docs/CAT-MODELING-CLOUD-REFACTOR.md` for compatibility, evidence requirements and limitations.

This is an infrastructure draft. It does not implement AI photo-to-cat reconstruction, train or download weights, upload private photos, change databases, activate models, deploy a website or merge changes.
