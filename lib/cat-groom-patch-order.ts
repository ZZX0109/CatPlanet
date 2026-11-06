/** A draw order for existing planted fibres; does not plant or move any root. */

function fixedPatchRandom() {
  let state = 0x6d78514f;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

/**
 * Shuffle whole planting patches while retaining every member's original
 * within-patch order. An arbitrary draw prefix can cut only its final patch.
 * The final undersized planting patch is preserved and shuffled as one unit.
 * Input roots and their planting/random stream are never modified.
 *
 * Call before any per-root shuffle. A caller-provided random callback must be
 * independent of the planting stream and return finite values in [0, 1).
 * The default generator is reset per call, so identical input lengths produce
 * identical orders; it deliberately does not depend on mutable root values.
 */
export function createCatGroomPatchOrder<T>(
  roots: readonly T[],
  groupSize = 6,
  random: () => number = fixedPatchRandom(),
): Uint32Array {
  if (!Number.isSafeInteger(groupSize) || groupSize < 1)
    throw new Error("Groom patch size must be a positive safe integer.");
  if (!Number.isSafeInteger(roots.length) || roots.length > 0xffffffff)
    throw new Error("Groom root count exceeds Uint32 permutation capacity.");
  if (typeof random !== "function")
    throw new Error("Groom patch random source must be a function.");

  const patchCount = Math.ceil(roots.length / groupSize);
  const patches = new Uint32Array(patchCount);
  for (let patch = 0; patch < patchCount; patch++) patches[patch] = patch;
  for (let i = patchCount - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Groom patch random source must return values in [0, 1).");
    const j = Math.floor(value * (i + 1));
    [patches[i], patches[j]] = [patches[j], patches[i]];
  }

  const order = new Uint32Array(roots.length);
  let cursor = 0;
  for (const patch of patches) {
    const first = patch * groupSize;
    const end = Math.min(roots.length, first + groupSize);
    for (let member = first; member < end; member++) order[cursor++] = member;
  }
  return order;
}
