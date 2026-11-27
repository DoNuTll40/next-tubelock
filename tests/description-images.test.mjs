import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendDescriptionImage,
  DESCRIPTION_IMAGE_LIMIT,
  parseDescriptionImages,
  removeDescriptionImage,
} from '../src/lib/descriptionImages.mjs';

test('parses standalone HTTPS images without changing ordinary description text', () => {
  const description = 'บทนำ  \r\n'
    + '![ภาพแรก](https://images.example/one.jpg)\r\n'
    + '01:30 รายละเอียดและ #TubeLock\r\n'
    + '![ภาพถัดไป](<https://images.example/a(2).jpg?size=500>)\r\n'
    + 'ท้ายคลิป ![พูดถึงภาพ](https://images.example/text.jpg)';

  assert.deepEqual(parseDescriptionImages(description), {
    text: 'บทนำ  \r\n01:30 รายละเอียดและ #TubeLock\r\nท้ายคลิป ![พูดถึงภาพ](https://images.example/text.jpg)',
    images: [
      { src: 'https://images.example/one.jpg', alt: 'ภาพแรก' },
      { src: 'https://images.example/a(2).jpg?size=500', alt: 'ภาพถัดไป' },
    ],
  });
});

test('keeps invalid declarations as text and caps the legacy gallery at fifty images', () => {
  const invalid = [
    '![caption](http://images.example/one.jpg)',
    '![caption](https://user:password@images.example/one.jpg)',
    '![caption](javascript:alert(1))',
    '![caption](<https:///images.example/one.jpg>)',
  ].join('\n');
  const images = Array.from({ length: DESCRIPTION_IMAGE_LIMIT + 1 }, (_, index) =>
    '![caption](https://images.example/' + index + '.jpg)');
  const description = invalid + '\n' + images.join('\n');

  assert.equal(parseDescriptionImages(description).images.length, DESCRIPTION_IMAGE_LIMIT);
  assert.equal(parseDescriptionImages(description).text, invalid + '\n' + images.at(-1));
  assert.equal(appendDescriptionImage(description, { src: 'https://images.example/extra.jpg' }), null);
});

test('adding and removing attachments preserves text, line endings, and escaped captions', () => {
  const original = 'บทนำ  \r\nคำอธิบาย  \r\n';
  const first = appendDescriptionImage(original, {
    src: 'https://images.example/first.jpg',
    alt: 'เบื้องหลัง [กล้อง] \\ ภาพที่หนึ่ง',
  });
  const second = appendDescriptionImage(first, {
    src: 'https://images.example/second.jpg',
    alt: 'ภาพที่สอง',
  });

  assert.equal(parseDescriptionImages(second).text, original);
  assert.equal(parseDescriptionImages(second).images[0].alt, 'เบื้องหลัง [กล้อง] \\ ภาพที่หนึ่ง');
  assert.equal(removeDescriptionImage(removeDescriptionImage(second, 0), 0), original);
});
