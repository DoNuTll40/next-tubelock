import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { compileFunction } from 'node:vm';
import test from 'node:test';

const source = await fs.readFile(new URL('../src/app/api/videos/route.js', import.meta.url), 'utf8');

// Run the actual handler body with every import replaced: no database or network is reachable.
function loadHandler({ userId = null, queryError = null } = {}) {
  const queries = [];
  let connections = 0;
  const sql = async (strings) => {
    const query = strings.join('?').trim();
    queries.push(query);
    assert.match(query, /^SELECT\b/, 'GET must only issue read queries');
    if (queryError) throw queryError;
    return [];
  };
  const dependencies = {
    apiError: () => Response.json({ success: false, data: [] }, { status: 500 }),
    protectVideoPoster: value => value,
    NextResponse: { json: (body, options) => Response.json(body, options) },
    cookies: async () => ({ get: () => undefined }),
    getDb: () => { connections++; return sql; },
    isAdmin: () => userId === 1,
    accessError: status => Response.json({ success: false }, { status }),
    getServerSessionByToken: async () => userId == null ? null : { user: { id: userId } },
    isMusicVideo: () => false,
    buildUserTasteProfile: () => ({}),
    rankHomeFeedVideos: rows => rows,
    POSTER_PREFERENCE: 'fixture',
  };
  const body = source.replace(/^import .*;\r?\n/gm, '').replace('export async function GET', 'async function GET');
  const GET = compileFunction(`${body}\nreturn GET;`, Object.keys(dependencies))(...Object.values(dependencies));
  return { GET, queries, connections: () => connections };
}

test('retired schema initialization rejects anonymous and admin requests before opening a database', async () => {
  for (const userId of [null, 1]) {
    const fixture = loadHandler({ userId });
    const response = await fixture.GET(new Request('https://fixture.invalid/api/videos?init=1'));
    assert.equal(response.status, 410);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(fixture.connections(), 0);
    assert.deepEqual(fixture.queries, []);
  }
});

test('public feed and owner/admin library remain read-only', async () => {
  for (const [userId, suffix] of [[null, ''], [2, ''], [2, '?mine=1'], [1, '?mine=1']]) {
    const fixture = loadHandler({ userId });
    const response = await fixture.GET(new Request(`https://fixture.invalid/api/videos${suffix}`));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: [] });
    assert.ok(fixture.queries.length > 0);
  }
});

test('schema errors return failure without attempting automatic repair or retry', async () => {
  const fixture = loadHandler({ queryError: new Error('relation videos does not exist') });
  const response = await fixture.GET(new Request('https://fixture.invalid/api/videos'));
  assert.equal(response.status, 500);
  assert.equal(fixture.queries.length, 1);
});

test('anonymous library requests still require authentication', async () => {
  const fixture = loadHandler();
  const response = await fixture.GET(new Request('https://fixture.invalid/api/videos?mine=1'));
  assert.equal(response.status, 401);
  assert.deepEqual(fixture.queries, []);
});
