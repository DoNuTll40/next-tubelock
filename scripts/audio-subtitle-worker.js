/**
 * TubeLock GitHub Actions Worker #1:
 * Audio Extraction & Gemini AI Subtitle Generator
 *
 * Flow:
 * 1. Reuse audio.mp3 or extract audio from the raw video or the lowest HLS rendition
 * 2. Extract lightweight speech-optimized MP3 audio track via FFmpeg (-vn -ac 1 -ar 16000 -b:a 64k)
 * 3. Upload audio.mp3 to OneDrive /streams/stream_vid_{VIDEO_ID}/audio.mp3 & set audio_status = 'ready' in DB
 * 4. Upload audio to Google Gemini File API & generate accurate .SRT / .VTT subtitles
 * 5. Upload subtitles.srt & subtitles.vtt to OneDrive and save into Neon DB (subtitle_status = 'ready')
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { neon } from '@neondatabase/serverless';
import { SUBTITLE_THAI_TRANSLATE_PROMPT } from '../src/lib/subtitlePrompts.js';
import { transcribeAudio, TRANSCRIBE_MODEL } from './gemini-transcribe.js';
import {
  cuesToSrt,
  convertSrtToVtt,
  sanitizeCueText,
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
const AI_MODEL = 'gemini-3.8-flash';
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

async function fetchWithRetry(url, options = {}, retries = 4, delay = 2500, timeoutMs = 120000, { retryOnTimeout = true, rateLimitDelayMs = 0 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if ((res.status === 429 || res.status === 503 || res.status === 504) && i < retries - 1) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
        const waitMs = Math.max(delay, retryAfter * 1000, res.status === 429 ? rateLimitDelayMs : 0);
        console.warn(`⏳ [HTTP ${res.status}] รอ ${(waitMs / 1000).toFixed(1)}s แล้วลองใหม่รอบ ${i + 2}/${retries}...`);
        await new Promise((r) => setTimeout(r, waitMs));
        delay *= 1.5;
        continue;
      }
      return res;
    } catch (err) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      console.warn(`⚠️ [Request Error ${i + 1}/${retries}]: ${err.name || 'Error'} - ${err.message}`);
      if (i === retries - 1 || (isTimeout && !retryOnTimeout)) throw err;
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

function probeMediaDuration(filePath, inputOptions = []) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      ...inputOptions,
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

const SPEAKER_LABELS = {
  M: '(ชาย)', F: '(หญิง)',
  M1: '(ชาย 1)', M2: '(ชาย 2)',
  F1: '(หญิง 1)', F2: '(หญิง 2)',
};
const SOURCE_SPEAKER_PREFIX = /^\s*\[(M[12]?|F[12]?)\]\s*/;
const TRANSLATED_SPEAKER_PREFIX = /^\s*(?:\[(?:M[12]?|F[12]?)\]|\((?:ชาย|หญิง)(?:\s*[12])?\))\s*/;

function applyOriginalSpeakerLabels(original, translation) {
  const sourceLines = original.split(/\r?\n/).filter((line) => line.trim());
  const labels = sourceLines.map((line) => line.match(SOURCE_SPEAKER_PREFIX)?.[1]);
  const translatedLines = translation.split(/\r?\n/).filter((line) => line.trim());
  const hasLabels = labels.some(Boolean);
  if (hasLabels && translatedLines.length !== sourceLines.length) return '';

  const cleaned = translatedLines.map((line, index) => {
    const text = cleanTranslatedCueText(line.replace(TRANSLATED_SPEAKER_PREFIX, ''));
    const label = SPEAKER_LABELS[labels[index]];
    return text && label ? `${label} ${text}` : text;
  });
  if (hasLabels && cleaned.some((line) => !line)) return '';
  return cleaned.filter(Boolean).join(hasLabels ? '\n' : ' ');
}

