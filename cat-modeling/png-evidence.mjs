import pngjs from 'pngjs';

/** Bounded decode for returned/pre-rendered PNG evidence, not visual approval. */
export function validatePngEvidence(bytes, { width, height, maxPixels = 4194304 } = {}) {
  const reject = message => { throw Object.assign(Error(message), { code: 'FILES_INVALID' }); };
  if (bytes.length < 33 || bytes.length > 33554432 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12,16).toString() !== 'IHDR') reject('Not a bounded PNG evidence header');
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
  if (!w || !h || w * h > maxPixels || (width !== undefined && width !== w) || (height !== undefined && height !== h)) reject('PNG evidence dimensions exceed limits or differ from scenario');
  // pngjs' interlaced sync path does not cap inflation; our fixed Blender
  // evidence format uses noninterlaced PNG and must fail closed on that path.
  if (bytes[28] !== 0) reject('Interlaced evidence PNG is not supported by the bounded decoder');
  const decoded = pngjs.PNG.sync.read(bytes, { checkCRC: true });
  if (decoded.width !== w || decoded.height !== h || decoded.data.length !== w * h * 4) reject('Incomplete PNG evidence pixels');
  return { width: w, height: h, pixels: w * h };
}
