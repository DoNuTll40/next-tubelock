import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileFunction } from 'node:vm';
import fs from 'node:fs/promises';
import { serializeDescriptionDocument, parseDescriptionDocument, parseRichDescription, validateSavedDescription, DESCRIPTION_PREFIX, DESCRIPTION_ALBUM_IMAGE_LIMIT } from '../src/lib/descriptionDocument.mjs';
import { parseDescriptionImages, appendDescriptionImage, removeDescriptionImage } from '../src/lib/descriptionImages.mjs';
import { stageDescriptionImages, uploadDescriptionImage } from '../src/lib/descriptionImageUpload.mjs';
import { createDescriptionImageHandlers } from '../src/lib/descriptionImageService.mjs';
import { canViewVideo } from '../src/lib/videoVisibility.js';
import { splitDescriptionTimestamps } from '../src/lib/descriptionTimestamps.mjs';

const jpeg = Buffer.from([255, 216, 255, 224, 0, 1, 2, 3]);
const assetId = `${createHash('sha256').update(jpeg).digest('hex')}.jpg`;
const src = `/api/videos/25/description-images/${assetId}`;
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://fixture.invalid/read' } }] }] });
function fixtureDescription() {
  return {
    document: { type: 'doc', content: [paragraph('Hello #testing'), { type: 'descriptionAlbum', attrs: { albumId: 'two' } }, { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'After album' }] }, { type: 'descriptionAlbum', attrs: { albumId: 'one' } }] },
    albums: [{ id: 'one', title: 'First in sidebar', images: [{ src: 'https://fixture.invalid/one.png', alt: 'One' }] }, { id: 'two', title: 'First in document', images: [{ src, alt: 'Two', name: 'photo.jpg', metadata: { exif: { ISO: 100 } } }, { src: 'https://fixture.invalid/two.png', alt: 'Three' }] }],
  };
}

test('rich document survives save/reopen with formatting, album placement, image order, captions and HTTPS', () => {
  const input = fixtureDescription();
  const saved = validateSavedDescription(serializeDescriptionDocument(input), 25);
  const reopened = parseDescriptionDocument(saved);
  assert.deepEqual(reopened.document.content.map(node => node.type === 'descriptionAlbum' ? node.attrs.albumId : node.type), ['paragraph', 'two', 'heading', 'one']);
  assert.deepEqual(reopened.document.content[0], input.document.content[0]);
  assert.deepEqual(reopened.albums[1].images.map(image => image.alt), ['Two', 'Three']);
  assert.equal(reopened.albums[1].images[0].src, src);
  assert.equal(reopened.albums[1].images[0].metadata.exif.ISO, 100);
  assert.equal(reopened.text, 'Hello #testing\n\nAfter album\n');
  assert.ok(saved.includes('Hello #testing'), 'SQL candidate filters can match derived plain text');
  assert.deepEqual(parseDescriptionImages(saved), { text: reopened.text, images: reopened.albums.flatMap(album => album.images) });
});

test('legacy plain text and Markdown images reopen and upgrade without interpreting HTML', () => {
  const legacy = 'plain <script>alert(1)</script>\r\n![caption](<https://fixture.invalid/old.jpg>)';
  const reopened = parseDescriptionDocument(legacy);
  assert.equal(reopened.text, 'plain <script>alert(1)</script>\r\n');
  assert.equal(reopened.albums[0].images[0].alt, 'caption');
  const saved = serializeDescriptionDocument(reopened);
  assert.match(parseDescriptionDocument(saved).text, /<script>/);
  assert.equal(parseDescriptionDocument('ordinary text').text, 'ordinary text');
  const linked = parseDescriptionDocument('00:10 Visit https://fixture.invalid/00:30').document.content[0].content;
  assert.equal(linked.at(-1).marks[0].attrs.href, 'https://fixture.invalid/00:30');
  const added = appendDescriptionImage(saved, { src: 'https://fixture.invalid/new.jpg', alt: 'new' });
  assert.equal(parseDescriptionImages(added).images.length, 2);
  assert.equal(parseDescriptionImages(removeDescriptionImage(added, 0)).images[0].alt, 'new');
});

