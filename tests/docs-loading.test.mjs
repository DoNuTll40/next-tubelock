import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { getAllDocs, getDocBySlug } from '../src/lib/docs.js';
import { renderMarkdownDocument } from '../src/lib/renderMarkdownDocument.js';

test('each documentation page receives its content, date and navigation from the docs loader', async () => {
  const docs = await getAllDocs();
  assert.ok(docs.length > 0);
  for (const [index, entry] of docs.entries()) {
    const doc = await getDocBySlug(entry.slug);
    const raw = await fs.readFile(new URL(`../docs/${entry.fileName}`, import.meta.url), 'utf8');
    assert.equal(renderMarkdownDocument(doc.content).html, renderMarkdownDocument(raw).html);
    assert.ok(doc.updatedAt);
    assert.equal(doc.prevDoc?.slug, docs[index - 1]?.slug);
    assert.equal(doc.nextDoc?.slug, docs[index + 1]?.slug);
  }
});

test('unknown and traversing document slugs do not resolve to a file', async () => {
  assert.equal(await getDocBySlug('missing-document-fixture'), null);
  assert.equal(await getDocBySlug('../package'), null);
});
