import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchSpriteRating, resolveRatingModel } from '../src/lib/ratingWorkflow.js';
import { normalizeSubtitlePrompt } from '../src/lib/subtitleWorkflow.js';

const ratingDispatch = {
  videoId: 25,
  userId: 9,
  admin: false,
  rawFileName: 'fixture.mp4',
  userRating: 'all',
  autoApply: false,
  model: 'gemini-3.5-flash-lite',
};
const claimedStatus = { sprite_status: 'generating', rating_check_status: 'analyzing' };

function mockGitHub(t, status) {
  const originalToken = process.env.GITHUB_TOKEN;
  const originalBranch = process.env.GITHUB_BRANCH;
  process.env.GITHUB_TOKEN = 'fixture';
  process.env.GITHUB_BRANCH = 'test-branch';
  t.after(() => {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
    if (originalBranch === undefined) delete process.env.GITHUB_BRANCH;
    else process.env.GITHUB_BRANCH = originalBranch;
  });
  return t.mock.method(globalThis, 'fetch', async () => new Response(
    status === 204 ? null : 'internal upstream details',
    { status }
  ));
}

test('sprite dispatch skips GitHub if another request holds the claim', async (t) => {
  const github = mockGitHub(t, 204);
  const sql = t.mock.fn(async () => []);

  assert.equal(await dispatchSpriteRating(sql, ratingDispatch), null);
  assert.equal(github.mock.callCount(), 0);
  assert.equal(sql.mock.callCount(), 1);
});

test('sprite dispatch sends existing workflow inputs after a successful claim', async (t) => {
  const github = mockGitHub(t, 204);
  const sql = t.mock.fn(async () => [claimedStatus]);

  assert.deepEqual(await dispatchSpriteRating(sql, ratingDispatch), claimedStatus);
  const [url, request] = github.mock.calls[0].arguments;
  assert.ok(url.endsWith('/actions/workflows/sprite-content-rating.yml/dispatches'));
  assert.equal(request.method, 'POST');
  assert.deepEqual(JSON.parse(request.body), {
    ref: 'test-branch',
    inputs: {
      video_id: '25',
      raw_file_name: 'fixture.mp4',
      user_rating: 'all',
      auto_apply: 'false',
      model: 'gemini-3.5-flash-lite',
    },
  });
  assert.equal(sql.mock.callCount(), 1);
});

test('sprite dispatch failure rolls back only its own still-pending claim', async (t) => {
  mockGitHub(t, 502);
  const sql = t.mock.fn(async () => [claimedStatus]);

  await assert.rejects(dispatchSpriteRating(sql, ratingDispatch), (error) => {
    assert.equal(error.status, 502);
    assert.doesNotMatch(error.message, /internal upstream details/);
    return true;
  });

  const [[, , , claimId], [rollbackSql, videoId, rollbackClaimId]] =
    sql.mock.calls.map(({ arguments: call }) => call);
  assert.equal(sql.mock.callCount(), 2);
  assert.equal(videoId, ratingDispatch.videoId);
  assert.equal(rollbackClaimId, claimId);
  assert.match(rollbackSql.join('?'), /rating_dispatch_id = \? AND rating_check_status = 'analyzing'/);
});

test('workflow input validation limits model choices and the subtitle prompt', () => {
  assert.equal(resolveRatingModel('models/gemini-3.5-flesh-lite'), 'gemini-3.5-flash-lite');
  assert.equal(resolveRatingModel('fixture-disallowed-model'), null);
  assert.equal(resolveRatingModel({ model: 'gemini-3.5-flash-lite' }), null);
  assert.equal(normalizeSubtitlePrompt('  ' + 'a'.repeat(1200) + '  '), 'a'.repeat(1000));
  assert.equal(normalizeSubtitlePrompt({ prompt: 'fixture' }), '');
});