test('validation rejects temporary/cross-video sources, unsafe markup, malformed and oversized envelopes', () => {
  const value = fixtureDescription();
  assert.throws(() => validateSavedDescription(serializeDescriptionDocument(value), 26), /another video/);
  assert.throws(() => validateSavedDescription(serializeDescriptionDocument(value)), /video is required/);
  for (const source of ['blob:temporary', 'data:image/png;base64,123', 'javascript:alert(1)', 'https://user:password@fixture.invalid/a']) {
    value.albums[1].images[0].src = source;
    assert.throws(() => serializeDescriptionDocument(value));
  }
  assert.throws(() => serializeDescriptionDocument({ document: { type: 'doc', content: [{ type: 'script' }] }, albums: [] }));
  assert.throws(() => serializeDescriptionDocument({ document: { type: 'doc', content: [paragraph('x'.repeat(50001))] }, albums: [] }), /too long/);
  assert.throws(() => validateSavedDescription(DESCRIPTION_PREFIX + '{}', 25));
  assert.throws(() => validateSavedDescription('![file](blob:temporary)', 25));
  assert.equal(parseRichDescription('plain JSON {"document":{}}'), null);
});

test('staging uploads files once on retry, preserves external images, and only returns durable sources', async () => {
  const file = new File([jpeg], 'camera.jpg', { type: 'image/jpeg' });
  const input = fixtureDescription();
  input.albums[1].images[0] = { src: 'blob:temporary', file, alt: 'Local caption', metadata: { exif: { ISO: 200 } } };
  let calls = 0;
  const upload = async (videoId, actualFile) => { calls++; assert.equal(videoId, 25); assert.equal(actualFile, file); return { src, assetId }; };
  const staged = await stageDescriptionImages({ videoId: 25, ...input, upload });
  const saved = serializeDescriptionDocument(staged);
  assert.doesNotMatch(saved, /blob:|"file":/);
  assert.equal(parseDescriptionDocument(saved).albums[1].images[0].alt, 'Local caption');
  assert.equal(staged.albums[1].images[1].src, input.albums[1].images[1].src);
  await stageDescriptionImages({ videoId: 25, ...input, upload });
  assert.equal(calls, 1);
  input.albums[0].images[0].src = 'blob:missing-file';
  await assert.rejects(stageDescriptionImages({ videoId: 25, ...input, upload }));
  assert.equal(calls, 1, 'preflight rejects before any upload');
});

test('allows 50 images in each album and rejects the 51st before uploading', async () => {
  const input = fixtureDescription();
  for (const album of input.albums) {
    album.images = Array.from({ length: DESCRIPTION_ALBUM_IMAGE_LIMIT }, (_, index) => ({
      src: 'https://fixture.invalid/' + index + '.jpg',
    }));
  }
  const saved = serializeDescriptionDocument(input, { videoId: 25 });
  assert.deepEqual(parseRichDescription(saved).albums.map(album => album.images.length), [50, 50]);
  input.albums[1].images.push({ src: 'https://fixture.invalid/overflow.jpg' });
  assert.throws(() => serializeDescriptionDocument(input), /up to 50/);
  await assert.rejects(stageDescriptionImages({
    videoId: 25, ...input, upload: async () => assert.fail('An oversized album must fail before transfer'),
  }), /up to 50/);
});

function service({ userId = 7, visibility = 'private', status = 'READY', description = serializeDescriptionDocument(fixtureDescription()), upstreamStatus = 200, storedSize = jpeg.length, storedBytes = jpeg } = {}) {
  const calls = [];
  const sessions = [];
  let tokens = 0;
  const handlers = createDescriptionImageHandlers({
    getDb: () => async strings => { assert.match(strings.join('?'), /^SELECT/); return [{ id: 25, user_id: 7, visibility, status, description }]; },
    getSessionUserId: async () => userId,
    isAdmin: id => id === 1,
    canViewVideo,
    getGraphToken: async () => { tokens++; return 'fixture-token'; },
    getUserDriveId: async () => 'fixture-drive',
    createUploadSession: async (name, folder) => {
      sessions.push({ name, folder });
      return { uploadUrl: 'https://fixture.invalid/session' };
    },
    rateLimitResponse: async () => null,
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      if (url.endsWith('?$select=size,file')) return Response.json({ size: storedSize, file: {} }, { status: upstreamStatus });
      return new Response(storedBytes, { status: upstreamStatus });
    },
  });
  return { ...handlers, calls, sessions, tokens: () => tokens };
}
const context = (extra = {}) => ({ params: Promise.resolve({ id: '25', ...extra }) });
function uploadRequest(body = {}) {
  return new Request('https://fixture.invalid/api/videos/25/description-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'session', size: jpeg.length, type: 'image/jpeg', name: 'fixture.jpg', ...body }),
  });
}

