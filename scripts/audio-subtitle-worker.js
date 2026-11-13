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
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { neon } from '@neondatabase/serverless';
import {
  SUBTITLE_TRANSCRIPTION_PROMPT,
  SUBTITLE_THAI_TRANSLATE_PROMPT,
} from '../src/lib/subtitlePrompts.js';

const VIDEO_ID = process.env.VIDEO_ID || process.argv[2];
const RAW_FILE_NAME = process.env.RAW_FILE_NAME || process.argv[3] || '';
const AI_MODEL = (
  process.env.GEMINI_MODEL_NAME ||
  process.env.AI_MODEL ||
  'gemini-2.5-flash'
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
  } catch (err) {
    console.warn('[Schema check warning]:', err.message);
  }
}

async function fetchWithRetry(url, options = {}, retries = 4, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(120000),
      });
      if ((res.status === 429 || res.status === 503 || res.status === 504) && i < retries - 1) {
        await new Promise((r) => setTimeout(r, delay));
        delay *= 1.5;
        continue;
      }
      return res;
    } catch (err) {
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

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-4000);
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-400)}`));
    });
    proc.on('error', reject);
  });
}

function convertSrtToVtt(srtText) {
  if (!srtText) return 'WEBVTT\n\n';
  const cleaned = srtText
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .trim();
  if (cleaned.startsWith('WEBVTT')) return cleaned;
  const vttBody = cleaned.replace(/(\d{1,2}:\d{2}(?::\d{2})?),(\d{1,3})/g, '$1.$2');
  return `WEBVTT\n\n${vttBody}\n`;
}

function normalizeModelCandidates(rawModel) {
  const cleaned = String(rawModel || 'gemini-2.5-flash-lite')
    .replace(/^models\//i, '')
    .replace(/flesh/gi, 'flash')
    .trim();

  const candidates = [
    cleaned,
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
  ];
  return Array.from(new Set(candidates.filter(Boolean)));
}

async function discoverAvailableGeminiModel() {
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const res = await fetch(listUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models : [];
    const supported = models.filter(
      (m) =>
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent') &&
        String(m.name || '').includes('gemini')
    );
    const flashLite = supported.find((m) => m.name.includes('flash-lite'));
    const flash = supported.find((m) => m.name.includes('flash'));
    const chosen = flashLite || flash || supported[0];
    return chosen ? String(chosen.name).replace(/^models\//i, '') : null;
  } catch (_) {
    return null;
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

async function callGeminiWithFallback(requestBody, preferredModelName) {
  const candidates = normalizeModelCandidates(preferredModelName);
  let lastErrorText = '';
  let lastStatus = 0;

  for (const candidateModel of candidates) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const res = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });

    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n')?.trim();
      if (!text) throw new Error('Gemini API ไม่ได้ส่งเนื้อหาคำบรรยายกลับมา');
      return text;
    }

    lastStatus = res.status;
    lastErrorText = await res.text();
    if (res.status === 404) {
      console.warn(`⚠️ Model "${candidateModel}" not found (404), trying next fallback model...`);
      continue;
    }
    throw new Error(`Gemini API Error (${res.status}): ${lastErrorText.slice(0, 400)}`);
  }

  const discoveredModel = await discoverAvailableGeminiModel();
  if (discoveredModel) {
    console.log(`🔄 Discovered available model from ListModels: ${discoveredModel}`);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(discoveredModel)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const res = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });
    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n')?.trim();
      if (text) return text;
    }
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

async function transcribeOriginalAudioWithGemini(audioFilePath, videoTitle, modelName, customPrompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('ไม่ได้ตั้งค่า GEMINI_API_KEY ในระบบ Environment / GitHub Secrets');
  }

  const audioBuffer = await fs.promises.readFile(audioFilePath);
  const base64Audio = audioBuffer.toString('base64');

  const prompt = customPrompt
    ? `${SUBTITLE_TRANSCRIPTION_PROMPT}\n\nข้อมูลบริบทชื่อวิดีโอ: "${videoTitle || ''}"\nคำสั่งเพิ่มเติมจากผู้ใช้งาน:\n${customPrompt}\n\nกรุณาถอดเสียงภาษาต้นฉบับจากไฟล์เสียงนี้เป็น JSON ตามโครงสร้างที่กำหนด:`
    : `${SUBTITLE_TRANSCRIPTION_PROMPT}\n\nข้อมูลบริบทชื่อวิดีโอ: "${videoTitle || ''}"\nกรุณาถอดเสียงภาษาต้นฉบับจากไฟล์เสียงนี้เป็น JSON ตามโครงสร้างที่กำหนด:`;

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

  const text = await callGeminiWithFallback(requestBody, modelName);
  const parsed = parseJsonResponseSafe(text);
  if (parsed?.rawFallbackText && parsed.rawFallbackText.includes('-->')) {
    return {
      isThai: true,
      detectedLangCode: 'th',
      detectedLangName: 'ไทย',
      originalSrt: parsed.rawFallbackText,
    };
  }

  const isThai = Boolean(parsed?.is_thai);
  const detectedLangCode = String(parsed?.detected_lang_code || (isThai ? 'th' : 'und')).trim();
  const detectedLangName = String(parsed?.detected_lang_name || (isThai ? 'ไทย' : 'ภาษาต่างประเทศ')).trim();
  const originalSrt = String(parsed?.original_srt || parsed?.thai_srt || '').trim();

  if (!originalSrt) {
    throw new Error('ไม่สามารถถอดเสียงภาษาต้นฉบับเป็นไฟล์ .SRT ได้');
  }

  return { isThai, detectedLangCode, detectedLangName, originalSrt };
}

async function translateOriginalSrtToThaiWithGemini(originalSrt, detectedLangName, modelName, customPrompt) {
  const prompt = customPrompt
    ? `${SUBTITLE_THAI_TRANSLATE_PROMPT}\n\nภาษาต้นฉบับ: ${detectedLangName}\nคำสั่งเพิ่มเติมจากผู้ใช้งาน:\n${customPrompt}\n\nบทคำบรรยาย .SRT ภาษาต้นฉบับ:\n${originalSrt}`
    : `${SUBTITLE_THAI_TRANSLATE_PROMPT}\n\nภาษาต้นฉบับ: ${detectedLangName}\n\nบทคำบรรยาย .SRT ภาษาต้นฉบับ:\n${originalSrt}`;

  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    safetySettings: GEMINI_SAFETY_SETTINGS,
  });

  const text = await callGeminiWithFallback(requestBody, modelName);
  const parsed = parseJsonResponseSafe(text);
  if (parsed?.rawFallbackText && parsed.rawFallbackText.includes('-->')) {
    return parsed.rawFallbackText;
  }

  const thaiSrt = String(parsed?.thai_srt || '').trim();
  if (!thaiSrt) {
    throw new Error('ไม่สามารถแปลบทคำบรรยายจากภาษาต้นฉบับเป็นภาษาไทยได้');
  }
  return thaiSrt;
}

async function generateSubtitlesWithGemini(audioFilePath, videoTitle, modelName, customPrompt) {
  // Step 1: Transcribe audio strictly in original spoken language + detect language
  console.log('🎙️ Step 1/2: Transcribing original spoken audio & detecting language...');
  const step1 = await transcribeOriginalAudioWithGemini(audioFilePath, videoTitle, modelName, customPrompt);

  if (step1.isThai) {
    return {
      isThai: true,
      detectedLangCode: 'th',
      detectedLangName: 'ไทย',
      originalSrt: step1.originalSrt,
      thaiSrt: step1.originalSrt,
    };
  }

  // Step 2: Translate transcribed original_srt into natural Thai .SRT
  console.log(`🌐 Step 2/2: Detected "${step1.detectedLangName}" (${step1.detectedLangCode}) -> Translating original SRT to Thai...`);
  const thaiSrt = await translateOriginalSrtToThaiWithGemini(
    step1.originalSrt,
    step1.detectedLangName,
    modelName,
    customPrompt
  );

  return {
    isThai: false,
    detectedLangCode: step1.detectedLangCode,
    detectedLangName: step1.detectedLangName,
    originalSrt: step1.originalSrt,
    thaiSrt,
  };
}

async function main() {
  const vidNum = Number(VIDEO_ID);
  const tempDir = path.resolve('./temp_audio_sub', String(vidNum));
  fs.mkdirSync(tempDir, { recursive: true });

  try {
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

    const token = await getGraphToken();
    const driveId = await getUserDriveId();
    const streamFolderId = await ensureStreamFolder(driveId, vidNum);

    // 1. Locate video source on OneDrive (/raw/{raw_file_name})
    let downloadUrl = null;
    if (activeRawName) {
      const rawUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(activeRawName)}?select=id,name,@microsoft.graph.downloadUrl`;
      const rawRes = await fetchWithRetry(rawUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (rawRes.ok) {
        const rawData = await rawRes.json();
        downloadUrl = rawData['@microsoft.graph.downloadUrl'];
      }
    }

    const localVideoPath = path.join(tempDir, 'input_video.mp4');
    const localAudioPath = path.join(tempDir, 'audio.mp3');

    if (downloadUrl) {
      console.log(`⬇️ Downloading raw video /raw/${activeRawName} for audio extraction...`);
      const fileRes = await fetchWithRetry(downloadUrl);
      if (!fileRes.ok || !fileRes.body) {
        throw new Error(`Failed to download raw video (${fileRes.status})`);
      }
      await pipeline(Readable.fromWeb(fileRes.body), fs.createWriteStream(localVideoPath));
      console.log('🎵 Extracting speech-optimized MP3 audio (16kHz Mono 48kbps)...');
      await runFFmpeg([
        '-y', '-i', localVideoPath,
        '-vn', '-ac', '1', '-ar', '16000',
        '-c:a', 'libmp3lame', '-b:a', '48k',
        localAudioPath,
      ]);
    } else {
      // Fallback: check if audio.mp3 already exists in /streams/stream_vid_{id}/audio.mp3
      const existingAudioRes = await fetchWithRetry(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${streamFolderId}:/audio.mp3?select=id,@microsoft.graph.downloadUrl`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (existingAudioRes.ok) {
        const audioData = await existingAudioRes.json();
        const audioDl = audioData['@microsoft.graph.downloadUrl'];
        const fRes = await fetchWithRetry(audioDl);
        await pipeline(Readable.fromWeb(fRes.body), fs.createWriteStream(localAudioPath));
      } else {
        throw new Error(`ไม่พบไฟล์วิดีโอต้นฉบับใน /raw/${activeRawName} หรือไฟล์เสียงในโฟลเดอร์สตรีม`);
      }
    }

    // 2. Upload audio.mp3 to OneDrive & mark audio_status = 'ready' in DB
    console.log('⬆️ Uploading extracted audio.mp3 to OneDrive...');
    await uploadSmallOrChunkedFile(driveId, streamFolderId, 'audio.mp3', localAudioPath, 'audio/mpeg');

    await sql`
      UPDATE videos
      SET audio_status = 'ready',
          updated_at = NOW()
      WHERE id = ${vidNum};
    `;
    console.log('✅ Audio extracted and marked READY in DB.');

    // 3. Generate AI Subtitles via Gemini (Language Detection & Dual-Track Subtitles)
    console.log(`🤖 Sending audio to Gemini (${AI_MODEL}) for subtitle generation & language detection...`);
    const subResult = await generateSubtitlesWithGemini(localAudioPath, video.title, AI_MODEL, CUSTOM_PROMPT);
    const { isThai, detectedLangCode, detectedLangName, thaiSrt, originalSrt } = subResult;

    console.log(`🌐 Audio Language Detected: ${detectedLangName} (${detectedLangCode}) | Is Thai: ${isThai}`);

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

    console.log(`⬆️ Uploading ${tracks.length} subtitle track(s) to OneDrive...`);
    await Promise.all(uploadPromises);

    await sql`
      UPDATE videos
      SET subtitle_status = 'ready',
          subtitle_srt = ${thaiSrt},
          subtitle_vtt = ${thaiVtt},
          subtitle_tracks = ${JSON.stringify(tracks)}::jsonb,
          subtitle_model = ${AI_MODEL},
          source_cache = NULL,
          source_cache_expires_at = 0,
          updated_at = NOW()
      WHERE id = ${vidNum};
    `;

    console.log(`🎉 Dual-track Subtitles generated and saved for Video #${vidNum}! Tracks:`, tracks.map((t) => t.label).join(', '));
  } catch (err) {
    console.error('❌ [Audio & Subtitle Worker Error]:', err);
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
