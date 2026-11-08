import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { validatePngEvidence } from '../png-evidence.mjs';

test('PNG evidence requires decodable pixels and CRC, with an independent allocation bound', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
  assert.deepEqual(validatePngEvidence(png), { width: 2, height: 2, pixels: 4 });
  assert.throws(() => validatePngEvidence(png.subarray(0,33)));
  const badCRC = Buffer.from(png); badCRC[29] ^= 1;
  assert.throws(() => validatePngEvidence(badCRC));
  const huge = Buffer.from(png); huge.writeUInt32BE(0xffffffff,16); huge.writeUInt32BE(0xffffffff,20);
  assert.throws(() => validatePngEvidence(huge, { width:0xffffffff, height:0xffffffff }), /limits/);
  const interlaced = Buffer.from(png); interlaced[28]=1;
  assert.throws(() => validatePngEvidence(interlaced), /Interlaced/);
});
