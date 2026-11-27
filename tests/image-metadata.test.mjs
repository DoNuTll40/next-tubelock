import test from 'node:test';
import assert from 'node:assert/strict';
import { extractImageMetadata, metadataText, photoInfoRows } from '../src/lib/imageMetadata.mjs';

test('extracts actual JPEG EXIF camera tags without merging namespaces', async () => {
  const tiff = Buffer.alloc(38);
  tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x110, 10); tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(12, 14); tiff.writeUInt32LE(26, 18);
  tiff.write('Tube Camera\0', 26);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const segment = Buffer.alloc(4); segment.writeUInt16BE(0xffe1); segment.writeUInt16BE(payload.length + 2, 2);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), segment, payload, Buffer.from([0xff, 0xd9])]);
  const metadata = await extractImageMetadata(jpeg);
  assert.equal(metadata.ifd0.Model, 'Tube Camera');
});

test('reads PNG dimensions from file bytes', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64');
  const metadata = await extractImageMetadata(png);
  assert.equal(metadata.ihdr.ImageWidth, 1);
  assert.equal(metadata.ihdr.ImageHeight, 1);
});

test('formats dates, binary fields and nested metadata without losing values', () => {
  assert.equal(metadataText(new Uint8Array([0, 15, 255])), '00 0f ff');
  assert.equal(metadataText(new Date('2026-11-27T00:00:00Z')), '2026-11-27T00:00:00.000Z');
  assert.match(metadataText({ gps: [13.1, 100.2] }), /100.2/);
});

test('shows familiar EXIF fields and excludes binary profiles and internal tags', () => {
  const rows = photoInfoRows({ ifd0: { Make: 'NIKON CORPORATION', Model: 'NIKON D800', RedTRC: new Uint8Array([12, 45]) }, exif: { FocalLength: 35, ExposureTime: 1 / 125, FNumber: 8, ISO: 100, Flash: 0, MakerNote: new Uint8Array([1, 2]), MeteringMode: 'Pattern' }, icc: { ProfileDescription: 'sRGB', RedTRC: 'binary data' } });
  assert.equal(rows['รุ่นกล้อง'], 'NIKON D800');
  assert.equal(rows['ความเร็วชัตเตอร์'], '1/125 s');
  assert.equal(rows['รูรับแสง'], 'f/8');
  assert.equal(rows['แฟลช'], 'ไม่ใช้แฟลช');
  assert.equal(rows['การวัดแสง'], 'หลายพื้นที่');
  assert.equal(Object.values(rows).some(value => value.includes('binary')), false);
  assert.deepEqual(photoInfoRows({ icc: { RedTRC: new Uint8Array([1]) } }), {});
});
