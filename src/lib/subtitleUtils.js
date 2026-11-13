/**
 * Fault-tolerant SRT / WebVTT timestamp & cue utilities shared across
 * TubeLock AI subtitle worker and web video player.
 */

const TS_ATOM_PATTERN = '\\d{1,3}:\\d{1,2}(?::\\d{1,3})?(?:[,.]\\d{1,3})?';
const TS_PAIR_GLOBAL_RE = new RegExp(`(${TS_ATOM_PATTERN})\\s*-->\\s*(${TS_ATOM_PATTERN})`, 'g');
const LEADING_STRAY_ARROW_RE = /^(?:-->\s*(?:\d{1,3}:\d{1,2}(?::\d{1,3})?(?:[,.]\d{1,3})?\s*)?)+/;
const VTT_SETTINGS_TAIL_RE = /^[ \t]+(?:(?:vertical|line|position|size|align|region):[^\s\n]+[ \t]*)+(?=\r?\n|$)/i;
const VTT_NOTE_TAIL_RE = /(?:\r?\n|^)[ \t]*NOTE\b[^\n]*(?:\r?\n(?![ \t]*\d+[ \t]*(?:\r?\n|$))[^\n]*)*/gi;

/**
 * Parse a timestamp string into milliseconds. Supports:
 * - Standard HH:MM:SS,mmm / H:M:S.ms (including 1-digit min/sec like 00:54:0,500 or 2-digit ms)
 * - Short MM:SS,mmm / M:S.ms (e.g. 01:03,200 or 53:3,140)
 * - Colon-ms MM:SS:mmm when no comma/dot is present and 3rd part has 3 digits or >= 60,
 *   or when interpreting as HH:MM:SS would exceed maxExpectedSec (e.g. 01:53:20 inside a 5-min chunk)
 */
export function parseSrtTimestampToMs(rawTs, { maxExpectedSec = null } = {}) {
  const s = String(rawTs || '').trim().replace('.', ',');
  if (!s) return null;

  const fullMatch = s.match(/^(\d{1,3}):(\d{1,2}):(\d{1,2}),(\d{1,3})$/);
  if (fullMatch) {
    const h = parseInt(fullMatch[1], 10);
    const m = parseInt(fullMatch[2], 10);
    const sec = parseInt(fullMatch[3], 10);
    const ms = parseInt(fullMatch[4].padEnd(3, '0').slice(0, 3), 10);
    return ((h * 3600 + m * 60 + sec) * 1000) + ms;
  }

  // Handle Gemini omitting comma before milliseconds (MM:SS:mmm -> e.g. 01:02:200 or 01:53:20)
  const threeColonMatch = s.match(/^(\d{1,3}):(\d{1,2}):(\d{1,3})$/);
  if (threeColonMatch) {
    const p1 = parseInt(threeColonMatch[1], 10);
    const p2 = parseInt(threeColonMatch[2], 10);
    const p3Raw = threeColonMatch[3];
    const p3 = parseInt(p3Raw, 10);
    const exceedsWindowAsHms =
      maxExpectedSec &&
      Number.isFinite(maxExpectedSec) &&
      p1 >= 1 &&
      (p1 * 3600 + p2 * 60 + p3) > (maxExpectedSec + 30) &&
      (p1 * 60 + p2) <= (maxExpectedSec + 30);
    if (p3Raw.length === 3 || p3 >= 60 || exceedsWindowAsHms) {
      const ms = parseInt(p3Raw.padEnd(3, '0').slice(0, 3), 10);
      return ((p1 * 60 + p2) * 1000) + ms;
    }
    return (p1 * 3600 + p2 * 60 + p3) * 1000;
  }

  const shortMatch = s.match(/^(\d{1,3}):(\d{1,2}),(\d{1,3})$/);
  if (shortMatch) {
    const m = parseInt(shortMatch[1], 10);
    const sec = parseInt(shortMatch[2], 10);
    const ms = parseInt(shortMatch[3].padEnd(3, '0').slice(0, 3), 10);
    return ((m * 60 + sec) * 1000) + ms;
  }

  return null;
}

