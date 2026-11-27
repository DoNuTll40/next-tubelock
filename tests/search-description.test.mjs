import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import { parseDescriptionImages } from '../src/lib/descriptionImages.mjs';

const source = await fs.readFile(new URL('../src/app/results/ResultsClient.jsx', import.meta.url), 'utf8');
const scoring = source.split('const searchResults = useMemo(() => {')[1].split('}, [videos, currentQuery, applyFilters, renderNow]);')[0];
const search = compileFunction(scoring, ['videos', 'currentQuery', 'applyFilters', 'renderNow', 'parseDescriptionImages']);
const snippetExpression = source.match(/\{(parseDescriptionImages\(video.description\).text.trim\(\) \|\|[\s\S]*?)\}/)[1];
const snippet = compileFunction(`return (${snippetExpression});`, ['video', 'parseDescriptionImages']);

test('image-only and mixed descriptions show plain snippets and remain searchable by title/text', () => {
  const image = '![caption](<https://fixture.invalid/secret-image.jpg>)';
  const videos = [
    { id: 1, title: 'ภาพอย่างเดียว', description: image },
    { id: 2, title: 'ภาพและข้อความ', description: `คำอธิบายปกติ\n${image}` },
    { id: 3, title: 'ข้อความล้วน', description: 'ค้นหาคำธรรมดา' },
  ];
  const find = query => search(videos, query, rows => rows, Date.now(), parseDescriptionImages).map(v => v.id);
  assert.deepEqual(find('ภาพอย่างเดียว'), [1]);
  assert.deepEqual(find('คำอธิบายปกติ'), [2]);
  assert.deepEqual(find('ค้นหาคำธรรมดา'), [3]);
  assert.deepEqual(find('secret-image'), []);
  assert.doesNotMatch(snippet(videos[0], parseDescriptionImages), /!\[|https:|caption/);
  assert.equal(snippet(videos[1], parseDescriptionImages), 'คำอธิบายปกติ');
  assert.equal(snippet(videos[2], parseDescriptionImages), 'ค้นหาคำธรรมดา');
});