function countScriptChars(text) {
  const plainText = String(text || '')
    .split('\n').map((line) => line.replace(SOURCE_SPEAKER_PREFIX, '')).join('\n')
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

const GEMINI_REQUEST_TIMEOUT_MS = 95000; // 95s per model attempt so slow fallback thinking never stalls 5–10m silently
// Leave headroom under the project's 10,000 input tokens per minute.
const AUDIO_CHUNK_SECONDS = 240;
const TRANSCRIBE_REQUEST_INTERVAL_MS = 62000;

function buildRequestBodyForModel(rawBodyStr, modelName, allowThinkingTune = true) {
  if (!allowThinkingTune) return rawBodyStr;
  const lower = String(modelName || '').toLowerCase();
  const isThinkingCapable = (lower.startsWith('gemini-2.5-') || lower.startsWith('gemini-3')) && !lower.includes('lite');
  if (!isThinkingCapable) return rawBodyStr;

  try {
    const payload = JSON.parse(rawBodyStr);
    const genCfg = { ...(payload.generationConfig || {}) };
    if (!genCfg.thinkingConfig) {
      if (lower.startsWith('gemini-2.5-')) {
        genCfg.thinkingConfig = { thinkingBudget: lower.includes('pro') ? 128 : 0 };
      } else {
        genCfg.thinkingConfig = { thinkingLevel: 'minimal' };
      }
    }
    payload.generationConfig = genCfg;
    return JSON.stringify(payload);
  } catch (_) {
    return rawBodyStr;
  }
}

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

  const tryModelOnce = async (candidateModel, allowThinkingTune = true) => {
    const startMs = Date.now();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const tunedBody = buildRequestBodyForModel(requestBody, candidateModel, allowThinkingTune);

    // Emit periodic progress logs so UI/CI logs visibly report progress during long Gemini calls
    const heartbeatTimer = setInterval(() => {
      const waitSec = Math.round((Date.now() - startMs) / 1000);
      const hbMsg = `⏳ ${stepLabel}: กำลังรอผลจากโมเดล "${candidateModel}" (${waitSec}s)...`;
      if (logger) void logger.log(hbMsg, { toDb: true });
      else console.log(hbMsg);
    }, 18000);

    let res;
    try {
      res = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: tunedBody,
        },
        2,
        2000,
        GEMINI_REQUEST_TIMEOUT_MS,
        { retryOnTimeout: false }
      );
    } catch (reqErr) {
      clearInterval(heartbeatTimer);
      lastEmptyReason = reqErr?.name === 'TimeoutError' ? `หมดเวลา ${Math.round(GEMINI_REQUEST_TIMEOUT_MS / 1000)}s` : reqErr.message;
      const msg = `⚠️ ${stepLabel}: โมเดล "${candidateModel}" ขัดข้อง/หมดเวลา (${lastEmptyReason}) — สลับไปลองโมเดลสำรอง...`;
      if (logger) await logger.log(msg, { level: 'warn', toDb: true });
      else console.warn(msg);
      return null;
    } finally {
      clearInterval(heartbeatTimer);
    }

    if (res.ok) {
      const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n')?.trim();
      if (!text) {
        const diag = inspectEmptyDiagnostic(data);
        lastEmptyReason = diag.summary;
        const msg = `⚠️ ${stepLabel}: โมเดล "${candidateModel}" ไม่ส่งข้อความกลับมา (${diag.summary}) — สลับไปลองโมเดลสำรอง...`;
        if (logger) await logger.log(msg, { level: 'warn', toDb: true });
        else console.warn(msg);
        return null;
      }
      if (validateText) {
        const invalidReason = validateText(text);
        if (invalidReason) {
          lastEmptyReason = invalidReason;
          const msg = `⚠️ ${stepLabel}: โมเดล "${candidateModel}" ส่งผลไม่ตรงเงื่อนไข (${invalidReason}) — สลับไปลองโมเดลสำรอง...`;
          if (logger) await logger.log(msg, { level: 'warn', toDb: true });
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
    if (allowThinkingTune && res.status === 400 && /thinking/i.test(lastErrorText)) {
      return tryModelOnce(candidateModel, false);
    }
    // Fall back across models on 404 (deprecated model), 429 (quota), or 5xx (503 high demand / transient backend error)
    if (res.status === 404 || res.status === 429 || res.status >= 500) {
      const msg = `⚠️ ${stepLabel}: โมเดล "${candidateModel}" ตอบกลับ HTTP ${res.status} — สลับไปลองโมเดลสำรอง...`;
      if (logger) await logger.log(msg, { level: 'warn', toDb: true });
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
  { chunkInfo = '', logger = null, before = [], after = [] } = {}
) {
  const items = cuesBatch.map((cue, idx) => ({
    id: idx + 1,
    clip_start_seconds: cue.startMs / 1000,
    text: cue.text.trim(),
  }));
  const prompt = [
    SUBTITLE_THAI_TRANSLATE_PROMPT,
    'คงคำอุทาน คำลังเล คำพูดซ้ำ และการแก้คำกลางประโยคไว้ในคำแปลตามต้นฉบับ',
    `ภาษาต้นฉบับ: ${detectedLangName}`,
    customPrompt ? `คำสั่งเพิ่มเติมจากผู้ใช้งาน:\n${customPrompt}` : '',
    `บริบทก่อนและหลัง (อ่านประกอบ): ${JSON.stringify({ before, after })}`,
    `คิวที่ต้องแปล: ${JSON.stringify(items)}`,
  ].filter(Boolean).join('\n\n');

  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          translations: {
            type: 'ARRAY',
            minItems: items.length,
            maxItems: items.length,
            items: {
              type: 'OBJECT',
              properties: { id: { type: 'INTEGER' }, text: { type: 'STRING' } },
              required: ['id', 'text'],
            },
          },
        },
        required: ['translations'],
      },
    },
    safetySettings: GEMINI_SAFETY_SETTINGS,
  });

  const readTranslations = (text) => {
    const translations = parseJsonResponseSafe(text)?.translations;
    if (!Array.isArray(translations) || translations.length !== items.length) return null;
    const byId = new Map();
    for (const item of translations) {
      const id = item?.id;
      if (!Number.isInteger(id) || id < 1 || id > items.length || byId.has(id) || typeof item.text !== 'string') return null;
      const clean = applyOriginalSpeakerLabels(items[id - 1].text, item.text);
      if (!clean) return null;
      byId.set(id, clean);
    }
    return byId;
  };

  const { text } = await callGeminiWithFallback(
    requestBody, modelName, logger, chunkInfo ? `แปลไทย ${chunkInfo}` : 'แปลไทย',
    {
      validateText: (value) => {
        const byId = readTranslations(value);
        if (!byId) return 'คำแปลมี id ขาด ซ้ำ ข้อความว่าง หรือจำนวนบรรทัดไม่ตรงกับป้ายผู้พูด';
        const speech = [...byId.values()].flatMap((cue) => cue.split('\n'))
          .map((line) => line.replace(TRANSLATED_SPEAKER_PREFIX, '')).join(' ');
        return hasAcceptableThaiTranslation(speech);
      },
    }
  );
  const byId = readTranslations(text);
  return cuesBatch.map((cue, index) => ({ ...cue, text: byId.get(index + 1) }));
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
  if (!audioDurationSec || audioDurationSec <= AUDIO_CHUNK_SECONDS) {
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
    `✂️ คลิปยาว ${formatDurationShort(audioDurationSec)} — แบ่งเสียงออกเป็น ${totalChunks} ช่วง (ช่วงละไม่เกิน ${AUDIO_CHUNK_SECONDS / 60} นาที) เพื่อคุมโควตา Gemini`,
    { toDb: true }
  );

  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    const startSec = i * AUDIO_CHUNK_SECONDS;
    const lenSec = Math.max(0, Number(Math.min(AUDIO_CHUNK_SECONDS, audioDurationSec - startSec).toFixed(3)));
    if (lenSec <= 0) break;

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