test('only the owner or an admin can create an image session, including files above 4 MiB', async () => {
  for (const [userId, expected] of [[null, 401], [8, 404], [7, 200], [1, 200]]) {
    const mock = service({ userId });
    const response = await mock.POST(uploadRequest({ size: 20 * 1024 * 1024 }), context());
    assert.equal(response.status, expected);
    assert.equal(mock.sessions.length, expected === 200 ? 1 : 0);
    if (expected === 200) {
      const { assetId, uploadUrl } = await response.json();
      assert.match(assetId, /^[a-f0-9]{64}\.jpg$/);
      assert.equal(uploadUrl, 'https://fixture.invalid/session');
      assert.deepEqual(mock.sessions[0], { name: assetId, folder: '/description-images/video_25' });
    }
  }
  const mock = service();
  for (const body of [{ type: 'image/svg+xml' }, { size: 0 }]) {
    assert.equal((await mock.POST(uploadRequest(body), context())).status, 400);
  }
  assert.equal(mock.sessions.length, 0);
});

test('completion checks the stored size and file signature in the video folder', async () => {
  const request = body => uploadRequest({ action: 'complete', assetId, ...body });
  const mock = service();
  const response = await mock.POST(request(), context());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).image, { src, assetId, name: 'fixture.jpg', size: jpeg.length });
  assert.ok(mock.calls[0].url.endsWith('/video_25/' + assetId + ':?$select=size,file'));
  assert.equal((await mock.POST(request({ size: jpeg.length + 1 }), context())).status, 409);
  assert.equal((await mock.POST(request({ assetId: '../video_26/a.jpg' }), context())).status, 400);
  assert.equal((await service({ userId: 8 }).POST(request(), context())).status, 404);
  assert.equal((await service({ upstreamStatus: 404 }).POST(request(), context())).status, 409);
  assert.equal((await service({ upstreamStatus: 503 }).POST(request(), context())).status, 502);
  assert.equal((await service({ storedBytes: Buffer.from('not JPEG') }).POST(request(), context())).status, 400);
});

test('the client sends only metadata to TubeLock and retries verification without sending a large file twice', async t => {
  const chunkSize = 10 * 1024 * 1024;
  const file = new File([jpeg, new Uint8Array(chunkSize)], 'large.jpg', { type: 'image/jpeg' });
  const actions = [];
  const chunks = [];
  globalThis.XMLHttpRequest = class {
    open(method, url) {
      assert.equal(method, 'PUT');
      assert.equal(url, 'https://fixture.invalid/session');
    }
    setRequestHeader(name, value) {
      assert.equal(name, 'Content-Range');
      this.range = value;
    }
    send(body) {
      chunks.push({ range: this.range, bytes: body.byteLength });
      this.status = chunks.length === 1 ? 202 : 201;
      this.responseText = '{}';
      this.onload();
    }
  };
  t.after(() => { delete globalThis.XMLHttpRequest; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/videos/25/description-images');
    assert.equal(options.headers['Content-Type'], 'application/json');
    const body = JSON.parse(options.body);
    actions.push(body.action);
    assert.equal(body.size, file.size);
    if (body.action === 'session') return Response.json({ assetId, uploadUrl: 'https://fixture.invalid/session' });
    assert.equal(body.assetId, assetId);
    if (actions.length === 2) return Response.json({ error: 'Retry verification' }, { status: 502 });
    return Response.json({ image: { src, assetId, size: file.size } });
  });
  await assert.rejects(uploadDescriptionImage(25, file), /Retry verification/);
  assert.equal((await uploadDescriptionImage(25, file)).src, src);
  assert.deepEqual(chunks, [
    { range: 'bytes 0-' + (chunkSize - 1) + '/' + file.size, bytes: chunkSize },
    { range: 'bytes ' + chunkSize + '-' + (file.size - 1) + '/' + file.size, bytes: jpeg.length },
  ]);
  assert.deepEqual(actions, ['session', 'complete', 'complete']);
});