export function formatMsToSrtTimestamp(totalMs) {
  const safe = Math.max(0, Math.round(totalMs));
  const hrs = Math.floor(safe / 3600000);
  const mins = Math.floor((safe % 3600000) / 60000);
  const secs = Math.floor((safe % 60000) / 1000);
  const ms = safe % 1000;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Heal line breaks that split mid-timestamp, mid-arrow, or around arrows before parsing.
 */
function normalizeSrtRawText(rawText) {
  return String(rawText || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^WEBVTT[^\n]*(?:\n|$)/i, '')
    .replace(/^STYLE\b[\s\S]*?(?=\n\n|$)/gim, '')
    // Heal broken arrow across lines ("--\n>", "-\n->")
    .replace(/--\s*\n+\s*>/g, '-->')
    .replace(/-\s*\n+\s*->/g, '-->')
    // Heal newlines right after ":" inside timestamp ("00:53:\n03,820" or "00:05:\n0,910")
    .replace(/(\d{1,3}:)\s*\n+\s*(\d{1,2}(?::\d{1,3})?(?:[,.]\d{1,3})?)(?=\s*(?:-->|\n|\s|$))/g, '$1$2')
    // Heal newlines right before ":" inside timestamp ("00\n:53:09,340")
    .replace(/(\d{1,2})\s*\n+\s*(:\d{1,2}(?::\d{1,3})?(?:[,.]\d{1,3})?)/g, '$1$2')
    // Heal newlines after decimal separator inside timestamp ("00:53:03,\n820")
    .replace(/(\d{1,3}:\d{1,2}(?::\d{1,2})?[,.])\s*\n+\s*(\d{1,3})(?=\s*(?:-->|\n|\s|$))/g, '$1$2')
    // Rejoin newlines immediately before or after "-->"
    .replace(new RegExp(`(${TS_ATOM_PATTERN})\\s*\\n+\\s*(-->)`, 'g'), '$1 $2')
    .replace(new RegExp(`(-->)\\s*\\n+\\s*(${TS_ATOM_PATTERN})`, 'g'), '$1 $2');
}

/**
 * Clean cue dialogue text, removing leftover arrow debris and normalizing blank lines.
 */
export function sanitizeCueText(text) {
  let cleaned = String(text || '')
    .replace(VTT_NOTE_TAIL_RE, '')
    .trim();

  // Strip stray leading arrow + timestamp if Gemini emitted double arrows (A --> B --> C)
  cleaned = cleaned.replace(LEADING_STRAY_ARROW_RE, '').trim();

  return cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Parse SRT or WebVTT text into normalized [{ startMs, endMs, text }] cues.
 * Handles multi-line blocks, single-newline blocks, inline space-separated cues,
 * 1-digit seconds, MM:SS:mmm colons, and broken mid-timestamp line wraps.
 */
export function parseSrtCues(rawText, options = {}) {
  if (!rawText || typeof rawText !== 'string') return [];
  const normalized = normalizeSrtRawText(rawText);
  if (!normalized.trim()) return [];

  const matches = [];
  for (const m of normalized.matchAll(TS_PAIR_GLOBAL_RE)) {
    const startMs = parseSrtTimestampToMs(m[1], options);
    const endMs = parseSrtTimestampToMs(m[2], options);
    if (startMs !== null && endMs !== null) {
      matches.push({
        index: m.index,
        endIndex: m.index + m[0].length,
        startMs,
        endMs: endMs > startMs ? Math.max(startMs + 200, endMs) : startMs + 1200,
      });
    }
  }
  if (matches.length === 0) return [];

  // Pass 1: Identify sequence numbers preceding each timing marker (both line-based and inline)
  const trailingSeqBefore = matches.map((m, i) => {
    const prevEnd = i === 0 ? 0 : matches[i - 1].endIndex;
    const between = normalized.slice(prevEnd, m.index);

    const lineSeqMatch = between.match(/(?:^|\n)[ \t]*(\d{1,6})\s*$/);
    if (lineSeqMatch) {
      return { kind: 'line', num: parseInt(lineSeqMatch[1], 10), stripLen: lineSeqMatch[0].length };
    }

    const inlineSeqMatch = between.match(/([ \t]+)(\d{1,6})\s*$/);
    if (inlineSeqMatch) {
      const prefixText = between.slice(0, between.length - inlineSeqMatch[0].length);
      return {
        kind: 'inline',
        num: parseInt(inlineSeqMatch[2], 10),
        stripLen: inlineSeqMatch[0].length,
        afterPunct: /[。．.!?？！)\]"'”」』…\u0E2F]\s*$/.test(prefixText),
      };
    }

    return null;
  });

  // Decide which inline numbers are real cue sequence numbers (using neighbor sequence continuity or punctuation)
  const shouldStripInline = trailingSeqBefore.map((info, i) => {
    if (!info || info.kind !== 'inline') return false;
    const prevInfo = i > 0 ? trailingSeqBefore[i - 1] : null;
    const nextInfo = i + 1 < trailingSeqBefore.length ? trailingSeqBefore[i + 1] : null;
    if (prevInfo && info.num === prevInfo.num + 1) return true;
    if (nextInfo && info.num + 1 === nextInfo.num) return true;
    if (info.afterPunct && info.num >= 1 && info.num <= 9999 && matches.length >= 2) return true;
    return false;
  });

  const cues = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = i + 1 < matches.length ? matches[i + 1] : null;
    const rawEnd = next ? next.index : normalized.length;
    let slice = normalized.slice(cur.endIndex, rawEnd);

    // Strip WebVTT cue positioning metadata right after end timestamp
    slice = slice.replace(VTT_SETTINGS_TAIL_RE, '');

    if (next) {
      const nextSeq = trailingSeqBefore[i + 1];
      if (nextSeq?.kind === 'line') {
        slice = slice.replace(/(?:^|\n)[ \t]*\d{1,6}\s*$/, '');
      } else if (nextSeq?.kind === 'inline' && shouldStripInline[i + 1]) {
        slice = slice.slice(0, Math.max(0, slice.length - nextSeq.stripLen));
      }
    }

    const text = sanitizeCueText(slice);
    if (text) {
      cues.push({
        startMs: cur.startMs,
        endMs: cur.endMs,
        text,
      });
    }
  }

  return cues;
}

