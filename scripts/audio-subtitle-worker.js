/**
 * TubeLock GitHub Actions Worker #1:
 * Audio Extraction & Gemini AI Subtitle Generator
 *
 * Flow:
 * 1. Download video from OneDrive /raw/{RAW_FILE_NAME} (or fallback to /streams/stream_vid_{VIDEO_ID})
 * 2. Extract lightweight speech-optimized MP3 audio track via FFmpeg (-vn -ac 1 -ar 16000 -b:a 64k)
 * 3. Upload audio.mp3 to OneDrive /streams/stream_vid_{VIDEO_ID}/audio.mp3 & set audio_status = 'ready' in DB
 * 4. Upload audio to Google Gemini File API & generate accurate .SRT / .VTT subtitles
 * 5. Upload subtitles.srt & subtitles.vtt to OneDrive and save into Neon DB (subtitle_status = 'ready')
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { neon } from '@neondatabase/serverless';
import {
  SUBTITLE_TRANSCRIPTION_PROMPT,
  SUBTITLE_THAI_TRANSLATE_PROMPT,
} from '../src/lib/subtitlePrompts.js';
import {
  parseSrtCues,
  cuesToSrt,
  convertSrtToVtt,
  sanitizeCueText,
  alignChunkCuesToWindow,
  trimRunawayCueEndsBeforeSplit,
  normalizeSubtitleTimeline,
} from '../src/lib/subtitleUtils.js';
import {
  createWorkerLogger,
  downloadFileWithProgress,
  ensureWorkerLogsColumn,
  formatDurationShort,
  runFFmpegWithProgress,
} from './worker-utils.js';

const VIDEO_ID = process.env.VIDEO_ID || process.argv[2];
const RAW_FILE_NAME = process.env.RAW_FILE_NAME || process.argv[3] || '';
const AI_MODEL = (
  process.env.GEMINI_MODEL_NAME ||
  process.env.AI_MODEL ||
  'gemini-3.5-flash-lite'
).replace(/['"]/g, '').trim();
const CUSTOM_PROMPT = (process.env.CUSTOM_PROMPT || '').trim();

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const AZURE_TENANT_ID = (process.env.AZURE_TENANT_ID || '').replace(/['"]/g, '').trim();
const AZURE_CLIENT_ID = (process.env.AZURE_CLIENT_ID || '').replace(/['"]/g, '').trim();
const AZURE_CLIENT_SECRET = (process.env.AZURE_CLIENT_SECRET || '').replace(/['"]/g, '').trim();
let ONEDRIVE_USER_ID = (process.env.ONEDRIVE_USER_ID || '').replace(/['"]/g, '').trim();
ONEDRIVE_USER_ID = ONEDRIVE_USER_ID.replace('@donuttll40.', '@donutll40.');

const GEMINI_API_KEY = (
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_AI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  ''
).replace(/['"]/g, '').trim();

if (!VIDEO_ID) {
  console.error('❌ Missing required parameter: VIDEO_ID');
  process.exit(1);
}

if (!DATABASE_URL || !AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !ONEDRIVE_USER_ID) {
  console.error('❌ Missing required database or OneDrive environment secrets.');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function ensureAudioSubtitleColumns() {
  try {
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS audio_status VARCHAR(50) DEFAULT 'waiting';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_status VARCHAR(50) DEFAULT 'waiting';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_srt TEXT DEFAULT '';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_vtt TEXT DEFAULT '';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_tracks JSONB DEFAULT '[]'::jsonb;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_model VARCHAR(100) DEFAULT '';`;
    await ensureWorkerLogsColumn(sql);
  } catch (err) {
    console.warn('[Schema check warning]:', err.message);
  }
}

async function fetchWithRetry(url, options = {}, retries = 4, delay = 2500, timeoutMs = 120000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if ((res.status === 429 || res.status === 503 || res.status === 504) && i < retries - 1) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
        const waitMs = Math.max(delay, retryAfter * 1000);
        console.warn(`⏳ [HTTP ${res.status}] รอ ${(waitMs / 1000).toFixed(1)}s แล้วลองใหม่รอบ ${i + 2}/${retries}...`);
        await new Promise((r) => setTimeout(r, waitMs));
        delay *= 1.5;
        continue;
      }
      return res;
    } catch (err) {
      console.warn(`⚠️ [Request Error ${i + 1}/${retries}]: ${err.name || 'Error'} - ${err.message}`);
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 1.5;
    }
  }
}

let cachedToken = null;
let tokenExpiresAt = 0;

async function getGraphToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 120000) return cachedToken;

  const res = await fetchWithRetry(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: AZURE_CLIENT_ID,
      client_secret: AZURE_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to obtain Graph token (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function getUserDriveId() {
  const token = await getGraphToken();
  const res = await fetchWithRetry(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ONEDRIVE_USER_ID)}/drive`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Failed to get OneDrive Drive ID (${res.status})`);
  const data = await res.json();
  return data.id;
}

async function ensureStreamFolder(driveId, videoId) {
  const token = await getGraphToken();
  const folderPath = `streams/stream_vid_${videoId}`;
  const checkRes = await fetchWithRetry(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${folderPath}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (checkRes.ok) {
    const d = await checkRes.json();
    return d.id;
  }

  // Ensure /streams parent exists
  let streamsParentId = 'root';
  const parentRes = await fetchWithRetry(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/streams`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (parentRes.ok) {
    streamsParentId = (await parentRes.json()).id;
  } else {
    const createParent = await fetchWithRetry(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'streams', folder: {} }),
      }
    );
    if (createParent.ok) streamsParentId = (await createParent.json()).id;
  }

  const createFolder = await fetchWithRetry(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${streamsParentId}/children`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `stream_vid_${videoId}`,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'replace',
      }),
    }
  );
  if (!createFolder.ok) {
    throw new Error(`Failed to ensure stream folder (${createFolder.status})`);
  }
  return (await createFolder.json()).id;
}

async function uploadSmallOrChunkedFile(driveId, folderId, fileName, filePath, contentType = 'application/octet-stream') {
  const token = await getGraphToken();
  const fileBuffer = await fs.promises.readFile(filePath);
  const fileSize = fileBuffer.length;

  if (fileSize < 4 * 1024 * 1024) {
    const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/content`;
    const res = await fetchWithRetry(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Length': fileSize.toString(),
        'Content-Type': contentType,
      },
      body: fileBuffer,
    });
    if (!res.ok) throw new Error(`Failed to upload ${fileName} (${res.status})`);
    return await res.json();
  }

  const sessionUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/createUploadSession`;
  const sessionRes = await fetchWithRetry(sessionUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace', name: fileName } }),
  });
  if (!sessionRes.ok) throw new Error(`Failed to create upload session for ${fileName}`);
  const { uploadUrl } = await sessionRes.json();

  const CHUNK_SIZE = 10 * 1024 * 1024;
  let offset = 0;
  while (offset < fileSize) {
    const end = Math.min(offset + CHUNK_SIZE, fileSize);
    const chunk = fileBuffer.subarray(offset, end);
    const putRes = await fetchWithRetry(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': chunk.length.toString(),
        'Content-Range': `bytes ${offset}-${end - 1}/${fileSize}`,
      },
      body: chunk,
    });
    if (putRes.status === 200 || putRes.status === 201) return await putRes.json();
    if (putRes.status === 202) offset = end;
    else throw new Error(`Chunk upload failed for ${fileName} (${putRes.status})`);
  }
}

function probeMediaDuration(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d.toString();
    });
    proc.on('close', () => {
      const rawSec = parseFloat(out.trim() || '0') || 0;
      const sec = rawSec > 0 ? Math.round(rawSec * 1000) / 1000 : 0;
      resolve(sec);
    });
    proc.on('error', () => resolve(0));
  });
}

function cleanTranslatedCueText(text) {
  const withoutArrows = String(text || '')
    .replace(/\d{1,3}:\d{1,2}(?::\d{1,3})?(?:[,.]\d{1,3})?\s*-->\s*\d{1,3}:\d{1,2}(?::\d{1,3})?(?:[,.]\d{1,3})?/g, ' ');
  return sanitizeCueText(withoutArrows)
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function countScriptChars(text) {
  const plainText = String(text || '')
    .replace(/\d{1,3}:\d{2}(?::\d{2})?[,.]\d{1,3}\s*-->\s*\d{1,3}:\d{2}(?::\d{2})?[,.]\d{1,3}/g, ' ')
    .replace(/^\d+$/gm, ' ');
  const thaiCount = (plainText.match(/[\u0E00-\u0E7F]/g) || []).length;
  const cjkCount = (plainText.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g) || []).length;
  const kanaCount = (plainText.match(/[\u3040-\u30FF]/g) || []).length;
  const hangulCount = (plainText.match(/[\uAC00-\uD7AF\u1100-\u11FF]/g) || []).length;
  const latinCount = (plainText.match(/[A-Za-z]/g) || []).length;
  return {
    thaiCount,
    cjkCount,
    kanaCount,
    hangulCount,
    latinCount,
    foreignTotal: cjkCount + kanaCount + hangulCount + latinCount,
  };
}

function segmentWordsLocaleAware(text) {
  const clean = String(text || '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!clean) return [];
  const { thaiCount, cjkCount, kanaCount, hangulCount } = countScriptChars(clean);
  const locale = thaiCount > 0 ? 'th' : kanaCount > 0 ? 'ja' : cjkCount > 0 ? 'zh' : hangulCount > 0 ? 'ko' : 'en';
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
      return Array.from(segmenter.segment(clean), (s) => s.segment);
    }
  } catch (_) {}
  return clean.split(/(\s+|[?,，、;；。！？!?.])/).filter(Boolean);
}

function wrapSubtitleLines(text, maxLineChars = 34) {
  const clean = String(text || '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLineChars) return clean;
  const tokens = segmentWordsLocaleAware(clean);
  if (tokens.length <= 1) return clean;
  const midTarget = Math.ceil(clean.length / 2);
  let bestSplitIdx = 1;
  let bestDist = Infinity;
  let running = 0;
  for (let i = 0; i < tokens.length - 1; i++) {
    running += tokens[i].length;
    if (!tokens[i].trim()) continue;
    const dist = Math.abs(running - midTarget);
    if (dist < bestDist) {
      bestDist = dist;
      bestSplitIdx = i + 1;
    }
  }
  const line1 = tokens.slice(0, bestSplitIdx).join('').trim();
  const line2 = tokens.slice(bestSplitIdx).join('').trim();
  if (!line1 || !line2) return clean;
  return `${line1}\n${line2}`;
}

function splitOverlongSubtitleCues(cues, { maxDurationMs = 5200, maxChars = 60, idealChars = 44 } = {}) {
  const result = [];
  for (const cue of cues || []) {
    const clean = String(cue.text || '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!clean) continue;
    const dur = Math.max(200, (cue.endMs || 0) - (cue.startMs || 0));

    if (dur <= maxDurationMs && clean.length <= maxChars) {
      result.push({
        startMs: cue.startMs,
        endMs: cue.startMs + dur,
        text: wrapSubtitleLines(clean, 34),
      });
      continue;
    }

    const byLen = Math.ceil(clean.length / idealChars);
    const byDur = Math.ceil(dur / maxDurationMs);
    const minSliceMs = clean.length > 100 ? 450 : 800;
    const maxPossible = Math.max(1, Math.floor(dur / minSliceMs));
    const desiredCount = Math.min(Math.max(byLen, byDur, 2), maxPossible);

    if (desiredCount <= 1) {
      result.push({
        startMs: cue.startMs,
        endMs: cue.startMs + dur,
        text: wrapSubtitleLines(clean, 36),
      });
      continue;
    }

    const tokens = segmentWordsLocaleAware(clean);
    const targetPerGroup = Math.max(18, Math.ceil(clean.length / desiredCount));
    const minPauseBreak = Math.max(14, Math.floor(targetPerGroup * 0.45));
    const groups = [];
    let buf = '';

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!buf && !tok.trim()) continue;
      buf += tok;
      const trimmedLen = buf.trim().length;
      const endsWithStrongPunct = /[?？！!。\.…]\s*$/.test(buf);
      const endsWithComma = /[,，、;；]\s*$/.test(buf);
      const shouldFlush =
        trimmedLen >= targetPerGroup ||
        (endsWithStrongPunct && trimmedLen >= minPauseBreak) ||
        (endsWithComma && trimmedLen >= Math.floor(targetPerGroup * 0.72));

      if (shouldFlush && groups.length < maxPossible - 1) {
        const piece = buf.trim();
        if (piece) groups.push(piece);
        buf = '';
      }
    }
    if (buf.trim()) {
      const tail = buf.trim();
      if (groups.length > 0 && tail.length < 10 && groups[groups.length - 1].length + tail.length + 1 <= maxChars) {
        groups[groups.length - 1] = `${groups[groups.length - 1]} ${tail}`.replace(/\s{2,}/g, ' ').trim();
      } else {
        groups.push(tail);
      }
    }

    if (groups.length <= 1) {
      result.push({
        startMs: cue.startMs,
        endMs: cue.startMs + dur,
        text: wrapSubtitleLines(clean, 36),
      });
      continue;
    }

    const weights = groups.map((g) => Math.max(1, g.replace(/\s+/g, '').length));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let cursorMs = cue.startMs;

    for (let i = 0; i < groups.length; i++) {
      const isLast = i === groups.length - 1;
      const sliceDur = isLast
        ? Math.max(200, (cue.startMs + dur) - cursorMs)
        : Math.max(200, Math.round((dur * weights[i]) / totalWeight));
      const nextEndMs = isLast ? (cue.startMs + dur) : Math.min(cue.startMs + dur, cursorMs + sliceDur);
      result.push({
        startMs: cursorMs,
        endMs: Math.max(cursorMs + 200, nextEndMs),
        text: wrapSubtitleLines(groups[i], 34),
      });
      cursorMs = nextEndMs;
    }
  }
  return result;
}

function normalizeModelCandidates(rawModel) {
  const cleaned = String(rawModel || 'gemini-3.5-flash-lite')
    .replace(/^models\//i, '')
    .replace(/flesh/gi, 'flash')
    .trim();

  // Prioritize 500-RPD fast tier first; reserve 20-RPD stronger models (2.5-flash / 3-flash / 3.8-flash) strictly for fallback rescues
  const highQuotaTier = [
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
  ];
  const rescueTier = [
    'gemini-2.5-flash',
    'gemini-3-flash-preview',
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-flash-latest',
  ];
  const isLegacyOrDeprecated = !cleaned || cleaned === 'gemini-2.5-flash-lite' || cleaned.startsWith('gemini-2.0-');
  const candidates = isLegacyOrDeprecated
    ? [...highQuotaTier, ...rescueTier, cleaned]
    : [cleaned, ...highQuotaTier, ...rescueTier];

  return Array.from(new Set(candidates.filter(Boolean)));
}

async function discoverAvailableGeminiModels(excludeSet = new Set()) {
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const res = await fetch(listUrl);
    if (!res.ok) return [];
    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models : [];
    const supported = models
      .filter((m) => {
        const name = String(m.name || '').replace(/^models\//i, '');
        return (
          Array.isArray(m.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes('generateContent') &&
          name.includes('gemini') &&
          !name.includes('image') &&
          !name.includes('tts') &&
          !name.includes('live') &&
          !excludeSet.has(name)
        );
      })
      .map((m) => String(m.name).replace(/^models\//i, ''));

    const ordered = [
      ...supported.filter((n) => n.includes('flash-lite')),
      ...supported.filter((n) => n.includes('flash') && !n.includes('flash-lite')),
    ];
    return Array.from(new Set(ordered)).slice(0, 3);
  } catch (_) {
    return [];
  }
}

function parseJsonResponseSafe(rawText) {
  if (!rawText) return null;
  let cleaned = String(rawText).trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) {}
  return { rawFallbackText: cleaned };
}

const GEMINI_REQUEST_TIMEOUT_MS = 300000; // 5 minutes per chunk
const AUDIO_CHUNK_SECONDS = 300; // 5-minute chunks -> tighter timing, shorter cues, lower block risk (~24 req/hr << 500 RPD)

async function callGeminiWithFallback(requestBody, preferredModelName, logger = null, stepLabel = 'Gemini', { validateText = null } = {}) {
  const candidates = normalizeModelCandidates(preferredModelName);
  let lastErrorText = '';
  let lastStatus = 0;
  let lastEmptyReason = '';

  const inspectEmptyDiagnostic = (data) => {
    const cand = data?.candidates?.[0];
    const finishReason = cand?.finishReason || '';
    const blockReason = data?.promptFeedback?.blockReason || '';
    const highRatings = [
      ...(cand?.safetyRatings || []),
      ...(data?.promptFeedback?.safetyRatings || []),
    ]
      .filter((r) => r?.probability === 'HIGH' || r?.probability === 'MEDIUM')
      .map((r) => `${String(r.category || '').replace('HARM_CATEGORY_', '')}:${r.probability}`);
    const parts = [
      finishReason && `finishReason=${finishReason}`,
      blockReason && `blockReason=${blockReason}`,
      highRatings.length > 0 && `safety=[${highRatings.join(',')}]`,
    ].filter(Boolean);
    return {
      finishReason,
      blockReason,
      summary: parts.join(', ') || 'empty parts',
    };
  };

  const tryModelOnce = async (candidateModel) => {
    const startMs = Date.now();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const res = await fetchWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      },
      2,
      2000,
      GEMINI_REQUEST_TIMEOUT_MS
    );

    if (res.ok) {
      const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n')?.trim();
      if (!text) {
        const diag = inspectEmptyDiagnostic(data);
        lastEmptyReason = diag.summary;
        const msg = `⚠️ ${stepLabel}: โมเดล "${candidateModel}" ไม่ส่งข้อความกลับมา (${diag.summary}) — สลับไปลองโมเดลสำรอง...`;
        if (logger) await logger.log(msg, { level: 'warn', toDb: false });
        else console.warn(msg);
        return null;
      }
      if (validateText) {
        const invalidReason = validateText(text);
        if (invalidReason) {
          lastEmptyReason = invalidReason;
          const msg = `⚠️ ${stepLabel}: โมเดล "${candidateModel}" ส่งผลไม่ตรงเงื่อนไข (${invalidReason}) — สลับไปลองโมเดลสำรอง...`;
          if (logger) await logger.log(msg, { level: 'warn', toDb: false });
          else console.warn(msg);
          return null;
        }
      }
      if (logger) {
        await logger.log(`⚡ ${stepLabel}: โมเดล "${candidateModel}" ตอบกลับใน ${elapsedSec}s`, { toDb: false });
      }
      return { text, modelUsed: candidateModel, elapsedSec };
    }

    lastStatus = res.status;
    lastErrorText = await res.text();
    // Fall back across models on 404 (deprecated model), 429 (quota), or 5xx (503 high demand / transient backend error)
    if (res.status === 404 || res.status === 429 || res.status >= 500) {
      const msg = `⚠️ ${stepLabel}: โมเดล "${candidateModel}" ตอบกลับ HTTP ${res.status} — สลับไปลองโมเดลสำรอง...`;
      if (logger) await logger.log(msg, { level: 'warn', toDb: false });
      else console.warn(msg);
      return null;
    }
    throw new Error(`Gemini API Error (${res.status}): ${lastErrorText.slice(0, 400)}`);
  };

  for (const candidateModel of candidates) {
    const result = await tryModelOnce(candidateModel);
    if (result) return result;
  }

  const discoveredModels = await discoverAvailableGeminiModels(new Set(candidates));
  for (const discoveredModel of discoveredModels) {
    console.log(`🔄 Trying discovered available model from ListModels: ${discoveredModel}`);
    const result = await tryModelOnce(discoveredModel);
    if (result) return result;
  }

  if (lastEmptyReason && !lastStatus) {
    const err = new Error(`Gemini ไม่ส่งเนื้อหาคำบรรยายกลับมา (${lastEmptyReason})`);
    err.code = 'GEMINI_EMPTY';
    err.reason = lastEmptyReason;
    throw err;
  }
  if (lastEmptyReason && lastStatus) {
    const err = new Error(`ทุกโมเดลไม่สามารถสร้างคำบรรยายได้ (${lastEmptyReason}; HTTP ${lastStatus})`);
    err.code = 'GEMINI_EMPTY';
    err.reason = `${lastEmptyReason} / HTTP ${lastStatus}`;
    throw err;
  }

  throw new Error(`Gemini API Error (${lastStatus}): ${lastErrorText.slice(0, 400)}`);
}

const GEMINI_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
];

function reconcileDetectedLanguageFromSrt(srtText, meta) {
  let { isThai, detectedLangCode, detectedLangName } = meta;
  const { thaiCount, cjkCount, kanaCount, hangulCount, latinCount, foreignTotal } = countScriptChars(srtText);

  // Deterministic script guard: models sometimes label non-Thai SRT as is_thai=true due to Thai prompt context
  const clearlyForeign =
    (thaiCount === 0 && foreignTotal >= 2) ||
    (foreignTotal >= 8 && thaiCount <= Math.floor(foreignTotal * 0.2));

  if (clearlyForeign) {
    isThai = false;
    if (!detectedLangCode || detectedLangCode === 'th' || detectedLangCode === 'und') {
      if (kanaCount >= 2) {
        detectedLangCode = 'ja';
        detectedLangName = 'ญี่ปุ่น';
      } else if (hangulCount >= 2) {
        detectedLangCode = 'ko';
        detectedLangName = 'เกาหลี';
      } else if (cjkCount >= Math.max(2, latinCount)) {
        detectedLangCode = 'zh-Hans';
        detectedLangName = 'จีนกลาง';
      } else if (latinCount >= 4) {
        detectedLangCode = 'en';
        detectedLangName = 'อังกฤษ';
      }
    }
  } else if (!isThai && thaiCount >= 16 && foreignTotal <= Math.floor(thaiCount * 0.2)) {
    isThai = true;
    detectedLangCode = 'th';
    detectedLangName = 'ไทย';
  }

  return { isThai, detectedLangCode, detectedLangName };
}

async function transcribeOriginalAudioWithGemini(
  audioFilePath,
  videoTitle,
  modelName,
  customPrompt,
  { chunkInfo = '', chunkDurationSec = 0, logger = null, allowEmptySpeech = false } = {}
) {
  if (!GEMINI_API_KEY) {
    throw new Error('ไม่ได้ตั้งค่า GEMINI_API_KEY ในระบบ Environment / GitHub Secrets');
  }

  const audioBuffer = await fs.promises.readFile(audioFilePath);
  const base64Audio = audioBuffer.toString('base64');
  const payloadMB = (Buffer.byteLength(base64Audio) / 1048576).toFixed(2);
  if (logger) {
    await logger.log(`📦 ${chunkInfo || 'ไฟล์เสียง'} ขนาด MP3 ${(audioBuffer.length / 1048576).toFixed(2)} MB (Base64 ${payloadMB} MB)`, { toDb: false });
  }

  const chunkHint = chunkInfo
    ? `\nหมายเหตุสำคัญเรื่องเวลา (Timeline): ไฟล์เสียงนี้เป็นส่วน "${chunkInfo}"${chunkDurationSec > 0 ? ` (ความยาวไฟล์เสียงส่วนนี้ประมาณ ${formatDurationShort(chunkDurationSec)})` : ''} — ไทม์โค้ดทุกบรรทัดใน original_srt ต้องเริ่มนับตั้งแต่ 00:00:00,000 ตามเวลาจริงในไฟล์เสียงส่วนนี้เท่านั้น ห้ามบวกเวลาเริ่มต้นของช่วงเข้าไปเอง และห้ามใส่เวลาเกินความยาวไฟล์เสียงส่วนนี้ หากช่วงนี้มีแต่เสียงดนตรี/เงียบไม่มีคำพูด ให้คืนค่า "original_srt": "" ได้เลย และห้ามแปลเป็นภาษาไทยใน original_srt โดยเด็ดขาด`
    : '';

  const prompt = customPrompt
    ? `${SUBTITLE_TRANSCRIPTION_PROMPT}${chunkHint}\n\nข้อมูลบริบทชื่อวิดีโอ: "${videoTitle || ''}"\nคำสั่งเพิ่มเติมจากผู้ใช้งาน:\n${customPrompt}\n\nกรุณาถอดเสียงภาษาต้นฉบับจากไฟล์เสียงนี้เป็น JSON ตามโครงสร้างที่กำหนด:`
    : `${SUBTITLE_TRANSCRIPTION_PROMPT}${chunkHint}\n\nข้อมูลบริบทชื่อวิดีโอ: "${videoTitle || ''}"\nกรุณาถอดเสียงภาษาต้นฉบับจากไฟล์เสียงนี้เป็น JSON ตามโครงสร้างที่กำหนด:`;

  const requestBody = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'audio/mp3', data: base64Audio } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    safetySettings: GEMINI_SAFETY_SETTINGS,
  });

  const { text, elapsedSec } = await callGeminiWithFallback(
    requestBody,
    modelName,
    logger,
    chunkInfo ? `ถอดเสียง ${chunkInfo}` : 'ถอดเสียง'
  );
  const parsed = parseJsonResponseSafe(text);
  if (parsed?.rawFallbackText && parsed.rawFallbackText.includes('-->')) {
    const fixedMeta = reconcileDetectedLanguageFromSrt(parsed.rawFallbackText, {
      isThai: true,
      detectedLangCode: 'th',
      detectedLangName: 'ไทย',
    });
    return {
      ...fixedMeta,
      originalSrt: parsed.rawFallbackText,
      elapsedSec,
    };
  }

  const rawIsThai = Boolean(parsed?.is_thai);
  const rawCode = String(parsed?.detected_lang_code || (rawIsThai ? 'th' : 'und')).trim();
  const rawName = String(parsed?.detected_lang_name || (rawIsThai ? 'ไทย' : 'ภาษาต่างประเทศ')).trim();
  const originalSrt = String(parsed?.original_srt || parsed?.thai_srt || '').trim();

  if (!originalSrt && !allowEmptySpeech) {
    throw new Error('ไม่สามารถถอดเสียงภาษาต้นฉบับเป็นไฟล์ .SRT ได้');
  }

  const fixedMeta = reconcileDetectedLanguageFromSrt(originalSrt, {
    isThai: rawIsThai,
    detectedLangCode: rawCode,
    detectedLangName: rawName,
  });

  return { ...fixedMeta, originalSrt, elapsedSec };
}

function hasAcceptableThaiTranslation(textSample) {
  const sc = countScriptChars(textSample);
  const nonLatinForeign = sc.cjkCount + sc.kanaCount + sc.hangulCount;
  if ((sc.thaiCount === 0 && sc.foreignTotal >= 4) || (nonLatinForeign >= 10 && sc.thaiCount <= Math.floor(nonLatinForeign * 0.25))) {
    return 'ผลลัพธ์ยังคงเป็นภาษาต่างประเทศ (ยังไม่แปลเป็นไทย)';
  }
  return null;
}

async function translateCuesToThaiWithGemini(
  cuesBatch,
  detectedLangName,
  modelName,
  customPrompt,
  { chunkInfo = '', logger = null } = {}
) {
  const itemsPayload = cuesBatch.map((cue, idx) => ({
    id: idx + 1,
    text: String(cue.text || '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim(),
  }));

  const prompt = [
    SUBTITLE_THAI_TRANSLATE_PROMPT,
    `ภาษาต้นฉบับ: ${detectedLangName}`,
    customPrompt ? `คำสั่งเพิ่มเติมจากผู้ใช้งาน:\n${customPrompt}` : '',
    `รายการคำบรรยาย JSON จำนวน ${itemsPayload.length} ข้อ (แปลให้ครบทุก id แบบ 1-ต่อ-1):\n${JSON.stringify(itemsPayload)}`,
  ].filter(Boolean).join('\n\n');

  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    safetySettings: GEMINI_SAFETY_SETTINGS,
  });

  const validateThaiTranslation = (rawModelText) => {
    const parsedCheck = parseJsonResponseSafe(rawModelText);
    if (Array.isArray(parsedCheck?.translations)) {
      const items = parsedCheck.translations;
      if (items.length === 0) return 'รายการ translations ว่างเปล่า';
      if (itemsPayload.length >= 6 && items.length < Math.ceil(itemsPayload.length * 0.65)) {
        return `ได้คำแปลไม่ครบ (${items.length}/${itemsPayload.length} รายการ)`;
      }
      const joined = items.map((it) => String(it?.text ?? it?.thai ?? (Array.isArray(it) ? it[1] : '') ?? '')).join(' ');
      if (!joined.trim()) return 'ไม่มีข้อความคำแปลใน translations';
      return hasAcceptableThaiTranslation(joined);
    }

    const candidateSrt = String(
      parsedCheck?.thai_srt ||
        (parsedCheck?.rawFallbackText?.includes('-->') ? parsedCheck.rawFallbackText : '')
    ).trim();
    if (!candidateSrt) return 'ไม่มีเนื้อหา translations หรือ thai_srt';
    return hasAcceptableThaiTranslation(candidateSrt);
  };

  const { text, elapsedSec } = await callGeminiWithFallback(
    requestBody,
    modelName,
    logger,
    chunkInfo ? `แปลไทย ${chunkInfo}` : 'แปลไทย',
    { validateText: validateThaiTranslation }
  );

  const parsed = parseJsonResponseSafe(text);
  if (Array.isArray(parsed?.translations)) {
    const byId = new Map();
    for (const item of parsed.translations) {
      const idVal = Array.isArray(item) ? Number(item[0]) : Number(item?.id ?? item?.index);
      const rawStr = Array.isArray(item) ? item[1] : (item?.text ?? item?.thai ?? '');
      const cleanStr = cleanTranslatedCueText(rawStr);
      if (Number.isFinite(idVal) && idVal >= 1 && idVal <= itemsPayload.length && cleanStr) {
        byId.set(idVal, cleanStr);
      }
    }
    return {
      mode: 'indexed',
      byId,
      matchedCount: byId.size,
      elapsedSec,
    };
  }

  const fallbackSrt = String(
    parsed?.thai_srt ||
      (parsed?.rawFallbackText?.includes('-->') ? parsed.rawFallbackText : '')
  ).trim();
  if (!fallbackSrt) {
    throw new Error('ไม่สามารถแปลบทคำบรรยายจากภาษาต้นฉบับเป็นภาษาไทยได้');
  }
  return { mode: 'srt', thaiSrt: fallbackSrt, elapsedSec };
}

async function translateOriginalSrtToThaiWithGemini(
  originalSrt,
  detectedLangName,
  modelName,
  customPrompt,
  { chunkInfo = '', logger = null } = {}
) {
  const prompt = customPrompt
    ? `${SUBTITLE_THAI_TRANSLATE_PROMPT}\n\nภาษาต้นฉบับ: ${detectedLangName}\nคำสั่งเพิ่มเติมจากผู้ใช้งาน:\n${customPrompt}\n\nข้อความคำบรรยายภาษาต้นฉบับ:\n${originalSrt}`
    : `${SUBTITLE_THAI_TRANSLATE_PROMPT}\n\nภาษาต้นฉบับ: ${detectedLangName}\n\nข้อความคำบรรยายภาษาต้นฉบับ:\n${originalSrt}`;

  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    safetySettings: GEMINI_SAFETY_SETTINGS,
  });

  const { text, elapsedSec } = await callGeminiWithFallback(
    requestBody,
    modelName,
    logger,
    chunkInfo ? `แปลไทย ${chunkInfo}` : 'แปลไทย',
    {
      validateText: (rawModelText) => {
        const parsedCheck = parseJsonResponseSafe(rawModelText);
        if (Array.isArray(parsedCheck?.translations) && parsedCheck.translations.length > 0) {
          const joined = parsedCheck.translations.map((it) => String(it?.text ?? '')).join('\n');
          return hasAcceptableThaiTranslation(joined);
        }
        const s = String(parsedCheck?.thai_srt || parsedCheck?.rawFallbackText || '').trim();
        return s ? hasAcceptableThaiTranslation(s) : 'ไม่มีเนื้อหาคำแปล';
      },
    }
  );
  const parsed = parseJsonResponseSafe(text);
  if (Array.isArray(parsed?.translations) && parsed.translations.length > 0) {
    return {
      thaiSrt: parsed.translations.map((it) => cleanTranslatedCueText(it?.text ?? '')).filter(Boolean).join('\n'),
      elapsedSec,
    };
  }
  const thaiSrt = String(parsed?.thai_srt || parsed?.rawFallbackText || '').trim();
  if (!thaiSrt) {
    throw new Error('ไม่สามารถแปลบทคำบรรยายจากภาษาต้นฉบับเป็นภาษาไทยได้');
  }
  return { thaiSrt, elapsedSec };
}

async function sliceAudioToMp3Chunk(sourceAudioPath, startSec, lenSec, outPath, { stepLabel = '', logger = null, logIntervalMs = 10000 } = {}) {
  const isPcmWav = /\.wav$/i.test(String(sourceAudioPath || ''));
  // PCM WAV supports sample-exact input seeking; for compressed MP3 place -ss after -i to eliminate bitrate-estimate drift
  const ffArgs = isPcmWav
    ? [
        '-y',
        '-ss', String(startSec),
        '-t', String(lenSec),
        '-i', sourceAudioPath,
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'libmp3lame',
        '-b:a', '32k',
        outPath,
      ]
    : [
        '-y',
        '-i', sourceAudioPath,
        '-ss', String(startSec),
        '-t', String(lenSec),
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'libmp3lame',
        '-b:a', '32k',
        outPath,
      ];

  await runFFmpegWithProgress(ffArgs, {
    durationSec: lenSec,
    stepLabel,
    logger,
    logIntervalMs,
  });
  return outPath;
}

async function buildAudioChunks(localAudioPath, seekAudioPath, tempDir, audioDurationSec, logger) {
  if (!audioDurationSec || audioDurationSec <= AUDIO_CHUNK_SECONDS + 30) {
    return [
      {
        index: 1,
        total: 1,
        startSec: 0,
        endSec: audioDurationSec || 0,
        path: localAudioPath,
      },
    ];
  }

  const totalChunks = Math.ceil(audioDurationSec / AUDIO_CHUNK_SECONDS);
  await logger.log(
    `✂️ คลิปยาว ${formatDurationShort(audioDurationSec)} — แบ่งเสียงออกเป็น ${totalChunks} ช่วง (ช่วงละ ${Math.round(AUDIO_CHUNK_SECONDS / 60)} นาที) เพื่อไม่ให้ Gemini Timeout`,
    { toDb: true }
  );

  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    const startSec = i * AUDIO_CHUNK_SECONDS;
    const lenSec = Math.max(0, Number(Math.min(AUDIO_CHUNK_SECONDS, audioDurationSec - startSec).toFixed(3)));
    if (lenSec < 2 && i > 0) break;

    const chunkPath = path.join(tempDir, `chunk_${String(i + 1).padStart(3, '0')}.mp3`);
    await sliceAudioToMp3Chunk(seekAudioPath, startSec, lenSec, chunkPath, {
      stepLabel: `ตัดช่วงเสียง ${i + 1}/${totalChunks}`,
      logger,
      logIntervalMs: 6000,
    });

    chunks.push({
      index: i + 1,
      total: totalChunks,
      startSec,
      endSec: Number((startSec + lenSec).toFixed(3)),
      path: chunkPath,
    });
  }

  return chunks;
}

async function splitSubChunkAudio(seekAudioPath, tempDir, startSec, lenSec, labelSlug) {
  const outPath = path.join(tempDir, `sub_${labelSlug}.mp3`);
  return sliceAudioToMp3Chunk(seekAudioPath, startSec, lenSec, outPath, { logIntervalMs: 10000 });
}

async function generateSubtitlesWithGemini(
  localAudioPath,
  videoTitle,
  modelName,
  customPrompt,
  tempDir,
  audioDurationSec,
  logger,
  { seekAudioPath = localAudioPath } = {}
) {
  const chunks = await buildAudioChunks(localAudioPath, seekAudioPath, tempDir, audioDurationSec, logger);

  const chunkResults = [];
  const langTally = new Map();
  let lastChunkErrorMsg = '';

  const recordChunkOutput = (rangeLabel, chunkMeta, res1, chunkStartSec) => {
    const chunkLenSec = Math.max(
      1,
      Number(((chunkMeta?.endSec || 0) - (chunkMeta?.startSec || 0)) || audioDurationSec || AUDIO_CHUNK_SECONDS)
    );
    const parsedCues = parseSrtCues(res1.originalSrt, { maxExpectedSec: chunkLenSec });
    const shiftedCues = alignChunkCuesToWindow(parsedCues, chunkStartSec, chunkLenSec, audioDurationSec);
    const preTrimmedCues = trimRunawayCueEndsBeforeSplit(shiftedCues);
    // Split any overly long/essay cues upfront so BOTH original and Thai tracks are concise 1-5s subtitles
    const normalizedCues = normalizeSubtitleTimeline(
      splitOverlongSubtitleCues(preTrimmedCues, {
        maxDurationMs: 5200,
        maxChars: 60,
        idealChars: 44,
      }),
      {
        maxVideoDurationMs: audioDurationSec ? Math.round(audioDurationSec * 1000) + 1500 : Infinity,
      }
    );
    if (normalizedCues.length > 0) {
      const langKey = `${res1.isThai ? 'th' : 'orig'}:${res1.detectedLangCode}:${res1.detectedLangName}`;
      langTally.set(langKey, {
        count: (langTally.get(langKey)?.count || 0) + normalizedCues.length,
        isThai: res1.isThai,
        code: res1.detectedLangCode,
        name: res1.detectedLangName,
      });
    }
    chunkResults.push({
      chunk: chunkMeta,
      rangeLabel,
      cues: normalizedCues,
      rawSrt: res1.originalSrt,
      isThai: res1.isThai,
      code: res1.detectedLangCode,
      name: res1.detectedLangName,
    });
    return normalizedCues.length;
  };

  // Step 1: Transcribe every chunk in original spoken language + shift cue timestamps
  for (const ch of chunks) {
    const rangeLabel = ch.total > 1
      ? `ช่วง ${ch.index}/${ch.total} (${formatDurationShort(ch.startSec)}–${formatDurationShort(ch.endSec)})`
      : 'ทั้งคลิป';

    const effectivePrimaryModel = normalizeModelCandidates(modelName)[0];
    await logger.log(
      `🎙️ [ขั้นที่ 1/2] กำลังส่ง${rangeLabel} ให้ ${effectivePrimaryModel} ถอดเสียงภาษาต้นฉบับ...`,
      { toDb: true }
    );

    try {
      const res1 = await transcribeOriginalAudioWithGemini(ch.path, videoTitle, modelName, customPrompt, {
        chunkInfo: rangeLabel,
        chunkDurationSec: Math.max(0, (ch.endSec || 0) - (ch.startSec || 0)),
        logger,
        allowEmptySpeech: chunks.length > 1,
      });
      const count = recordChunkOutput(rangeLabel, ch, res1, ch.startSec);
      await logger.log(
        `✅ [ขั้นที่ 1/2] ${rangeLabel} ถอดเสียงเสร็จใน ${res1.elapsedSec}s: พบ ${count} ประโยค (${res1.detectedLangName})`,
        { level: 'success', toDb: true }
      );
    } catch (chunkErr) {
      lastChunkErrorMsg = chunkErr.message;
      const chunkLen = Math.max(0, (ch.endSec || 0) - (ch.startSec || 0));
      const canSubSplit = chunkLen >= 120;

      if (!canSubSplit) {
        if (chunks.length === 1) throw chunkErr;
        await logger.log(
          `⚠️ [ขั้นที่ 1/2] ข้าม ${rangeLabel}: ${chunkErr.message}`,
          { level: 'warn', toDb: true }
        );
        continue;
      }

      // Recursively bisect blocked/empty chunks down to ~60s slices so isolated content never drops minutes of dialogue
      const MIN_BISECT_SECONDS = 60;
      const MAX_BISECT_DEPTH = 3; // 4m -> 2m -> 1m
      const transcribeSubSlice = async (sliceStart, sliceLen, tag, depth) => {
        const subLabel = `ช่วง ${ch.index}${tag}/${ch.total} (${formatDurationShort(sliceStart)}–${formatDurationShort(sliceStart + sliceLen)})`;
        let subPath = '';
        try {
          subPath = await splitSubChunkAudio(seekAudioPath, tempDir, sliceStart, sliceLen, `${ch.index}_${tag}`);
          const subRes = await transcribeOriginalAudioWithGemini(subPath, videoTitle, modelName, customPrompt, {
            chunkInfo: subLabel,
            chunkDurationSec: sliceLen,
            logger,
            allowEmptySpeech: true,
          });
          const subCount = recordChunkOutput(subLabel, { ...ch, startSec: sliceStart, endSec: sliceStart + sliceLen }, subRes, sliceStart);
          await logger.log(
            `✅ [ขั้นที่ 1/2] ${subLabel} ถอดได้ ${subCount} ประโยค (${subRes.elapsedSec}s)`,
            { level: 'success', toDb: true }
          );
        } catch (subErr) {
          if (depth < MAX_BISECT_DEPTH && sliceLen >= MIN_BISECT_SECONDS * 2) {
            const subHalf = Math.floor(sliceLen / 2);
            await logger.log(
              `⚠️ [ขั้นที่ 1/2] ${subLabel} ไม่ได้คำบรรยาย (${subErr.reason || subErr.message}) — แบ่งย่อยต่อเป็นช่วงละ ~${subHalf} วิ...`,
              { level: 'warn', toDb: true }
            );
            await transcribeSubSlice(sliceStart, subHalf, `${tag}1`, depth + 1);
            await transcribeSubSlice(sliceStart + subHalf, sliceLen - subHalf, `${tag}2`, depth + 1);
            return;
          }
          lastChunkErrorMsg = subErr.message;
          await logger.log(
            `⚠️ [ขั้นที่ 1/2] ข้าม ${subLabel}: ${subErr.reason || subErr.message}`,
            { level: 'warn', toDb: true }
          );
        } finally {
          if (subPath) {
            try { fs.unlinkSync(subPath); } catch (_) {}
          }
        }
      };

      const halfLen = Math.floor(chunkLen / 2);
      await logger.log(
        `⚠️ [ขั้นที่ 1/2] ${rangeLabel} ไม่ได้คำบรรยาย (${chunkErr.reason || chunkErr.message}) — ลองแบ่งย่อยอัตโนมัติ (สูงสุดระดับ ${MIN_BISECT_SECONDS}s)...`,
        { level: 'warn', toDb: true }
      );
      await transcribeSubSlice(ch.startSec, halfLen, 'A', 1);
      await transcribeSubSlice(ch.startSec + halfLen, chunkLen - halfLen, 'B', 1);
    }
  }

  // Merge all original cues seamlessly in strict chronological, overlap-free order
  const maxVideoMs = audioDurationSec ? Math.round(audioDurationSec * 1000) + 1500 : Infinity;
  let allOriginalCues = normalizeSubtitleTimeline(
    chunkResults.flatMap((r) => r.cues),
    { maxVideoDurationMs: maxVideoMs }
  );
  if (allOriginalCues.length === 0) {
    const firstRaw = chunkResults.find((r) => r.rawSrt)?.rawSrt || '';
    if (!firstRaw) {
      throw new Error(lastChunkErrorMsg || 'AI ไม่พบเสียงพูดที่สามารถถอดเป็นคำบรรยาย .SRT ได้ในคลิปนี้');
    }
    const firstMeta = chunkResults[0];
    if (firstMeta.isThai) {
      return {
        isThai: true,
        detectedLangCode: 'th',
        detectedLangName: 'ไทย',
        originalSrt: firstRaw,
        thaiSrt: firstRaw,
        totalCues: 1,
      };
    }
    const tr = await translateOriginalSrtToThaiWithGemini(firstRaw, firstMeta.name, modelName, customPrompt, { logger });
    return {
      isThai: false,
      detectedLangCode: firstMeta.code,
      detectedLangName: firstMeta.name,
      originalSrt: firstRaw,
      thaiSrt: tr.thaiSrt,
      totalCues: 1,
    };
  }

  // Determine dominant language across all spoken chunks AND verify merged original SRT script before deciding Step 2
  const tallyEntries = [...langTally.values()].sort((a, b) => b.count - a.count);
  const nonThaiEntry = tallyEntries.find((e) => !e.isThai);
  const rawDominant = nonThaiEntry || tallyEntries[0] || { isThai: true, code: 'th', name: 'ไทย' };
  const mergedOriginalSrt = cuesToSrt(allOriginalCues);
  const reconciledDominant = reconcileDetectedLanguageFromSrt(mergedOriginalSrt, {
    isThai: rawDominant.isThai,
    detectedLangCode: rawDominant.code,
    detectedLangName: rawDominant.name,
  });
  const dominantLang = {
    isThai: reconciledDominant.isThai,
    code: reconciledDominant.detectedLangCode,
    name: reconciledDominant.detectedLangName,
  };

  if (dominantLang.isThai) {
    await logger.log(
      `🇹🇭 ตรวจพบเสียงพูดภาษาไทยล้วน (${allOriginalCues.length} ประโยค) -> จบที่ 1 ภาษา`,
      { level: 'success', toDb: true }
    );
    return {
      isThai: true,
      detectedLangCode: 'th',
      detectedLangName: 'ไทย',
      originalSrt: mergedOriginalSrt,
      thaiSrt: mergedOriginalSrt,
      totalCues: allOriginalCues.length,
    };
  }

  // Step 2: Non-Thai speech detected -> Translate each chunk cleanly to Thai while preserving exact timestamps
  await logger.log(
    `🌐 [ขั้นที่ 2/2] ตรวจพบภาษา "${dominantLang.name}" (${dominantLang.code}) — เริ่มแปลทั้ง ${allOriginalCues.length} ประโยคเป็นภาษาไทยอัตโนมัติ (ออก 2 ภาษา)...`,
    { toDb: true }
  );

  const TRANSLATE_BATCH_MAX_CUES = 65;

  const translateCueBatchWithSplit = async (cuesBatch, batchLabel, depth = 0) => {
    try {
      const tr = await translateCuesToThaiWithGemini(
        cuesBatch,
        dominantLang.name,
        modelName,
        customPrompt,
        { chunkInfo: batchLabel, logger }
      );

      if (tr.mode === 'indexed') {
        if (tr.matchedCount < Math.floor(cuesBatch.length * 0.8) && depth < 2 && cuesBatch.length >= 12) {
          throw new Error(`ได้คำแปลไม่ครบ (${tr.matchedCount}/${cuesBatch.length} รายการ)`);
        }
        return {
          cues: cuesBatch.map((orig, idx) => ({
            startMs: orig.startMs,
            endMs: orig.endMs,
            text: tr.byId.get(idx + 1) || orig.text,
          })),
          elapsedSec: tr.elapsedSec,
        };
      }

      const parsedThai = parseSrtCues(tr.thaiSrt);
      if (parsedThai.length === cuesBatch.length) {
        // Lock exact timestamps from Step 1 to guarantee 100% timing alignment across chunks
        return {
          cues: cuesBatch.map((orig, idx) => ({
            startMs: orig.startMs,
            endMs: orig.endMs,
            text: cleanTranslatedCueText(parsedThai[idx].text) || orig.text,
          })),
          elapsedSec: tr.elapsedSec,
        };
      }
      if (depth < 2 && cuesBatch.length >= 10) {
        throw new Error(`ได้คำแปลไม่ครบ (${parsedThai.length}/${cuesBatch.length} ช่วง)`);
      }
      if (parsedThai.length > 0) {
        return {
          cues: cuesBatch.map((orig, idx) => ({
            startMs: orig.startMs,
            endMs: orig.endMs,
            text: cleanTranslatedCueText(parsedThai[idx]?.text) || orig.text,
          })),
          elapsedSec: tr.elapsedSec,
        };
      }
      throw new Error('ไม่พบข้อความคำแปล');
    } catch (trErr) {
      if (depth < 2 && cuesBatch.length >= 12) {
        const mid = Math.floor(cuesBatch.length / 2);
        await logger.log(
          `⚠️ [ขั้นที่ 2/2] แปล ${batchLabel} ไม่สมบูรณ์ (${trErr.message}) — แบ่งครึ่งแปลทีละ ${mid} ประโยค...`,
          { level: 'warn', toDb: true }
        );
        const left = await translateCueBatchWithSplit(cuesBatch.slice(0, mid), `${batchLabel}-A`, depth + 1);
        const right = await translateCueBatchWithSplit(cuesBatch.slice(mid), `${batchLabel}-B`, depth + 1);
        const sumSec = (parseFloat(left.elapsedSec || 0) + parseFloat(right.elapsedSec || 0)).toFixed(1);
        return { cues: [...left.cues, ...right.cues], elapsedSec: sumSec };
      }
      await logger.log(
        `⚠️ [ขั้นที่ 2/2] แปล ${batchLabel} ไม่สำเร็จ (${trErr.message}) — คงข้อความต้นฉบับในช่วงนี้ไว้`,
        { level: 'warn', toDb: true }
      );
      return { cues: cuesBatch, elapsedSec: '0.0' };
    }
  };

  let allThaiCues = [];
  for (const r of chunkResults) {
    if (r.cues.length === 0) continue;

    // Only skip if genuinely Thai AND does not contain significant untranslated foreign text
    const chunkScript = countScriptChars(r.cues.map((c) => c.text).join(' '));
    const isTrulyThaiChunk = r.isThai && !(chunkScript.thaiCount === 0 && chunkScript.foreignTotal >= 2);
    if (isTrulyThaiChunk) {
      allThaiCues.push(...r.cues);
      continue;
    }

    await logger.log(`🌐 [ขั้นที่ 2/2] กำลังแปล ${r.rangeLabel} (${r.cues.length} ประโยค) -> ไทย...`, { toDb: true });
    let chunkElapsed = 0;
    let chunkTranslatedCount = 0;
    const totalBatches = Math.ceil(r.cues.length / TRANSLATE_BATCH_MAX_CUES);
    for (let offset = 0; offset < r.cues.length; offset += TRANSLATE_BATCH_MAX_CUES) {
      const subBatch = r.cues.slice(offset, offset + TRANSLATE_BATCH_MAX_CUES);
      const batchNo = Math.floor(offset / TRANSLATE_BATCH_MAX_CUES) + 1;
      const subLabel = totalBatches > 1 ? `${r.rangeLabel} (ชุด ${batchNo}/${totalBatches})` : r.rangeLabel;
      const translated = await translateCueBatchWithSplit(subBatch, subLabel);
      allThaiCues.push(...translated.cues);
      chunkTranslatedCount += translated.cues.length;
      chunkElapsed += parseFloat(translated.elapsedSec || 0);
    }
    await logger.log(`✅ [ขั้นที่ 2/2] แปล ${r.rangeLabel} เสร็จใน ${chunkElapsed.toFixed(1)}s (${chunkTranslatedCount} ประโยค)`, {
      level: 'success',
      toDb: true,
    });
  }

  // Final safety sweep: catch any individual straggler cues still left in foreign script without Thai
  const stragglerIndices = [];
  for (let i = 0; i < allThaiCues.length; i++) {
    const sc = countScriptChars(allThaiCues[i].text);
    const nonLatin = sc.cjkCount + sc.kanaCount + sc.hangulCount;
    if (sc.thaiCount === 0 && (nonLatin >= 2 || sc.latinCount >= 10)) {
      stragglerIndices.push(i);
    }
  }
  if (stragglerIndices.length > 0) {
    await logger.log(
      `🔍 [ขั้นที่ 2/2] พบคำบรรยายค้างภาษาต่างประเทศ ${stragglerIndices.length} ช่วง — กำลังแปลเก็บตกเป็นภาษาไทย...`,
      { level: 'warn', toDb: true }
    );
    const BATCH_LIMIT = 35;
    for (let start = 0; start < stragglerIndices.length; start += BATCH_LIMIT) {
      const idxSlice = stragglerIndices.slice(start, start + BATCH_LIMIT);
      const cueSlice = idxSlice.map((idx) => allThaiCues[idx]);
      const fixed = await translateCueBatchWithSplit(cueSlice, `เก็บตก-${Math.floor(start / BATCH_LIMIT) + 1}`, 1);
      if (fixed.cues.length === cueSlice.length) {
        idxSlice.forEach((origIdx, j) => {
          allThaiCues[origIdx] = {
            startMs: allThaiCues[origIdx].startMs,
            endMs: allThaiCues[origIdx].endMs,
            text: fixed.cues[j].text || allThaiCues[origIdx].text,
          };
        });
      }
    }
  }

  allThaiCues = normalizeSubtitleTimeline(
    splitOverlongSubtitleCues(trimRunawayCueEndsBeforeSplit(allThaiCues), {
      maxDurationMs: 5200,
      maxChars: 60,
      idealChars: 44,
    }),
    { maxVideoDurationMs: maxVideoMs }
  );
  const mergedThaiSrt = cuesToSrt(allThaiCues);
  return {
    isThai: false,
    detectedLangCode: dominantLang.code,
    detectedLangName: dominantLang.name,
    originalSrt: mergedOriginalSrt,
    thaiSrt: mergedThaiSrt || mergedOriginalSrt,
    totalCues: allThaiCues.length || allOriginalCues.length,
  };
}

async function main() {
  const vidNum = Number(VIDEO_ID);
  const tempDir = path.resolve('./temp_audio_sub', String(vidNum));
  fs.mkdirSync(tempDir, { recursive: true });
  const logger = createWorkerLogger(sql, vidNum, 'sub', 'เสียง & ซับไตเติล AI');

  try {
    const primaryModel = normalizeModelCandidates(AI_MODEL)[0];
    await logger.log(`🎬 เริ่มงานสกัดเสียงและสร้างซับไตเติลอัตโนมัติ (วิดีโอ #${vidNum}, โมเดล ${primaryModel})...`, { toDb: true });
    await ensureAudioSubtitleColumns();

    const rows = await sql`
      SELECT id, title, raw_file_name, onedrive_folder_id
      FROM videos
      WHERE id = ${vidNum}
      LIMIT 1;
    `;
    if (!rows || rows.length === 0) {
      throw new Error(`ไม่พบวิดีโอ ID #${vidNum} ในฐานข้อมูล`);
    }

    const video = rows[0];
    const activeRawName = RAW_FILE_NAME || video.raw_file_name;

    await sql`
      UPDATE videos
      SET audio_status = 'extracting',
          subtitle_status = 'processing',
          updated_at = NOW()
      WHERE id = ${vidNum};
    `;

    await logger.log('🔑 กำลังยืนยันตัวตนกับ Microsoft OneDrive...', { toDb: false });
    const token = await getGraphToken();
    const driveId = await getUserDriveId();
    const streamFolderId = await ensureStreamFolder(driveId, vidNum);

    // 1. Locate video source on OneDrive (/raw/{raw_file_name})
    let downloadUrl = null;
    let expectedSize = 0;
    if (activeRawName) {
      const rawUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(activeRawName)}?select=id,name,size,@microsoft.graph.downloadUrl`;
      const rawRes = await fetchWithRetry(rawUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (rawRes.ok) {
        const rawData = await rawRes.json();
        downloadUrl = rawData['@microsoft.graph.downloadUrl'];
        expectedSize = Number(rawData.size || 0);
      }
    }

    const localVideoPath = path.join(tempDir, 'input_video.mp4');
    const localAudioPath = path.join(tempDir, 'audio.mp3');
    const seekAudioPath = path.join(tempDir, 'audio_seek_src.wav');
    let audioDurationSec = 0;

    if (downloadUrl) {
      await downloadFileWithProgress(downloadUrl, localVideoPath, {
        label: activeRawName,
        expectedSizeBytes: expectedSize,
        logger,
      });
      audioDurationSec = await probeMediaDuration(localVideoPath);
      await logger.log(
        `🎵 กำลังสกัดเสียง MP3 Speech (16kHz Mono 32kbps${audioDurationSec > 0 ? ` • ความยาว ${formatDurationShort(audioDurationSec)}` : ''})...`,
        { toDb: true }
      );
      await runFFmpegWithProgress(
        [
          '-y', '-i', localVideoPath,
          '-vn', '-af', 'aresample=async=1:first_pts=0',
          '-ac', '1', '-ar', '16000',
          '-c:a', 'libmp3lame', '-b:a', '32k',
          localAudioPath,
        ],
        {
          durationSec: audioDurationSec,
          stepLabel: 'สกัดเสียง MP3',
          logger,
        }
      );
      // Extract PCM WAV for sample-exact chunk slicing with zero MP3 seek drift
      await runFFmpegWithProgress(
        [
          '-y', '-i', localVideoPath,
          '-vn', '-af', 'aresample=async=1:first_pts=0',
          '-ac', '1', '-ar', '16000',
          '-c:a', 'pcm_s16le',
          seekAudioPath,
        ],
        {
          durationSec: audioDurationSec,
          stepLabel: 'สร้างเสียงต้นทางสำหรับซิงก์ไทม์ไลน์',
          logger,
        }
      );
      try {
        if (fs.existsSync(localVideoPath)) fs.unlinkSync(localVideoPath);
      } catch (_) {}
    } else {
      // Fallback: check if audio.mp3 already exists in /streams/stream_vid_{id}/audio.mp3
      const existingAudioRes = await fetchWithRetry(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${streamFolderId}:/audio.mp3?select=id,size,@microsoft.graph.downloadUrl`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (existingAudioRes.ok) {
        const audioData = await existingAudioRes.json();
        const audioDl = audioData['@microsoft.graph.downloadUrl'];
        await downloadFileWithProgress(audioDl, localAudioPath, {
          label: 'audio.mp3 (คลาวด์เดิม)',
          expectedSizeBytes: Number(audioData.size || 0),
          logger,
        });
        await runFFmpegWithProgress(
          [
            '-y', '-i', localAudioPath,
            '-ac', '1', '-ar', '16000',
            '-c:a', 'pcm_s16le',
            seekAudioPath,
          ],
          { durationSec: 0, logIntervalMs: 15000 }
        );
      } else {
        throw new Error(`ไม่พบไฟล์วิดีโอต้นฉบับใน /raw/${activeRawName} หรือไฟล์เสียงในโฟลเดอร์สตรีม`);
      }
    }

    const activeSeekPath = fs.existsSync(seekAudioPath) ? seekAudioPath : localAudioPath;
    const probedSeekDur = await probeMediaDuration(activeSeekPath);
    if (probedSeekDur > 0) {
      audioDurationSec = probedSeekDur;
    } else if (!audioDurationSec) {
      audioDurationSec = await probeMediaDuration(localAudioPath);
    }

    // 2. Upload audio.mp3 to OneDrive & mark audio_status = 'ready' in DB
    const audioStat = await fs.promises.stat(localAudioPath);
    const audioMB = (audioStat.size / 1048576).toFixed(2);
    await logger.log(`⬆️ กำลังอัปโหลดไฟล์เสียง audio.mp3 (${audioMB} MB) ขึ้น OneDrive...`, { toDb: true });
    await uploadSmallOrChunkedFile(driveId, streamFolderId, 'audio.mp3', localAudioPath, 'audio/mpeg');

    await sql`
      UPDATE videos
      SET audio_status = 'ready',
          updated_at = NOW()
      WHERE id = ${vidNum};
    `;
    await logger.log(`✅ สกัดและบันทึกไฟล์เสียง audio.mp3 (${audioMB} MB) เรียบร้อยแล้ว`, { level: 'success', toDb: true });

    // 3. Generate AI Subtitles via Gemini (Chunked Language Detection & Dual-Track Subtitles)
    const subResult = await generateSubtitlesWithGemini(
      localAudioPath,
      video.title,
      AI_MODEL,
      CUSTOM_PROMPT,
      tempDir,
      audioDurationSec,
      logger,
      { seekAudioPath: activeSeekPath }
    );
    const { isThai, detectedLangCode, detectedLangName, thaiSrt, originalSrt, totalCues } = subResult;

    const thaiVtt = convertSrtToVtt(thaiSrt);
    const originalVtt = originalSrt ? convertSrtToVtt(originalSrt) : '';

    let tracks = [];
    if (!isThai && originalSrt) {
      tracks = [
        {
          id: 'original',
          label: `${detectedLangName} (ต้นฉบับ)`,
          lang: detectedLangCode,
          isAutoTranslate: false,
          isOriginal: true,
          srt: originalSrt,
          vtt: originalVtt,
        },
        {
          id: 'th',
          label: 'ไทย (แปลอัตโนมัติ)',
          lang: 'th',
          isAutoTranslate: true,
          isOriginal: false,
          srt: thaiSrt,
          vtt: thaiVtt,
        },
      ];
    } else {
      tracks = [
        {
          id: 'th',
          label: 'ไทย (สร้างอัตโนมัติ)',
          lang: 'th',
          isAutoTranslate: false,
          isOriginal: true,
          srt: thaiSrt,
          vtt: thaiVtt,
        },
      ];
    }

    // Prepare files to upload to OneDrive
    const srtPath = path.join(tempDir, 'subtitles.srt');
    const vttPath = path.join(tempDir, 'subtitles.vtt');
    fs.writeFileSync(srtPath, thaiSrt, 'utf8');
    fs.writeFileSync(vttPath, thaiVtt, 'utf8');

    const uploadPromises = [
      uploadSmallOrChunkedFile(driveId, streamFolderId, 'subtitles.srt', srtPath, 'text/plain; charset=utf-8'),
      uploadSmallOrChunkedFile(driveId, streamFolderId, 'subtitles.vtt', vttPath, 'text/vtt; charset=utf-8'),
    ];

    if (!isThai && originalSrt) {
      const origSrtPath = path.join(tempDir, 'subtitles_original.srt');
      const origVttPath = path.join(tempDir, 'subtitles_original.vtt');
      fs.writeFileSync(origSrtPath, originalSrt, 'utf8');
      fs.writeFileSync(origVttPath, originalVtt, 'utf8');

      uploadPromises.push(
        uploadSmallOrChunkedFile(driveId, streamFolderId, 'subtitles_original.srt', origSrtPath, 'text/plain; charset=utf-8'),
        uploadSmallOrChunkedFile(driveId, streamFolderId, 'subtitles_original.vtt', origVttPath, 'text/vtt; charset=utf-8')
      );
    }

    await logger.log(`⬆️ กำลังอัปโหลดไฟล์ซับไตเติล ${tracks.length} แทร็กขึ้น OneDrive...`, { toDb: true });
    await Promise.all(uploadPromises);

    await sql`
      UPDATE videos
      SET subtitle_status = 'ready',
          subtitle_srt = ${thaiSrt},
          subtitle_vtt = ${thaiVtt},
          subtitle_tracks = ${JSON.stringify(tracks)}::jsonb,
          subtitle_model = ${normalizeModelCandidates(AI_MODEL)[0]},
          source_cache = NULL,
          source_cache_expires_at = 0,
          updated_at = NOW()
      WHERE id = ${vidNum};
    `;

    await logger.log(
      `🎉 สร้างซับไตเติลสำเร็จ (${tracks.map((t) => t.label).join(' + ')} • รวม ${totalCues || '?'} ประโยค)`,
      { level: 'success', toDb: true }
    );
  } catch (err) {
    console.error('❌ [Audio & Subtitle Worker Error]:', err);
    await logger.log(`❌ ถอดเสียง/สร้างซับล้มเหลว: ${err.message}`, { level: 'error', toDb: true });
    try {
      await sql`
        UPDATE videos
        SET audio_status = CASE WHEN audio_status = 'ready' THEN 'ready' ELSE 'failed' END,
            subtitle_status = 'failed',
            updated_at = NOW()
        WHERE id = ${vidNum};
      `;
    } catch (_) {}
    process.exit(1);
  } finally {
    try {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

main();
