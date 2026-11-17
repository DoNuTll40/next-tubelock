export const EVALUATED_RATING_STATUSES = [
  'AI_AUTO_SELECTED',
  'VERIFIED_MATCH',
  'VERIFIED_SAFE',
  'MISMATCH_UPGRADED',
  'MISMATCH_WARNING',
];

export function isRatingEvaluated(status) {
  return EVALUATED_RATING_STATUSES.includes(status);
}
