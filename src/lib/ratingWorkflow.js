import { randomUUID } from 'node:crypto';
import { EVALUATED_RATING_STATUSES } from './ratingStatus.js';
import { triggerGitHubWorkflow } from './subtitleWorkflow.js';

const RATING_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
]);

function normalizeModel(value) {
  return value.trim().replace(/^models\//i, '').replace(/flesh/gi, 'flash');
}

export function resolveRatingModel(value) {
  if (typeof value !== 'string') return null;
  const configured = normalizeModel((process.env.GEMINI_MODEL_NAME || '').replace(/['"]/g, '')) ||
    'gemini-3.5-flash-lite';
  const requested = normalizeModel(value);
  if (!requested) return configured;
  return requested === configured || RATING_MODELS.has(requested) ? requested : null;
}

export async function dispatchSpriteRating(sql, {
  videoId,
  userId,
  admin,
  rawFileName,
  userRating,
  autoApply,
  model,
  keepReadySprite = false,
}) {
  const dispatchId = randomUUID();
  const [claim] = await sql`
    UPDATE videos
    SET sprite_status = CASE WHEN ${keepReadySprite} AND sprite_status = 'ready' THEN 'ready' ELSE 'generating' END,
        rating_check_status = 'analyzing',
        user_selected_rating = ${userRating},
        rating_dispatch_id = ${dispatchId},
        rating_dispatched_at = NOW(),
        updated_at = NOW()
    WHERE id = ${videoId} AND (${admin} OR user_id = ${userId})
      AND NOT (COALESCE(rating_check_status, '') = ANY(${EVALUATED_RATING_STATUSES}::text[]))
      AND (
        (COALESCE(rating_check_status, '') <> 'analyzing' AND COALESCE(sprite_status, '') <> 'generating')
        OR COALESCE(rating_dispatched_at, updated_at, '-infinity'::timestamptz) <= NOW() - INTERVAL '75 minutes'
      )
    RETURNING sprite_status, rating_check_status;
  `;
  if (!claim) return null;

  try {
    await triggerGitHubWorkflow('sprite-content-rating.yml', {
      video_id: String(videoId),
      raw_file_name: String(rawFileName || ''),
      user_rating: String(userRating),
      auto_apply: autoApply ? 'true' : 'false',
      model,
    });
  } catch (error) {
    await sql`
      UPDATE videos
      SET sprite_status = CASE WHEN sprite_status = 'ready' THEN 'ready' ELSE 'failed' END,
          rating_check_status = 'failed',
          updated_at = NOW()
      WHERE id = ${videoId} AND rating_dispatch_id = ${dispatchId} AND rating_check_status = 'analyzing'
    `.catch((rollbackError) => console.error('[Sprite rating dispatch rollback]', rollbackError));
    throw error;
  }

  return claim;
}