async function detectSubtitleLanguage(audioPath, seekAudioPath, tempDir, duration, modelName, logger) {
  const parts = [];
  const sampleLength = 20;
  if (duration > sampleLength * 3) {
    for (const [index, fraction] of [0.15, 0.5, 0.85].entries()) {
      const samplePath = await splitSubChunkAudio(
        seekAudioPath, tempDir, Math.min(duration - sampleLength, duration * fraction),
        sampleLength, `language_${index}`
      );
      try {
        parts.push({ inlineData: { mimeType: 'audio/mp3', data: (await fs.promises.readFile(samplePath)).toString('base64') } });
      } finally {
        await fs.promises.rm(samplePath, { force: true });
      }
    }
  } else {
    parts.push({ inlineData: { mimeType: 'audio/mp3', data: (await fs.promises.readFile(audioPath)).toString('base64') } });
  }
  parts.push({ text: 'Listen to the speech in these audio samples. Identify the primary spoken language. Ignore music, names, and incidental words. Do not transcribe or translate. Return only a JSON object with the keys language_code (BCP 47) and language_name. Use "und" if speech cannot be identified.' });
  const readLanguage = (text) => {
    const result = parseJsonResponseSafe(text);
    const code = String(result?.language_code || '').trim();
    const name = String(result?.language_name || '').trim();
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(code) || /^und$/i.test(code) || !name) return null;
    return { code, name, isThai: /^th(?:-|$)/i.test(code) };
  };
  await logger.log('🔎 กำลังตรวจภาษาพูดจากตัวอย่างเสียงก่อนถอดซับ', { toDb: true });
  const { text } = await callGeminiWithFallback(JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    safetySettings: GEMINI_SAFETY_SETTINGS,
  }), modelName, logger, 'ตรวจภาษาพูด', {
    validateText: (value) => readLanguage(value) ? null : 'ระบุภาษาพูดจากตัวอย่างเสียงไม่ได้',
  });
  const language = readLanguage(text);
  await logger.log(`✅ ตรวจพบภาษาพูด ${language.name} (${language.code}) — ใช้ภาษานี้ในการถอดซับต้นฉบับ`, { toDb: true });
  return language;
}

