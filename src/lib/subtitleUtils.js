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
 * - Colon-ms MM:SS:mmm when no comma/dot is present and 3rd part has 3 digits or >= 60 (e.g. 01:01:200)
 */
export function parseSrtTimestampToMs(rawTs) {
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

  // Handle Gemini omitting comma before milliseconds (MM:SS:mmm -> e.g. 01:02:200)
  const threeColonMatch = s.match(/^(\d{1,3}):(\d{1,2}):(\d{1,3})$/);
  if (threeColonMatch) {
    const p1 = parseInt(threeColonMatch[1], 10);
    const p2 = parseInt(threeColonMatch[2], 10);
    const p3Raw = threeColonMatch[3];
    const p3 = parseInt(p3Raw, 10);
    if (p3Raw.length === 3 || p3 >= 60) {
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
export function parseSrtCues(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const normalized = normalizeSrtRawText(rawText);
  if (!normalized.trim()) return [];

  const matches = [];
  for (const m of normalized.matchAll(TS_PAIR_GLOBAL_RE)) {
    const startMs = parseSrtTimestampToMs(m[1]);
    const endMs = parseSrtTimestampToMs(m[2]);
    if (startMs !== null && endMs !== null) {
      matches.push({
        index: m.index,
        endIndex: m.index + m[0].length,
        startMs,
        endMs: Math.max(startMs + 200, endMs),
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