test('image GET follows visibility, unpublished/staged and removed attachment rules; streams without redirects', async () => {
  const cases = [
    [{ userId: null }, 404], [{ userId: 8 }, 404], [{ userId: 7 }, 200], [{ userId: 1 }, 200],
    [{ userId: null, visibility: 'public' }, 200], [{ userId: 8, visibility: 'unlisted' }, 200],
    [{ userId: null, visibility: 'public', status: 'UPLOADING' }, 404],
    [{ userId: null, visibility: 'public', description: '' }, 404], [{ userId: 7, description: '' }, 200],
  ];
  for (const [options, expected] of cases) {
    const mock = service(options);
    const response = await mock.GET(new Request('https://fixture.invalid/image'), context({ assetId }));
    assert.equal(response.status, expected);
    assert.equal(mock.tokens(), expected === 200 ? 1 : 0);
    if (expected === 200) {
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('content-type'), 'image/jpeg');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
    }
  }
  const invalid = service();
  assert.equal((await invalid.GET(new Request('https://fixture.invalid/image'), context({ assetId: '../secret' }))).status, 400);
  assert.equal(invalid.tokens(), 0);
});

test('search scoring and snippets use rich text and exclude album metadata/URLs', async () => {
  const source = await fs.readFile(new URL('../src/app/results/ResultsClient.jsx', import.meta.url), 'utf8');
  const scoring = source.split('const searchResults = useMemo(() => {')[1].split('}, [videos, currentQuery, applyFilters, renderNow]);')[0];
  const search = compileFunction(scoring, ['videos', 'currentQuery', 'applyFilters', 'renderNow', 'parseDescriptionImages']);
  const video = { id: 25, title: 'Camera', description: serializeDescriptionDocument(fixtureDescription()) };
  const find = query => search([video], query, rows => rows, Date.now(), parseDescriptionImages);
  assert.equal(find('hello').length, 1);
  assert.equal(find('after album').length, 1);
  assert.equal(find('fixture.invalid').length, 0);
  assert.equal(find('sidebar').length, 0);
});

test('actual metadata PATCH saves and returns a reopenable description with an isolated database', async () => {
  const source = await fs.readFile(new URL('../src/app/api/videos/[id]/route.js', import.meta.url), 'utf8');
  let stored = '';
  const queries = [];
  const sql = async (strings, ...values) => {
    const query = strings.join('?');
    queries.push(query);
    if (/SELECT id, onedrive_folder_id/.test(query)) return [{ id: 25 }];
    if (/UPDATE videos v/.test(query)) {
      stored = values.find(value => typeof value === 'string' && value.startsWith(DESCRIPTION_PREFIX)) || stored;
      return [{ id: 25, description: stored }];
    }
    return [];
  };
  const deps = {
    decodeVideoSlug: () => 25, getDb: () => sql, getSessionUserId: async () => 7, isAdmin: () => false,
    accessError: status => Response.json({}, { status }), ensureSourceCacheColumns: async () => {},
    NextResponse: Response, validateSavedDescription, EVALUATED_RATING_STATUSES: [],
    normalizeVideoVisibility: () => null, invalidateVideoCaches: () => {},
    apiError: error => { throw error; },
    getGraphToken: () => { throw new Error('No external media calls allowed'); },
  };
  const PATCH = compileFunction(`return async function PATCH${source.split('export async function PATCH')[1]}`, Object.keys(deps))(...Object.values(deps));
  const description = serializeDescriptionDocument(fixtureDescription());
  const response = await PATCH(new Request('https://fixture.invalid/api/videos/25', { method: 'PATCH', body: JSON.stringify({ description }) }), context());
  assert.equal(response.status, 200);
  const reopened = parseDescriptionDocument((await response.json()).video.description);
  assert.deepEqual(reopened, parseDescriptionDocument(description));
  assert.equal(stored, description);
  assert.ok(queries.some(query => /UPDATE videos v/.test(query)));
  const invalid = await PATCH(new Request('https://fixture.invalid/api/videos/25', { method: 'PATCH', body: JSON.stringify({ description: '![local](blob:temporary)' }) }), context());
  assert.equal(invalid.status, 400);
  assert.equal(stored, description);
});