async function generateSubtitlesWithGemini(
  localAudioPath,
  modelName,
  customPrompt,
  tempDir,
  audioDurationSec,
  logger,
  { seekAudioPath = localAudioPath } = {}
) {
  if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');
  if (!Number.isFinite(audioDurationSec) || audioDurationSec <= 0) throw new Error('Cannot determine audio duration');
  const chunks = await buildAudioChunks(localAudioPath, seekAudioPath, tempDir, audioDurationSec, logger);

  const allOriginalCues = [];
  let lastTranscribeFinishedAt = -Infinity;
  const transcriptionRequest = async (url, ...args) => {
    if (!url.endsWith('/v1beta/interactions')) return fetchWithRetry(url, ...args);
    const waitMs = TRANSCRIBE_REQUEST_INTERVAL_MS - (performance.now() - lastTranscribeFinishedAt);
    if (waitMs > 0) {
      await logger.log(`⏳ เว้น ${Math.ceil(waitMs / 1000)} วินาทีตามโควตาถอดเสียง`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    try {
      return await fetchWithRetry(url, ...args);
    } finally {
      lastTranscribeFinishedAt = performance.now();
    }
  };
  for (const chunk of chunks) {
    const range = `${chunk.index}/${chunk.total} (${formatDurationShort(chunk.startSec)}–${formatDurationShort(chunk.endSec)})`;
    await logger.log(`[1/2] ${TRANSCRIBE_MODEL} (verbatim): ${range}`, { toDb: true });
    try {
      const audio = await fs.promises.readFile(chunk.path);
      allOriginalCues.push(...await transcribeAudio(
        audio, Math.round(chunk.startSec * 1000), GEMINI_API_KEY, transcriptionRequest
      ));
    } catch (error) {
      throw new Error(`Transcription failed for audio chunk ${range}: ${error.message}`, { cause: error });
    }
  }

  if (!allOriginalCues.length) throw new Error('No speech was transcribed');
  const dominantLang = await detectSubtitleLanguage(
    localAudioPath, seekAudioPath, tempDir, audioDurationSec, modelName, logger
  );
  const mergedOriginalSrt = cuesToSrt(allOriginalCues);

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
    `🌐 [ขั้นที่ 2/2] ตรวจพบภาษา "${dominantLang.name}" (${dominantLang.code}) — เริ่มสร้างแทร็กภาษาไทยจากซับต้นฉบับ ${allOriginalCues.length} ประโยค...`,
    { toDb: true }
  );

  const TRANSLATE_BATCH_MAX_CUES = 65;
  const allThaiCues = [];
  const translateRange = async (start, end, batchLabel, depth = 0) => {
    const batch = allOriginalCues.slice(start, end);
    try {
      return await translateCuesToThaiWithGemini(batch, dominantLang.name, modelName, customPrompt, {
        chunkInfo: batchLabel,
        logger,
        before: allOriginalCues.slice(Math.max(0, start - 2), start).map(({ text }) => text),
        after: allOriginalCues.slice(end, end + 2).map(({ text }) => text),
      });
    } catch (error) {
      if (depth >= 2 || batch.length < 2) {
        throw new Error(`แปล ${batchLabel} ไม่สำเร็จ: ${error.message}`, { cause: error });
      }
      const middle = start + Math.floor(batch.length / 2);
      await logger.log(`⚠️ [ขั้นที่ 2/2] แปล ${batchLabel} ไม่ครบ — แบ่งครึ่งแล้วลองใหม่`, { level: 'warn', toDb: true });
      const left = await translateRange(start, middle, `${batchLabel}-A`, depth + 1);
      const right = await translateRange(middle, end, `${batchLabel}-B`, depth + 1);
      return [...left, ...right];
    }
  };

  const batchCount = Math.ceil(allOriginalCues.length / TRANSLATE_BATCH_MAX_CUES);
  for (let start = 0; start < allOriginalCues.length; start += TRANSLATE_BATCH_MAX_CUES) {
    const end = Math.min(start + TRANSLATE_BATCH_MAX_CUES, allOriginalCues.length);
    const label = `ชุด ${Math.floor(start / TRANSLATE_BATCH_MAX_CUES) + 1}/${batchCount} (คิว ${start + 1}–${end})`;
    await logger.log(`🌐 [ขั้นที่ 2/2] กำลังแปล ${label} → ไทย`, { toDb: true });
    allThaiCues.push(...await translateRange(start, end, label));
    await logger.log(`✅ [ขั้นที่ 2/2] แปล ${label} เสร็จแล้ว`, { level: 'success', toDb: true });
  }

  return {
    isThai: false,
    detectedLangCode: dominantLang.code,
    detectedLangName: dominantLang.name,
    originalSrt: mergedOriginalSrt,
    thaiSrt: cuesToSrt(allThaiCues),
    totalCues: allOriginalCues.length,
  };
}

async function getGraphFile(url) {
  const response = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${await getGraphToken()}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`OneDrive ตอบ HTTP ${response.status} ขณะอ่านไฟล์เสียงหรือวิดีโอ`);
  return response;
}