export function cuesToSrt(cues) {
  if (!cues || cues.length === 0) return '';
  return (
    cues
      .map(
        (cue, idx) =>
          `${idx + 1}\n${formatMsToSrtTimestamp(cue.startMs)} --> ${formatMsToSrtTimestamp(cue.endMs)}\n${cue.text}`
      )
      .join('\n\n') + '\n'
  );
}

export function convertSrtToVtt(srtText) {
  if (!srtText) return 'WEBVTT\n\n';
  const cleaned = String(srtText)
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .trim();
  if (cleaned.startsWith('WEBVTT')) return cleaned;
  const vttBody = cleaned.replace(/(\d{1,3}:\d{2}(?::\d{2})?),(\d{1,3})/g, '$1.$2');
  return `WEBVTT\n\n${vttBody}\n`;
}

/**
 * Map a single audio chunk's parsed cues onto the full video timeline.
 * Automatically detects whether the model returned chunk-relative timestamps
 * or accidentally used video-absolute timestamps, and rejects out-of-window outliers.
 */
export function alignChunkCuesToWindow(cues, chunkStartSec, chunkLenSec, totalVideoDurationSec = 0) {
  if (!Array.isArray(cues) || cues.length === 0) return [];
  const chunkStartMs = Math.max(0, Math.round((Number(chunkStartSec) || 0) * 1000));
  const chunkLenMs = Math.max(1000, Math.round((Number(chunkLenSec) || 300) * 1000));
  const maxVideoMs =
    totalVideoDurationSec && Number(totalVideoDurationSec) > 0
      ? Math.round(Number(totalVideoDurationSec) * 1000) + 1500
      : Infinity;

  let alreadyAbsolute = false;
  if (chunkStartMs >= 90000 && cues.length >= 2) {
    let relCount = 0;
    let absCount = 0;
    for (const c of cues) {
      if (c.startMs >= 0 && c.startMs <= chunkLenMs + 20000) relCount++;
      if (c.startMs >= chunkStartMs - 20000 && c.startMs <= chunkStartMs + chunkLenMs + 25000) absCount++;
    }
    if (absCount >= Math.ceil(cues.length * 0.7) && relCount <= Math.floor(cues.length * 0.25)) {
      alreadyAbsolute = true;
    }
  }

  const aligned = [];
  for (const cue of cues) {
    const rawStart = Math.max(0, Number(cue?.startMs) || 0);
    const rawEnd = Math.max(rawStart + 200, Number(cue?.endMs) || rawStart + 1200);
    const dur = Math.max(200, rawEnd - rawStart);

    if (alreadyAbsolute) {
      if (rawStart < Math.max(0, chunkStartMs - 15000) || rawStart > chunkStartMs + chunkLenMs + 15000) {
        continue;
      }
      const absStart = Math.min(Math.max(Math.max(0, chunkStartMs - 2000), rawStart), maxVideoMs);
      const absEnd = Math.min(maxVideoMs, chunkStartMs + chunkLenMs + 4000, Math.max(absStart + 200, absStart + dur));
      if (absEnd > absStart) {
        aligned.push({ startMs: absStart, endMs: absEnd, text: cue.text });
      }
      continue;
    }

    // Reject rogue chunk timestamps far outside this audio slice
    if (rawStart > chunkLenMs + 30000) continue;
    const relStart = Math.max(0, Math.min(rawStart, Math.max(0, chunkLenMs - 200)));
    const absStart = chunkStartMs + relStart;
    if (absStart > maxVideoMs) continue;
    const absEnd = Math.min(maxVideoMs, chunkStartMs + chunkLenMs + 4000, absStart + dur);
    if (absEnd > absStart) {
      aligned.push({ startMs: absStart, endMs: absEnd, text: cue.text });
    }
  }

  return aligned;
}