test('actual upload completion rejects temporary and cross-video images before database/media/workflow calls', async () => {
  const source = await fs.readFile(new URL('../src/app/api/upload/complete/route.js', import.meta.url), 'utf8');
  const deps = { NextResponse: Response, validateSavedDescription, getDb: () => { throw new Error('No database call allowed'); }, apiError: error => { throw error; } };
  const POST = compileFunction(`return async function POST${source.split('export async function POST')[1]}`, Object.keys(deps))(...Object.values(deps));
  for (const description of ['![local](blob:temporary)', serializeDescriptionDocument(fixtureDescription())]) {
    const response = await POST(new Request('https://fixture.invalid/api/upload/complete', { method: 'POST', body: JSON.stringify({ videoId: 26, description }) }));
    assert.equal(response.status, 400);
  }
});

test('rich timestamps retain marks across text runs and preserve explicit links/code', () => {
  const bold = [{ type: 'bold' }];
  const italic = [{ type: 'italic' }];
  const segments = splitDescriptionTimestamps([
    { text: 'Intro 00:', marks: bold }, { text: '10 then 00:30', marks: italic },
    { text: ' https://fixture.invalid/00:40', marks: [{ type: 'link', attrs: { href: 'https://fixture.invalid/00:40' } }] },
    { text: ' code 00:50', marks: [{ type: 'code' }] },
  ]);
  const timestamps = segments.filter(segment => segment.seconds !== undefined);
  assert.deepEqual(timestamps.map(segment => segment.seconds), [10, 30]);
  assert.deepEqual(timestamps[0].parts, [{ text: '00:', marks: bold }, { text: '10', marks: italic }]);
  assert.equal(segments.flatMap(segment => segment.parts).map(part => part.text).join(''), 'Intro 00:10 then 00:30 https://fixture.invalid/00:40 code 00:50');
});

test('proxy leaves image authentication to its handler without redirecting public images to login', async () => {
  const source = await fs.readFile(new URL('../src/proxy.js', import.meta.url), 'utf8');
  const body = source.replace(/^import .*;\r?\n/gm, '').replace('export async function proxy', 'async function proxy').replace('export const config', 'const config');
  const next = { next: () => Response.json({ next: true }), redirect: url => new Response(null, { status: 307, headers: { Location: url } }), json: Response.json };
  const proxy = compileFunction(body + '\nreturn proxy;', ['NextResponse', 'getServerSessionByToken', 'isPreviewImage'])(next, () => { throw new Error('Proxy must not query session for self-authenticating handlers'); }, () => false);
  for (const [path, method] of [[src, 'GET'], ['/api/videos/25/description-images', 'POST']]) {
    const url = new URL(`https://fixture.invalid${path}`);
    url.clone = () => new URL(url);
    const response = await proxy({ nextUrl: url, method, url: url.href, headers: new Headers(), cookies: { get: () => undefined } });
    assert.deepEqual(await response.json(), { next: true });
  }
});

test('video deletion/cancellation also cleans the description image folder with isolated services', async () => {
  const source = await fs.readFile(new URL('../src/app/api/videos/[id]/route.js', import.meta.url), 'utf8');
  const calls = [];
  let removed = false;
  const deps = {
    decodeVideoSlug: () => 25, getSessionUserId: async () => 7, isAdmin: () => false,
    getDb: () => async strings => {
      const query = strings.join('?');
      if (/DELETE FROM videos/.test(query)) removed = true;
      return /SELECT id, raw_file_name/.test(query) ? [{ id: 25 }] : [];
    },
    getVideoVersions: async () => [], getGraphToken: async () => 'fixture-token', getUserDriveId: async () => 'fixture-drive',
    descriptionImageFolder: id => `/description-images/video_${id}`,
    fetch: async (url, options) => { calls.push({ url, options }); return new Response(null, { status: 204 }); },
    invalidateVideoCaches: () => {}, NextResponse: Response, accessError: status => Response.json({}, { status }), apiError: error => { throw error; },
  };
  const DELETE = compileFunction(`return async function DELETE${source.split('export async function DELETE')[1].split('const DATA_IMAGE_RE')[0]}`, Object.keys(deps))(...Object.values(deps));
  assert.equal((await DELETE(new Request('https://fixture.invalid/api/videos/25', { method: 'DELETE' }), context())).status, 200);
  assert.ok(removed);
  assert.ok(calls.some(call => call.url.endsWith('/root:/description-images/video_25') && call.options.method === 'DELETE'));
});