async function downloadHlsAudioSource(driveId, folderId, masterName, tempDir, logger) {
  const folderUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${encodeURIComponent(folderId)}`;
  const getFile = async (name) => {
    // TubeLock playlists reference files in the same OneDrive folder.
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(m3u8|ts|m4s|mp4|aac)$/i.test(name)) {
      throw new Error('พบชื่อไฟล์ HLS ที่ไม่รองรับ');
    }
    const response = await getGraphFile(`${folderUrl}:/${encodeURIComponent(name)}:/content`);
    if (!response) throw new Error(`ไม่พบไฟล์ HLS ${name} ใน OneDrive`);
    return response;
  };
  let playlist = await (await getFile(masterName)).text();
  const variants = [...playlist.matchAll(/^#EXT-X-STREAM-INF:([^\r\n]+)\r?\n([^#\r\n]+)/gm)]
    .map(([, attributes, uri]) => ({
      name: uri.trim(),
      bandwidth: Number(attributes.match(/(?:^|,)BANDWIDTH=(\d+)/)?.[1]) || Infinity,
    }))
    .sort((a, b) => a.bandwidth - b.bandwidth);
  const rendition = variants[0]?.name || masterName;
  if (variants.length) playlist = await (await getFile(rendition)).text();
  if (!/^#EXTM3U\s*$/m.test(playlist) || !/^#EXT-X-ENDLIST\s*$/m.test(playlist)) {
    throw new Error('HLS ยังไม่ครบทั้งคลิป กรุณารอให้แปลงเสร็จก่อนสร้างซับใหม่');
  }
  if (/^#EXT-X-KEY:/m.test(playlist)) throw new Error('ไม่รองรับการสกัดเสียงจาก HLS ที่เข้ารหัส');
  const files = new Set(playlist.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')));
  for (const [, name] of playlist.matchAll(/^#EXT-X-MAP:.*?URI="([^"]+)"/gm)) files.add(name);
  if (!files.size) throw new Error('ไม่พบ segment ใน HLS สำหรับสกัดเสียง');

  await logger.log(`🎵 ไม่พบ audio.mp3 และไฟล์ต้นฉบับ — กำลังอ่าน HLS ${rendition} (${files.size} ไฟล์) เพื่อสกัดเสียง`, { toDb: true });
  const hlsDir = path.join(tempDir, 'audio_hls');
  await fs.promises.mkdir(hlsDir);
  const names = [...files];
  for (let start = 0; start < names.length; start += 6) {
    const results = await Promise.allSettled(names.slice(start, start + 6).map(async (name) => {
      const response = await getFile(name);
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(path.join(hlsDir, name)));
    }));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    const downloaded = Math.min(start + 6, names.length);
    if (downloaded % 60 === 0 || downloaded === names.length) {
      await logger.log(`⬇️ ดาวน์โหลด HLS สำหรับซับ ${downloaded}/${names.length} ไฟล์`, { toDb: true });
    }
  }
  const localPlaylist = path.join(hlsDir, 'input.m3u8');
  await fs.promises.writeFile(localPlaylist, playlist);
  return localPlaylist;
}

async function main() {
  const vidNum = Number(VIDEO_ID);
  const tempDir = path.resolve('./temp_audio_sub', String(vidNum));
  fs.mkdirSync(tempDir, { recursive: true });
  const logger = createWorkerLogger(sql, vidNum, 'sub', 'เสียง & ซับไตเติล AI');

  try {
    const primaryModel = `${TRANSCRIBE_MODEL} / ${AI_MODEL}`;
    await logger.log(`🎬 เริ่มงานสกัดเสียงและสร้างซับไตเติลอัตโนมัติ (วิดีโอ #${vidNum}, โมเดล ${primaryModel})...`, { toDb: true });
    await ensureAudioSubtitleColumns();

    const rows = await sql`
      SELECT id, title, raw_file_name, onedrive_folder_id, master_playlist_path
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
    const driveId = await getUserDriveId();
    const streamFolderId = await ensureStreamFolder(driveId, vidNum);

    const localVideoPath = path.join(tempDir, 'input_video.mp4');
    const localAudioPath = path.join(tempDir, 'audio.mp3');
    const seekAudioPath = path.join(tempDir, 'audio_seek_src.wav');
    const existingAudio = await getGraphFile(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${streamFolderId}:/audio.mp3?select=size,@microsoft.graph.downloadUrl`
    );
    let audioSource = localAudioPath;
    let sourceOptions = [];
    if (existingAudio) {
      const audio = await existingAudio.json();
      await downloadFileWithProgress(audio['@microsoft.graph.downloadUrl'], localAudioPath, {
        label: 'audio.mp3 (คลาวด์เดิม)',
        expectedSizeBytes: Number(audio.size || 0),
        logger,
      });
    } else {
      const raw = activeRawName && await getGraphFile(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(activeRawName)}?select=size,@microsoft.graph.downloadUrl`
      );
      if (raw) {
        const videoFile = await raw.json();
        await downloadFileWithProgress(videoFile['@microsoft.graph.downloadUrl'], localVideoPath, {
          label: activeRawName,
          expectedSizeBytes: Number(videoFile.size || 0),
          logger,
        });
        audioSource = localVideoPath;
      } else {
        audioSource = await downloadHlsAudioSource(
          driveId, video.onedrive_folder_id || streamFolderId,
          path.posix.basename(video.master_playlist_path || 'master.m3u8'), tempDir, logger
        );
        sourceOptions = ['-protocol_whitelist', 'file'];
      }
    }
    const audioArgs = ['-map', '0:a:0', '-af', 'aresample=async=1:first_pts=0', '-ac', '1', '-ar', '16000'];
    await runFFmpegWithProgress(
      [
        '-y', ...sourceOptions, '-i', audioSource,
        ...audioArgs, '-c:a', 'pcm_s16le', seekAudioPath,
        ...(!existingAudio ? [...audioArgs, '-c:a', 'libmp3lame', '-b:a', '32k', localAudioPath] : []),
      ],
      { durationSec: await probeMediaDuration(audioSource, sourceOptions), stepLabel: 'เตรียมเสียงสำหรับถอดซับ', logger }
    );
    if (audioSource === localVideoPath) await fs.promises.rm(localVideoPath, { force: true });
    if (sourceOptions.length) await fs.promises.rm(path.dirname(audioSource), { recursive: true, force: true });
    const audioDurationSec = await probeMediaDuration(seekAudioPath) || await probeMediaDuration(localAudioPath);
    const audioStat = await fs.promises.stat(localAudioPath);
    const audioMB = (audioStat.size / 1048576).toFixed(2);
    if (!existingAudio) {
      await logger.log(`⬆️ กำลังบันทึก audio.mp3 (${audioMB} MB) ลง OneDrive ก่อนถอดซับ...`, { toDb: true });
      await uploadSmallOrChunkedFile(driveId, streamFolderId, 'audio.mp3', localAudioPath, 'audio/mpeg');
    }

    await sql`
      UPDATE videos
      SET audio_status = 'ready',
          updated_at = NOW()
      WHERE id = ${vidNum};
    `;
    await logger.log(`✅ audio.mp3 (${audioMB} MB) พร้อมถอดซับ`, { level: 'success', toDb: true });

    // 3. Generate AI Subtitles via Gemini (Chunked Language Detection & Dual-Track Subtitles)
    const subResult = await generateSubtitlesWithGemini(
      localAudioPath,
      AI_MODEL,
      CUSTOM_PROMPT,
      tempDir,
      audioDurationSec,
      logger,
      { seekAudioPath }
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
          subtitle_model = ${TRANSCRIBE_MODEL},
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
