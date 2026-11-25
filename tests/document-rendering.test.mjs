import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdownDocument } from '../src/lib/renderMarkdownDocument.js';
import { formatThaiRelativeTime } from '../src/lib/formatThaiMeta.js';

test('Markdown retains GFM content and generates unique heading anchors', () => {
  const { html, toc } = renderMarkdownDocument([
    '---', 'title: internal metadata', '---', '',
    '## คู่มือ & วิธีใช้', '',
    '## **คู่มือ** & วิธีใช้', '',
    '## คู่มือ-วิธีใช้-2', '',
    '[Read more](/docs/faq)', '',
    '| Name | Value |',
    '| :--- | ---: |',
    '| Mode | Public |', '',
    '- [x] Complete',
  ].join('\n'));

  assert.deepEqual(toc.map(({ id }) => id), ['คู่มือ-วิธีใช้', 'คู่มือ-วิธีใช้-2', 'คู่มือ-วิธีใช้-2-2']);
  assert.doesNotMatch(html, /internal metadata/);
  assert.match(html, /href="\/docs\/faq"/);
  assert.match(html, /<table>/);
  assert.match(html, /<tr>/);
  assert.match(html, /<td[^>]*>Mode<\/td>/);
  assert.match(html, /disabled/);
});

test('Markdown keeps allowed formatting and removes unsupported HTML attributes and URLs', () => {
  const { html } = renderMarkdownDocument([
    '<h2 class="arbitrary" title="extra">Allowed heading</h2>', '',
    '![Poster](/images/TubeLock.png "Cover")', '',
    '[Unsupported URL](file:///docs/faq.md)', '',
    '<form action="/submit"><input name="field"></form>',
  ].join('\n'));

  assert.match(html, /<h2 id="allowed-heading" class="scroll-mt-20">/);
  assert.match(html, /src="\/images\/TubeLock.png"/);
  assert.doesNotMatch(html, /file:|<form|name="field"|class="arbitrary"|title="extra"/);
});

test('Thai relative times preserve the video card labels', (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-25T12:00:00Z'));
  assert.equal(formatThaiRelativeTime('2026-11-25T11:59:30Z'), 'เมื่อสักครู่');
  assert.equal(formatThaiRelativeTime('2026-11-25T11:55:00Z'), '5 นาทีที่แล้ว');
  assert.equal(formatThaiRelativeTime('2026-11-25T10:00:00Z'), '2 ชม. ที่แล้ว');
  assert.equal(formatThaiRelativeTime('2026-11-22T12:00:00Z'), '3 วันที่แล้ว');
  assert.equal(formatThaiRelativeTime('invalid timestamp'), '');
});
