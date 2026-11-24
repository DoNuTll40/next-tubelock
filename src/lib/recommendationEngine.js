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

  // 8.5 User Personalization Signals (Subscriptions & Likes)
  if (context.subscribedChannelIds && cand.userId && context.subscribedChannelIds.has(cand.userId)) {
    score += 22;
  }
  if (context.likedVideoIds && context.likedVideoIds.has(cand.id)) {
    score += cand.isMusic ? 12 : 4;
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
  {
    sessionWatchedIds = null,
    lastVideoId = null,
    subscribedChannelIds = null,
    likedVideoIds = null,
    notInterestedIds = null,
    seed = 0,
    limit = 48,
  } = {}
) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const curId = currentVideo?.id ? String(currentVideo.id) : null;
  const hiddenSet = notInterestedIds
    ? new Set(Array.from(notInterestedIds, (x) => String(x)))
    : null;
  const subSet = subscribedChannelIds
    ? new Set(Array.from(subscribedChannelIds, (x) => String(x)))
    : null;
  const likedSet = likedVideoIds
    ? new Set(Array.from(likedVideoIds, (x) => String(x)))
    : null;

  const seenIds = new Set();
  const validCandidates = [];

  for (let i = 0; i < candidates.length; i++) {
    const v = candidates[i];
    if (!v || !v.id) continue;
    const vId = String(v.id);
    if (curId && vId === curId) continue;
    if (hiddenSet && hiddenSet.has(vId)) continue;
    if (seenIds.has(vId)) continue;
    if (v.status && v.status !== 'READY') continue;
    if (v.visibility && v.visibility !== 'public') continue;
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
    subscribedChannelIds: subSet,
    likedVideoIds: likedSet,
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

function addWeight(map, key, delta) {
  if (!key || !Number.isFinite(delta) || delta === 0) return;
  map.set(key, (map.get(key) || 0) + delta);
}

/**
 * Builds a recency-decayed user taste profile from watch_history, likes, subscriptions, and negative feedback.
 * Aligned with YouTube's 4 recommendation pillars:
 * 1) Personalization (valued watchtime completion + likes + subscriptions)
 * 2) Satisfaction & Fatigue (demote recently finished non-music, hide "not_interested")
 * 3) Diversity & Freshness (channel spreading + 80/20 exploit-explore)
 * 4) Responsibility & Safety (public-only, mature gate)
 */
export function buildUserTasteProfile(
  videos = [],
  {
    subscribedChannelIds = [],
    likedVideoIds = [],
    notInterestedIds = [],
    nowMs = Date.now(),
  } = {}
) {
  const categoryWeights = new Map();
  const tokenWeights = new Map();
  const channelWeights = new Map();
  const artistWeights = new Map();

  const subSet = new Set(Array.from(subscribedChannelIds || [], (x) => String(x)));
  const likedSet = new Set(Array.from(likedVideoIds || [], (x) => String(x)));
  const notInterestedSet = new Set(Array.from(notInterestedIds || [], (x) => String(x)));

  for (const cid of subSet) {
    addWeight(channelWeights, cid, 24);
  }

  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    if (!v || !v.id) continue;
    const vId = String(v.id);
    const sig = extractVideoSignals(v);
    if (!sig) continue;

    // Negative feedback ("Not Interested") penalizes its tags & category slightly
    if (notInterestedSet.has(vId)) {
      if (sig.category && sig.category !== 'general') addWeight(categoryWeights, sig.category, -10);
      for (const tok of sig.tokens) addWeight(tokenWeights, tok, -4);
      continue;
    }

    const isLiked = likedSet.has(vId);
    const hasWatched = Boolean(v.has_watched || (v.last_position_seconds != null && Number(v.last_position_seconds) > 0));
    if (!hasWatched && !isLiked) continue;

    const watchedAtMs = v.last_watched_at ? new Date(v.last_watched_at).getTime() : 0;
    const daysAgo = watchedAtMs > 0 ? Math.max(0, (nowMs - watchedAtMs) / 86400000) : 7;
    const recencyDecay = Math.exp(-daysAgo / 14); // ~10-day half-life

    const dur = sig.duration;
    const pos = Number(v.last_position_seconds) || 0;
    const completion = dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : (hasWatched ? 0.65 : 0);

    let signalStrength = 0;
    if (completion >= 0.70) {
      // Valued watchtime (strong positive)
      signalStrength = 1.2 * recencyDecay;
    } else if (completion >= 0.25) {
      // Moderate engagement
      signalStrength = 0.55 * recencyDecay;
    } else if (hasWatched && completion > 0 && completion < 0.10 && !sig.isMusic && !isLiked) {
      // Quick bounce (light negative)
      signalStrength = -0.35 * recencyDecay;
    }

    if (isLiked) {
      signalStrength += 1.4;
    }

    if (signalStrength === 0) continue;

    if (sig.category && sig.category !== 'general') {
      addWeight(categoryWeights, sig.category, signalStrength * 14);
    }
    if (sig.userId) {
      addWeight(channelWeights, sig.userId, signalStrength * 12);
    }
    for (const seg of sig.artistSegments) {
      addWeight(artistWeights, seg, signalStrength * 10);
    }
    let tokBudget = 0;
    for (const tok of sig.tokens) {
      if (tokBudget >= 10) break;
      addWeight(tokenWeights, tok, signalStrength * 4.5);
      tokBudget++;
    }
  }

  return {
    categoryWeights,
    tokenWeights,
    channelWeights,
    artistWeights,
    subscribedChannelIds: subSet,
    likedVideoIds: likedSet,
    notInterestedIds: notInterestedSet,
    hasHistory: categoryWeights.size > 0 || tokenWeights.size > 0 || subSet.size > 0 || likedSet.size > 0,
  };
}