/**
 * Clamp obvious typo end timestamps (e.g., 10 chars stretched over 4 minutes)
 * BEFORE running splitOverlongSubtitleCues so text weights do not smear across minutes.
 */
export function trimRunawayCueEndsBeforeSplit(cues) {
  if (!Array.isArray(cues) || cues.length === 0) return [];
  const sorted = [...cues]
    .filter((c) => c && typeof c.text === 'string' && c.text.trim())
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  return sorted.map((cue, idx) => {
    const cleanLen = cue.text.replace(/\s+/g, '').length;
    const maxByChars = Math.max(12000, cleanLen * 450 + 4000);
    let nextEnd = Math.max(cue.startMs + 200, cue.endMs || cue.startMs + 1200);
    const nextCue = sorted[idx + 1];
    if (nextCue && nextCue.startMs - cue.startMs >= 350 && nextEnd > nextCue.startMs) {
      nextEnd = Math.min(nextEnd, nextCue.startMs);
    }
    if (nextEnd - cue.startMs > maxByChars) {
      nextEnd = cue.startMs + maxByChars;
    }
    return {
      startMs: cue.startMs,
      endMs: Math.max(cue.startMs + 200, nextEnd),
      text: cue.text,
    };
  });
}

/**
 * Normalize final subtitle cues into a strictly monotonic, overlap-free timeline:
 * chronological sort, adjacent duplicate merge, runaway end-time capping,
 * and clean handoff between consecutive cues.
 */
export function normalizeSubtitleTimeline(
  cues,
  { maxVideoDurationMs = Infinity, capRunawayDuration = true } = {}
) {
  if (!Array.isArray(cues) || cues.length === 0) return [];
  const hasMaxDur = Number.isFinite(maxVideoDurationMs) && maxVideoDurationMs > 0;

  const prepared = [];
  for (const cue of cues) {
    const text = String(cue?.text || '').trim();
    const startMs = Math.round(Number(cue?.startMs));
    const rawEndMs = Math.round(Number(cue?.endMs));
    if (!text || !Number.isFinite(startMs) || startMs < 0) continue;
    if (hasMaxDur && startMs > maxVideoDurationMs) continue;

    let endMs = Number.isFinite(rawEndMs) && rawEndMs > startMs ? rawEndMs : startMs + 1200;
    if (hasMaxDur) endMs = Math.min(endMs, maxVideoDurationMs + 1000);
    if (endMs <= startMs) continue;

    if (capRunawayDuration) {
      const compactLen = text.replace(/\s+/g, '').length;
      const maxSingleMs = Math.max(6000, Math.min(14000, compactLen * 320 + 3000));
      if (endMs - startMs > maxSingleMs) {
        endMs = startMs + maxSingleMs;
      }
    }

    prepared.push({ startMs, endMs, text });
  }

  if (prepared.length === 0) return [];
  prepared.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  // Merge exact/near-duplicate adjacent cues emitted at boundaries or repeats
  const normalizeCmp = (s) => s.replace(/[\s.,!?。，！？…'"“”]+/g, '').toLowerCase();
  const deduped = [];
  for (const cue of prepared) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      cue.startMs - prev.startMs <= 1200 &&
      normalizeCmp(prev.text) &&
      normalizeCmp(prev.text) === normalizeCmp(cue.text)
    ) {
      prev.endMs = Math.max(prev.endMs, cue.endMs);
      continue;
    }
    deduped.push({ ...cue });
  }

  // Resolve overlapping cues so an earlier subtitle never stays stuck over newer dialogue
  for (let i = 0; i < deduped.length - 1; i++) {
    const cur = deduped[i];
    const next = deduped[i + 1];
    if (cur.endMs > next.startMs) {
      const startDelta = next.startMs - cur.startMs;
      if (startDelta >= 350) {
        cur.endMs = next.startMs;
      } else {
        const minSlotEnd = Math.min(cur.endMs, Math.max(cur.startMs + 250, next.startMs));
        cur.endMs = minSlotEnd;
        if (next.startMs < cur.endMs) {
          next.startMs = cur.endMs;
          next.endMs = Math.max(next.endMs, next.startMs + 400);
          if (hasMaxDur) next.endMs = Math.min(next.endMs, maxVideoDurationMs + 1000);
        }
      }
    }
  }

  return deduped.filter((c) => c.endMs > c.startMs && c.text);
}
