import { isMatureVideo, isMusicVideo } from './videoUtils';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'official', 'video',
  'audio', 'music', 'mv', 'full', 'ver', 'version', 'clip', 'live', 'hd',
  '2k', '4k', '1080p', '2160p', '60fps', 'hls', 'mp4', 'ที่', 'และ', 'กับ',
  'ของ', 'ใน', 'จาก', 'เป็น', 'ได้', 'ไม่', 'มา', 'ดู', 'คลิป', 'วิดีโอ',
]);

const MUSIC_HINT_REGEX =
  /\b(cover|acoustic|remix|instrumental|karaoke|lyrics|ost|feat\.?|ft\.?|unplugged)\b|เนื้อเพลง|ร้องสด|อะคูสติก|คัฟเวอร์/i;

const signalCache = new Map();
const MAX_SIGNAL_CACHE_SIZE = 400;

function fnv1aHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededUnitFloat(currentId, candidateId, seed = 0) {
  let state = fnv1aHash(`${currentId}|${candidateId}|${seed}`) || 1;
  state = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function normalizeTagList(rawTags) {
  if (Array.isArray(rawTags)) {
    return rawTags.map((t) => String(t || '').trim()).filter(Boolean);
  }
  if (typeof rawTags === 'string') {
    return rawTags
      .split(/[,\s|]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function tokenizeText(text, outTokens, outBigrams) {
  if (!text) return;
  const cleaned = String(text)
    .toLowerCase()
    .replace(/[^\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFFa-z0-9\s]/g, ' ');

  const words = cleaned.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w || w.length < 2 || STOP_WORDS.has(w)) continue;
    outTokens.add(w);

    // Compact character bigrams for unspaced Thai / CJK compound word matching
    if (outBigrams && outBigrams.size < 32 && /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF]/.test(w)) {
      const maxLen = Math.min(w.length - 1, 16);
      for (let j = 0; j < maxLen && outBigrams.size < 32; j++) {
        outBigrams.add(w.slice(j, j + 2));
      }
    }
  }
}

function extractArtistSegments(rawTitle) {
  const segments = new Set();
  if (!rawTitle) return segments;

  const cleaned = String(rawTitle)
    .replace(/[\[\]()【】「」『』]/g, ' | ')
    .replace(/\b(?:cover\s+by|feat\.?|ft\.?|prod\.?\s+by|by)\b/gi, ' | ');

  const parts = cleaned.split(/\s*[-|—–•/:]\s*/);
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
      .toLowerCase()
      .replace(/[^\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFFa-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (seg.length >= 2 && seg.length <= 40 && !STOP_WORDS.has(seg)) {
      segments.add(seg);
      // Also store individual non-trivial words inside artist/series segments (> 2 chars)
      const subWords = seg.split(' ');
      if (subWords.length > 1) {
        for (let k = 0; k < subWords.length; k++) {
          const sw = subWords[k];
          if (sw.length >= 3 && !STOP_WORDS.has(sw)) {
            segments.add(sw);
          }
        }
      }
    }
  }

  return segments;
}

export function extractVideoSignals(video) {
  if (!video || !video.id) return null;

  const id = String(video.id);
  const rawTitle = String(video.title || '');
  const category = String(video.category || '').toLowerCase().trim();
  const tagsList = normalizeTagList(video.tags);
  const cacheKey = `${id}|${rawTitle}|${category}|${tagsList.join(',')}|${video.content_rating || ''}|${video.duration || 0}`;

  const cached = signalCache.get(cacheKey);
  if (cached) {
    return { ...cached, video };
  }

  const tokens = new Set();
  const bigrams = new Set();

  tokenizeText(rawTitle, tokens, bigrams);
  for (let i = 0; i < tagsList.length; i++) {
    tokenizeText(tagsList[i], tokens, bigrams);
  }
  if (category && category !== 'general' && category !== 'video') {
    tokenizeText(category, tokens, null);
  }

  const artistSegments = extractArtistSegments(rawTitle);
  const duration = Number(video.duration) || 0;
  const isMusic = Boolean(isMusicVideo(video) || MUSIC_HINT_REGEX.test(rawTitle));
  const isMature = Boolean(isMatureVideo(video));
  const isShort = category === 'shorts' || (duration > 0 && duration <= 75);

  const normalizedChars = rawTitle
    .toLowerCase()
    .replace(/[^\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFFa-z0-9]/g, '');
  const prefixKey = normalizedChars.slice(0, 12);

  const computed = {
    id,
    rawTitle,
    category,
    isMusic,
    isMature,
    isShort,
    duration,
    tokens,
    bigrams,
    artistSegments,
    prefixKey,
    authorName: String(video.author_name || '').toLowerCase().trim(),
    userId: video.user_id != null ? String(video.user_id) : '',
  };

  if (signalCache.size >= MAX_SIGNAL_CACHE_SIZE) {
    const firstKey = signalCache.keys().next().value;
    if (firstKey !== undefined) signalCache.delete(firstKey);
  }
  signalCache.set(cacheKey, computed);

  return { ...computed, video };
}

function scoreCandidate(cur, cand, context) {
  let score = 0;

  // 1. Content Rating / 18+ Boundary
  if (!cur.isMature && cand.isMature) {
    score -= 130;
  } else if (cur.isMature && cand.isMature) {
    score += 50;
  }

  // 2. Music & Category Affinity
  if (cur.isMusic && cand.isMusic) {
    score += 65;
  } else if (cur.isMusic !== cand.isMusic) {
    score -= 25;
  }

  if (cur.category && cand.category && cur.category === cand.category) {
    score += cur.category === 'general' ? 12 : 42;
  }

  if (cur.isShort === cand.isShort) {
    score += 15;
  } else {
    score -= 15;
  }

  // 3. Artist / Series Segment Match
  let artistMatched = false;
  if (cur.artistSegments.size > 0) {
    for (const seg of cur.artistSegments) {
      if (cand.artistSegments.has(seg) || (seg.length >= 3 && cand.tokens.has(seg))) {
        artistMatched = true;
        break;
      }
    }
  }
  if (artistMatched) {
    score += 45;
  }

  // 4. Keyword / Tag Overlap
  let tokenMatches = 0;
  if (cur.tokens.size > 0 && cand.tokens.size > 0) {
    for (const token of cur.tokens) {
      if (cand.tokens.has(token)) {
        tokenMatches++;
      }
    }
  }
  score += Math.min(tokenMatches * 18, 72);

  // 5. Thai / CJK Bigram Compound Overlap
  if (cur.bigrams.size > 0 && cand.bigrams.size > 0) {
    let sharedBigrams = 0;
    for (const bg of cur.bigrams) {
      if (cand.bigrams.has(bg)) {
        sharedBigrams++;
      }
    }
    if (sharedBigrams >= 2) {
      score += Math.min(sharedBigrams * 4, 20);
    }
  }

  // 6. Channel & Duration Closeness
  if (
    (cur.userId && cand.userId && cur.userId === cand.userId) ||
    (cur.authorName && cand.authorName && cur.authorName === cand.authorName)
  ) {
    score += 18;
  }

  if (cur.duration > 0 && cand.duration > 0) {
    const ratio = Math.min(cur.duration, cand.duration) / Math.max(cur.duration, cand.duration);
    score += ratio * 18;
  }

  // 7. Session Memory & Watch History (Anti-Repeat)
  if (context.lastVideoId && cand.id === context.lastVideoId) {
    score -= 160;
  } else if (context.sessionWatchedIds && context.sessionWatchedIds.has(cand.id)) {
    score -= 95;
  }

  const candVideo = cand.video;
  if (!candVideo.has_watched) {
    score += 26;
  } else {
    const pos = Number(candVideo.last_position_seconds) || 0;
    const progress = cand.duration > 0 ? pos / cand.duration : 1;
    if (!cand.isMusic && progress > 0.02 && progress < 0.85) {
      score += 14;
    } else {
      score -= cand.isMusic ? 6 : 22;
    }
  }

  // 8. Popularity & Quality Bonus
  const views = Number(candVideo.views_count) || 0;
  if (views > 0) {
    score += Math.min(Math.log10(views + 1) * 4, 12);
  }

  const res = String(candVideo.resolution || '').toLowerCase();
  const isHighRes = res.includes('4k') || res.includes('2160') || Number(candVideo.version_count) > 1;
  if (isHighRes) {
    score += 6;
  }

  // 9. Deterministic Seeded Variety
  score += seededUnitFloat(cur.id, cand.id, context.seed) * 20;

  return score;
}

/**
 * Multi-Signal YouTube-Grade Recommendation Ranker (< 0.3ms O(N log N))
 */
export function rankRelatedVideos(
  currentVideo,
  candidates = [],
  { sessionWatchedIds = null, lastVideoId = null, seed = 0, limit = 48 } = {}
) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const curId = currentVideo?.id ? String(currentVideo.id) : null;
  const seenIds = new Set();
  const validCandidates = [];

  for (let i = 0; i < candidates.length; i++) {
    const v = candidates[i];
    if (!v || !v.id) continue;
    const vId = String(v.id);
    if (curId && vId === curId) continue;
    if (seenIds.has(vId)) continue;
    if (v.status && v.status !== 'READY') continue;
    seenIds.add(vId);
    validCandidates.push(v);
  }

  if (validCandidates.length === 0) return [];

  const curSignals = extractVideoSignals(currentVideo);
  if (!curSignals) {
    return validCandidates.slice(0, limit);
  }

  let normalizedWatchedSet = null;
  if (sessionWatchedIds && typeof sessionWatchedIds[Symbol.iterator] === 'function') {
    normalizedWatchedSet = new Set();
    for (const wid of sessionWatchedIds) {
      if (wid != null) normalizedWatchedSet.add(String(wid));
    }
  }

  const context = {
    sessionWatchedIds: normalizedWatchedSet,
    lastVideoId: lastVideoId != null ? String(lastVideoId) : null,
    seed,
  };

  const scored = new Array(validCandidates.length);
  for (let i = 0; i < validCandidates.length; i++) {
    const sig = extractVideoSignals(validCandidates[i]);
    scored[i] = {
      sig,
      score: scoreCandidate(curSignals, sig, context),
    };
  }

  scored.sort((a, b) => b.score - a.score);

  // Top-slot diversity pass: prevent >= 3 consecutive items sharing identical title prefix
  const pool = scored;
  const result = [];
  const targetLen = Math.min(limit, pool.length);

  while (result.length < targetLen && pool.length > 0) {
    let pickIdx = 0;
    if (result.length >= 2) {
      const p1 = result[result.length - 1].prefixKey;
      const p2 = result[result.length - 2].prefixKey;
      if (p1 && p1.length >= 6 && p1 === p2) {
        const altIdx = pool.findIndex((entry) => entry.sig.prefixKey !== p1);
        if (altIdx !== -1 && altIdx <= 6) {
          pickIdx = altIdx;
        }
      }
    }
    const [chosen] = pool.splice(pickIdx, 1);
    result.push(chosen.sig);
  }

  return result.map((sig) => sig.video);
}