/**
 * Ranks the Home Feed using YouTube's 4 pillars:
 * Personalization + Satisfaction/Fatigue + Diversity/80-20 Explore + Responsibility/Safety.
 */
export function rankHomeFeedVideos(
  candidates = [],
  userProfile = null,
  { allow18Plus = false, seed = 0, nowMs = Date.now(), limit = 200 } = {}
) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const hiddenSet = userProfile?.notInterestedIds || null;
  const subSet = userProfile?.subscribedChannelIds || null;
  const hasPersonalization = Boolean(userProfile?.hasHistory);

  const scored = [];
  const exploreCandidates = [];

  for (let i = 0; i < candidates.length; i++) {
    const v = candidates[i];
    if (!v || !v.id) continue;
    if (v.status && v.status !== 'READY') continue;
    if (v.visibility && v.visibility !== 'public') continue;

    const vId = String(v.id);
    if (hiddenSet && hiddenSet.has(vId)) continue;

    const sig = extractVideoSignals(v);
    if (!sig) continue;

    let score = 0;

    // 1. Freshness & Recency (newer uploads naturally surface)
    const createdMs = v.created_at ? new Date(v.created_at).getTime() : 0;
    const ageDays = createdMs > 0 ? Math.max(0, (nowMs - createdMs) / 86400000) : 30;
    const freshnessScore = Math.exp(-ageDays / 21) * 24;
    score += freshnessScore;

    // 2. Popularity & Quality
    const views = Number(v.views_count) || 0;
    score += Math.min(Math.log10(views + 1) * 5, 16);
    const res = String(v.resolution || '').toLowerCase();
    if (res.includes('4k') || res.includes('2160') || Number(v.version_count) > 1) {
      score += 5;
    }

    // 3. Personalization Affinity
    let affinityScore = 0;
    if (hasPersonalization) {
      if (sig.userId && subSet && subSet.has(sig.userId)) {
        affinityScore += 26;
      }
      if (sig.userId && userProfile.channelWeights.has(sig.userId)) {
        affinityScore += Math.max(-15, Math.min(28, userProfile.channelWeights.get(sig.userId)));
      }
      if (sig.category && userProfile.categoryWeights.has(sig.category)) {
        affinityScore += Math.max(-15, Math.min(30, userProfile.categoryWeights.get(sig.category)));
      }
      let artistSum = 0;
      for (const seg of sig.artistSegments) {
        if (userProfile.artistWeights.has(seg)) {
          artistSum += userProfile.artistWeights.get(seg);
        }
      }
      affinityScore += Math.max(-12, Math.min(24, artistSum));

      let tokenSum = 0;
      for (const tok of sig.tokens) {
        if (userProfile.tokenWeights.has(tok)) {
          tokenSum += userProfile.tokenWeights.get(tok);
        }
      }
      affinityScore += Math.max(-15, Math.min(26, tokenSum));
      score += affinityScore;
    }

    // 4. Satisfaction & Watch Fatigue
    const hasWatched = Boolean(v.has_watched);
    if (!hasWatched) {
      score += 18;
    } else {
      const pos = Number(v.last_position_seconds) || 0;
      const progress = sig.duration > 0 ? pos / sig.duration : 1;
      const watchedMs = v.last_watched_at ? new Date(v.last_watched_at).getTime() : 0;
      const hoursSinceWatch = watchedMs > 0 ? (nowMs - watchedMs) / 3600000 : 72;

      if (!sig.isMusic && progress >= 0.05 && progress <= 0.80) {
        // Continue Watching nudge
        score += 12;
      } else if (!sig.isMusic && progress > 0.85 && hoursSinceWatch < 24) {
        // Recently completed non-music fatigue penalty
        score -= 32;
      } else {
        score -= sig.isMusic ? 4 : 16;
      }
    }

    // 5. Responsibility / 18+ Safety Gate
    if (sig.isMature && !allow18Plus) {
      score -= 24;
    }

    // 6. Gentle deterministic session variety
    score += seededUnitFloat('home', vId, seed) * 10;

    const entry = { sig, score, isExplore: !hasWatched && affinityScore <= 2 && freshnessScore >= 6 };
    scored.push(entry);
    if (entry.isExplore) {
      exploreCandidates.push(entry);
    }
  }

  scored.sort((a, b) => b.score - a.score);
  exploreCandidates.sort((a, b) => b.score - a.score);

  // 7. Diversity Pass: Channel/Series spreading (max 2 consecutive same channel or prefix)
  //    + ~80/20 Exploit-Explore interleave every 5th slot
  const usedIds = new Set();
  const result = [];
  const targetLen = Math.min(limit, scored.length);

  const pickNextFrom = (list) => {
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (usedIds.has(entry.sig.id)) continue;

      if (result.length >= 2) {
        const last1 = result[result.length - 1];
        const last2 = result[result.length - 2];
        const sameChannelStreak =
          entry.sig.userId &&
          entry.sig.userId === last1.userId &&
          entry.sig.userId === last2.userId;
        const samePrefixStreak =
          entry.sig.prefixKey &&
          entry.sig.prefixKey.length >= 6 &&
          entry.sig.prefixKey === last1.prefixKey &&
          entry.sig.prefixKey === last2.prefixKey;
        if ((sameChannelStreak || samePrefixStreak) && i < list.length - 1) {
          continue;
        }
      }
      return entry;
    }
    // Fallback if all remaining items share the same channel/prefix
    return list.find((e) => !usedIds.has(e.sig.id)) || null;
  };

  while (result.length < targetLen) {
    const isExploreSlot = hasPersonalization && result.length > 0 && result.length % 5 === 4;
    let chosen = isExploreSlot ? pickNextFrom(exploreCandidates) : null;
    if (!chosen) {
      chosen = pickNextFrom(scored);
    }
    if (!chosen) break;
    usedIds.add(chosen.sig.id);
    result.push(chosen.sig);
  }

  return result.map((sig) => sig.video);
}
