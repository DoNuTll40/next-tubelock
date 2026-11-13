/**
 * TubeLock GitHub Actions Worker #2:
 * Detailed Sprite Sheet Grid Generator & Gemini Vision Content Rating Verifier
 *
 * Flow:
 * 1. Download video from OneDrive /raw/{RAW_FILE_NAME} (or existing sprite from /streams/stream_vid_{VIDEO_ID})
 * 2. Generate Detailed 5x5 (25-frame) High-Clarity Sprite Sheet Grid covering the entire video duration
 * 3. Upload vision_sprite_grid.jpg to OneDrive & save compact preview Data URL to DB (sprite_status = 'ready')
 * 4. Send Detailed Sprite Sheet Grid + User's chosen Content Rating to Gemini Vision AI
 * 5. Compare AI's rating assessment against user's selection (after READY or when user clicks AI Auto-Verify)
 *    and persist verification result + rating into Neon DB!
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { neon } from '@neondatabase/serverless';
import {
  ensureWorkerLogsColumn,
  createWorkerLogger,
  downloadFileWithProgress,
  runFFmpegWithProgress,
  formatDurationShort,
} from './worker-utils.js';

const VIDEO_ID = process.env.VIDEO_ID || process.argv[2];
const RAW_FILE_NAME = process.env.RAW_FILE_NAME || process.argv[3] || '';
const USER_RATING = (process.env.USER_RATING || 'auto').trim().toLowerCase();
const AUTO_APPLY = (process.env.AUTO_APPLY || 'true').trim().toLowerCase() !== 'false';
const GEMINI_MODEL_NAME = (
  process.env.GEMINI_MODEL_NAME ||
  process.env.AI_MODEL ||
  'gemini-2.5-flash'
).replace(/['"]/g, '').trim();

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

const RATING_SEVERITY = {
  all: 0,
  '13+': 1,
  '18+': 2,
  mature: 3,
};

const RATING_LABELS = {
  all: 'ทั่วไป (All Ages)',
  '13+': 'วัยรุ่น (13+)',
  '18+': 'ผู้ใหญ่ (18+)',
  mature: 'เนื้อหาจำกัดเฉพาะ (Restricted / Mature)',
};

async function ensureSpriteRatingColumns() {
  try {
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS sprite_status VARCHAR(50) DEFAULT 'waiting';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS sprite_preview_url TEXT DEFAULT '';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS content_rating VARCHAR(50) DEFAULT 'all';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS user_selected_rating VARCHAR(50) DEFAULT 'all';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS ai_suggested_rating VARCHAR(50) DEFAULT '';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS rating_check_status VARCHAR(50) DEFAULT 'pending';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS vision_analysis JSONB;`;
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

  if (!res.ok) throw new Error(`Failed to obtain Graph token (${res.status})`);
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
  if (checkRes.ok) return (await checkRes.json()).id;

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
  if (!createFolder.ok) throw new Error(`Failed to create stream folder (${createFolder.status})`);
  return (await createFolder.json()).id;
}

async function uploadFileToOneDrive(driveId, folderId, fileName, filePath, contentType = 'image/jpeg') {
  const token = await getGraphToken();
  const fileBuffer = await fs.promises.readFile(filePath);
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/content`;
  const res = await fetchWithRetry(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': fileBuffer.length.toString(),
      'Content-Type': contentType,
    },
    body: fileBuffer,
  });
  if (!res.ok) throw new Error(`Failed to upload ${fileName} (${res.status})`);
  return await res.json();
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

function probeDuration(videoPath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', () => {
      const sec = parseFloat(out.trim());
      resolve(sec > 0 ? sec : 60);
    });
    proc.on('error', () => resolve(60));
  });
}

async function analyzeSpriteWithGeminiVision(spriteImagePath, videoTitle, userRating, logger = null) {
  const log = async (msg, opts) => {
    if (logger) await logger.log(msg, opts);
    else console.log(msg);
  };
  if (!GEMINI_API_KEY) {
    throw new Error('ไม่ได้ตั้งค่า GEMINI_API_KEY ในระบบ Environment / GitHub Secrets');
  }

  const imageBuffer = await fs.promises.readFile(spriteImagePath);
  const imageKb = Math.max(1, Math.round(imageBuffer.length / 1024));
  const base64Image = imageBuffer.toString('base64');

  const isAutoMode = !userRating || userRating === 'auto';
  const prompt = `คุณคือระบบ AI Content Moderation & Rating Inspector สำหรับแพลตฟอร์มวิดีโอ TubeLock
ภาพที่แนบมานี้คือ Detailed Sprite Sheet Grid (ตาราง 5x5 รวม 25 เฟรมความละเอียดสูง) ที่ดึงมาจากตลอดความยาวของวิดีโอชื่อ: "${videoTitle || 'Untitled'}"
${isAutoMode ? 'ผู้ใช้งานเลือกโหมด: ให้ AI ประเมินและกำหนดเรตเนื้อหาให้อัตโนมัติ' : `ผู้ใช้งานได้เลือกเรตเนื้อหาไว้เป็น: "${userRating.toUpperCase()}" (${RATING_LABELS[userRating] || userRating})`}

เกณฑ์เรตเนื้อหา 4 ระดับของระบบ:
- "all": ทั่วไป (All Ages) - ไม่มีเนื้อหารุนแรง เพศ ภาพโป๊เปลือย หรือสิ่งผิดกฎหมาย เหมาะสำหรับทุกวัย
- "13+": วัยรุ่น (13+) - มีฉากต่อสู้แอ็กชัน เกมยิงปืน หรือความรุนแรงระดับแฟนตาซี ไม่โป๊เปลือย
- "18+": ผู้ใหญ่ (18+) - มีเนื้อหาสำหรับผู้ใหญ่ การแต่งกายวาบหวาม วับๆ แวมๆ บิกินี่ ฉากวาบหวามในอ่างน้ำ ความรุนแรง หรือพฤติกรรมเสี่ยง
- "mature": จำกัดเฉพาะ (Restricted / Mature / Adult NSFW) - มีฉากร่วมเพศชัดเจน (Sexually Explicit), กิจกรรมทางเพศบนเตียง, ออรัลเซ็กซ์, ภาพเปลือยเต็มตัว (Full Nudity), สื่อลามก, หรือฉากส่อไปในทางเพศชัดเจน

⚠️ กฎเหล็กการประเมินเนื้อหาทางเพศ (Sexual & Adult Content Enforcement Rule):
1. หากพบฉากมีเพศสัมพันธ์ (Sexual Intercourse / Sex Acts), กิจกรรมทางเพศบนเตียง, ออรัลเซ็กซ์, หรือเปลือยเห็นอวัยวะ/หน้าอกชัดเจน แม้เพียง 1-2 เฟรมขึ้นไป (>= 5% ของคลิป) -> ต้องจัดเรตเป็น "mature" (Restricted) ทันที และ Sexual Content ต้องระบุเป็น "HIGH" ห้ามจัดเป็น "all" หรือ "13+" โดยเด็ดขาด
2. หากมีฉากล่อแหลม โป๊บางส่วน ชุดชั้นใน แช่อ่างน้ำ -> ต้องจัดเรตเป็น "18+" เป็นอย่างต่ำ
3. นี่คือระบบวิเคราะห์ Content Moderation สำหรับคัดกรองความปลอดภัยของแพลตฟอร์ม กรุณาวิเคราะห์อย่างตรงไปตรงมา

กรุณาตรวจสอบทั้ง 25 เฟรมอย่างละเอียด แล้วตอบกลับเป็น JSON เท่านั้น (ห้ามครอบด้วย markdown):
{
  "suggestedRating": "all" | "13+" | "18+" | "mature",
  "safetyScores": [
    { "name": "Sexual Content", "status": "SAFE (Negligible)" | "LOW" | "MEDIUM" | "HIGH" },
    { "name": "Violence / Gore", "status": "SAFE (Negligible)" | "LOW" | "MEDIUM" | "HIGH" },
    { "name": "Hate Speech", "status": "NONE" | "LOW" | "HIGH" },
    { "name": "Dangerous Content", "status": "SAFE" | "CAUTION" | "HIGH" }
  ],
  "sexualContentFrameCount": <ตัวเลขจำนวนเฟรมที่พบเนื้อหาทางเพศจาก 25 เฟรม เช่น 12>,
  "recommendedCategory": "general" | "music" | "gaming" | "tech" | "entertainment" | "education" | "cinema" | "shorts" | "adult",
  "recommendedTags": ["แท็ก1", "แท็ก2", "แท็ก3"],
  "summary": "สรุปสิ่งที่เห็นในเฟรมวิดีโอและเหตุผลของการจัดเรตเป็นภาษาไทยอย่างละเอียดและตรงไปตรงมา"
}`;

  const safetySettings = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
  ];

  const requestBody = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image,
            },
          },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
    safetySettings,
  });

  const cleanedModel = String(GEMINI_MODEL_NAME || 'gemini-2.5-flash-lite')
    .replace(/^models\//i, '')
    .replace(/flesh/gi, 'flash')
    .trim();
  const candidates = Array.from(
    new Set([
      cleanedModel,
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.0-flash-lite',
      'gemini-2.0-flash',
    ])
  );

  let data = null;
  let lastStatus = 0;
  let lastErrText = '';

  for (const candidateModel of candidates) {
    const tReqStart = Date.now();
    await log(`📡 กำลังส่ง Sprite Sheet (${imageKb} KB) ให้ Gemini Vision (${candidateModel}) วิเคราะห์...`);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const res = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });

    if (res.ok) {
      const elapsedSec = ((Date.now() - tReqStart) / 1000).toFixed(1);
      await log(`✅ ได้รับผลวิเคราะห์จาก Gemini Vision (${candidateModel}) ใน ${elapsedSec}s`);
      data = await res.json();
      break;
    }

    lastStatus = res.status;
    lastErrText = await res.text();
    if (res.status === 404) {
      await log(`⚠️ ไม่พบโมเดล Vision "${candidateModel}" (404) — กำลังสลับใช้โมเดลสำรอง...`, { level: 'warn' });
      continue;
    }
    throw new Error(`Gemini Vision API Error (${res.status}): ${lastErrText.slice(0, 400)}`);
  }

  if (!data) {
    throw new Error(`Gemini Vision API Error (${lastStatus}): ${lastErrText.slice(0, 400)}`);
  }

  const candidate = data?.candidates?.[0];
  const promptFeedback = data?.promptFeedback;
  const finishReason = candidate?.finishReason || promptFeedback?.blockReason || '';

  // Extract all safety ratings from candidate & promptFeedback
  const allSafetyRatings = [
    ...(candidate?.safetyRatings || []),
    ...(promptFeedback?.safetyRatings || []),
  ];

  const sexualRating = allSafetyRatings.find((r) => r.category === 'HARM_CATEGORY_SEXUALLY_EXPLICIT');
  const violenceRating = allSafetyRatings.find(
    (r) => r.category === 'HARM_CATEGORY_DANGEROUS_CONTENT' || r.category === 'HARM_CATEGORY_HARASSMENT'
  );

  const isSexualHigh = sexualRating && (
    sexualRating.probability === 'HIGH' ||
    sexualRating.probability === 'MEDIUM' ||
    sexualRating.severity === 'HIGH' ||
    sexualRating.severity === 'MEDIUM'
  );
  const isSafetyBlocked = finishReason === 'SAFETY' || promptFeedback?.blockReason === 'SAFETY';

  // 🚨 CRITICAL FAIL-SAFE: If Gemini blocked the prompt/candidate due to SAFETY,
  // or detected HIGH/MEDIUM sexually explicit content, it is 100% EXPLICIT ADULT CONTENT!
  // NEVER fall back to 'all' or 'SAFE'!
  if (isSafetyBlocked || isSexualHigh) {
    console.warn(`🚨 [Sexually Explicit Detected by AI Safety Engine]: finishReason=${finishReason}, sexualRating=${JSON.stringify(sexualRating)}`);
    return {
      suggestedRating: 'mature',
      suggestedRatingLabel: RATING_LABELS['mature'],
      safetyScores: [
        { name: 'Sexual Content', status: 'HIGH (Sexually Explicit Detected by AI Safety)' },
        { name: 'Violence / Gore', status: violenceRating?.probability === 'HIGH' ? 'HIGH' : 'SAFE (Negligible)' },
        { name: 'Hate Speech', status: 'NONE' },
        { name: 'Dangerous Content', status: 'SAFE' },
      ],
      recommendedCategory: 'adult',
      recommendedTags: ['18+', 'NSFW', 'Mature', 'Adult'],
      summary: 'ระบบ AI Safety Engine ตรวจพบภาพที่มีเนื้อหาทางเพศชัดเจน (Sexually Explicit / Adult Content) จัดเป็นเรต Restricted / Mature ทันทีเพื่อความปลอดภัย',
      isNsfw: true,
      sexualContentRatio: 'HIGH',
    };
  }

  const rawText = candidate?.content?.parts?.map((p) => p.text || '').join('\n')?.trim() || '';
  let parsed = {};
  if (rawText) {
    try {
      const cleanedJson = rawText.replace(/```json\n?/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanedJson);
    } catch (parseErr) {
      console.warn('⚠️ Could not parse JSON from Gemini parts:', parseErr.message, rawText.slice(0, 200));
    }
  }

  const parsedSexualStatus = (
    parsed?.safetyScores?.find((s) => s.name?.toLowerCase().includes('sex'))?.status || ''
  ).toUpperCase();
  const hasSexualMediumOrHigh =
    parsedSexualStatus.includes('HIGH') ||
    parsedSexualStatus.includes('MEDIUM') ||
    (Number(parsed?.sexualContentPercentage || 0) >= 5) ||
    (Number(parsed?.sexualContentFrameCount || 0) >= 2);

  let normalizedRating = 'all';
  if (['all', '13+', '18+', 'mature'].includes(parsed.suggestedRating)) {
    normalizedRating = parsed.suggestedRating;
  } else if (hasSexualMediumOrHigh) {
    normalizedRating = 'mature';
  } else if (userRating && userRating !== 'auto' && ['13+', '18+', 'mature'].includes(userRating)) {
    normalizedRating = userRating;
  }

  // Double check: if parsed rating is 'all' or '13+', but safetyScores indicates HIGH/MEDIUM sexual content, UPGRADE to mature!
  if ((normalizedRating === 'all' || normalizedRating === '13+') && hasSexualMediumOrHigh) {
    console.warn(`⚠️ Overriding rating from "${normalizedRating}" to "mature" due to sexual content detection (status: ${parsedSexualStatus})`);
    normalizedRating = 'mature';
  }

  return {
    suggestedRating: normalizedRating,
    suggestedRatingLabel: RATING_LABELS[normalizedRating] || 'ทั่วไป (All Ages)',
    safetyScores: Array.isArray(parsed.safetyScores) && parsed.safetyScores.length > 0 ? parsed.safetyScores : [
      { name: 'Sexual Content', status: hasSexualMediumOrHigh ? 'HIGH' : 'SAFE (Negligible)' },
      { name: 'Violence / Gore', status: 'SAFE (Negligible)' },
      { name: 'Hate Speech', status: 'NONE' },
      { name: 'Dangerous Content', status: 'SAFE' },
    ],
    recommendedCategory: normalizedRating === 'mature' && (!parsed.recommendedCategory || parsed.recommendedCategory === 'general') ? 'adult' : (parsed.recommendedCategory || 'general'),
    recommendedTags: Array.isArray(parsed.recommendedTags) && parsed.recommendedTags.length > 0 ? parsed.recommendedTags : (normalizedRating === 'mature' ? ['18+', 'NSFW', 'Mature'] : []),
    summary: parsed.summary || (normalizedRating === 'mature' ? 'ตรวจพบเนื้อหาสำหรับผู้ใหญ่หรือมีความล่อแหลมสูง จัดเรตติ้งเป็น Restricted / Mature' : 'ตรวจสอบ Sprite Sheet ครบ 25 เฟรมเรียบร้อยแล้ว'),
  };
}

async function main() {
  const vidNum = Number(VIDEO_ID);
  const tempDir = path.resolve('./temp_sprite_rating', String(vidNum));
  fs.mkdirSync(tempDir, { recursive: true });
  const logger = createWorkerLogger(sql, vidNum, 'rating', 'Sprite & Rating');

  try {
    await ensureSpriteRatingColumns();
    await ensureWorkerLogsColumn(sql);
    await logger.log(`🛡️ เริ่ม Worker #2 (Sprite 5x5 + Gemini Vision Rating) สำหรับ Video #${vidNum} | โมเดล: ${GEMINI_MODEL_NAME}`);

    const rows = await sql`
      SELECT id, title, raw_file_name, duration, content_rating, user_selected_rating
      FROM videos
      WHERE id = ${vidNum}
      LIMIT 1;
    `;
    if (!rows || rows.length === 0) {
      throw new Error(`ไม่พบวิดีโอ ID #${vidNum} ในฐานข้อมูล`);
    }

    const video = rows[0];
    const activeRawName = RAW_FILE_NAME || video.raw_file_name;
    const effectiveUserRating =
      USER_RATING && USER_RATING !== 'auto'
        ? USER_RATING
        : video.user_selected_rating || video.content_rating || 'auto';

    await sql`
      UPDATE videos
      SET sprite_status = 'generating',
          rating_check_status = 'analyzing',
          updated_at = NOW()
      WHERE id = ${vidNum};
    `;
    await logger.log(`⚙️ ตั้งค่าเรตเริ่มต้น: ${effectiveUserRating} | ต้นฉบับ OneDrive: ${activeRawName || '(ไม่มี — ใช้ภาพในสตรีม)'}`);

    await logger.log('🔑 กำลังขอ Access Token จาก Microsoft Graph และตรวจสอบโฟลเดอร์ OneDrive...');
    const token = await getGraphToken();
    const driveId = await getUserDriveId();
    const streamFolderId = await ensureStreamFolder(driveId, vidNum);

    const gridHighPath = path.join(tempDir, 'vision_sprite_grid.jpg');
    const gridCompactPath = path.join(tempDir, 'vision_sprite_preview.jpg');

    // 1. Check if raw video exists in /raw/{activeRawName}
    let rawDownloadUrl = null;
    let rawExpectedBytes = 0;
    if (activeRawName) {
      const rawUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(activeRawName)}?select=id,name,size,@microsoft.graph.downloadUrl`;
      const rawRes = await fetchWithRetry(rawUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (rawRes.ok) {
        const rawData = await rawRes.json();
        rawDownloadUrl = rawData['@microsoft.graph.downloadUrl'];
        rawExpectedBytes = Number(rawData.size || 0);
      } else {
        await logger.log(`ℹ️ ไม่พบไฟล์ดิบ /raw/${activeRawName} (${rawRes.status}) — จะใช้ Sprite Sheet ที่มีอยู่แทน`, { level: 'warn' });
      }
    }

    if (rawDownloadUrl) {
      const localVideoPath = path.join(tempDir, 'input_video.mp4');
      await downloadFileWithProgress(rawDownloadUrl, localVideoPath, {
        label: `วิดีโอต้นฉบับ (${activeRawName})`,
        expectedSizeBytes: rawExpectedBytes,
        logger,
        stallTimeoutMs: 90000,
      });

      const duration = await probeDuration(localVideoPath);
      const stepSec = Math.max(0.5, duration / 25);
      await logger.log(`📐 ความยาววิดีโอ ${formatDurationShort(duration)} -> กำลังสกัด Sprite Sheet 5x5 (25 เฟรม, ดึงทุก ${stepSec.toFixed(1)}s)...`);

      // High-detail 5x5 grid (320x180 per tile = 1600x900) for Gemini Vision
      await runFFmpegWithProgress([
        '-y', '-i', localVideoPath,
        '-vf', `fps=1/${stepSec.toFixed(4)},scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,tile=5x5`,
        '-frames:v', '1',
        '-q:v', '2',
        gridHighPath,
      ], {
        durationSec: duration,
        stepLabel: 'สร้าง Sprite Grid 5x5 (1600x900)',
        logger,
      });

      // Compact preview grid (800x450) for instant UI preview in Upload Studio
      await runFFmpegWithProgress([
        '-y', '-i', gridHighPath,
        '-vf', 'scale=800:450',
        '-q:v', '5',
        gridCompactPath,
      ], {
        stepLabel: 'ย่อ Sprite Preview (800x450)',
        logger,
      });
    } else {
      // Fallback if video is already READY and /raw/ was cleaned up: use sprite_hd_001.jpg or sprite_sd_001.jpg from stream folder
      await logger.log('🔎 กำลังค้นหาไฟล์ Sprite Sheet เดิมจากโฟลเดอร์ /streams...');
      let existingSpriteDl = null;
      let matchedSpriteName = '';
      for (const candidate of ['vision_sprite_grid.jpg', 'sprite_hd_001.jpg', 'sprite_sd_001.jpg', 'poster.jpg']) {
        const spRes = await fetchWithRetry(
          `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${streamFolderId}:/${candidate}?select=id,@microsoft.graph.downloadUrl`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (spRes.ok) {
          const spData = await spRes.json();
          existingSpriteDl = spData['@microsoft.graph.downloadUrl'];
          matchedSpriteName = candidate;
          break;
        }
      }
      if (!existingSpriteDl) {
        throw new Error('ไม่พบไฟล์วิดีโอต้นฉบับหรือภาพ Sprite Sheet บน OneDrive');
      }
      await downloadFileWithProgress(existingSpriteDl, gridHighPath, {
        label: `ภาพ Sprite เดิม (${matchedSpriteName})`,
        logger,
      });
      await runFFmpegWithProgress(
        ['-y', '-i', gridHighPath, '-vf', 'scale=800:450', '-q:v', '5', gridCompactPath],
        { stepLabel: 'ย่อ Sprite Preview (800x450)', logger }
      );
    }

    // 2. Upload vision_sprite_grid.jpg to OneDrive & save preview data URL in DB
    const gridStats = fs.statSync(gridHighPath);
    await logger.log(`⬆️ กำลังอัปโหลด vision_sprite_grid.jpg (${Math.round(gridStats.size / 1024)} KB) ขึ้น OneDrive...`);
    await uploadFileToOneDrive(driveId, streamFolderId, 'vision_sprite_grid.jpg', gridHighPath, 'image/jpeg');
    const previewBase64 = `data:image/jpeg;base64,${(await fs.promises.readFile(gridCompactPath)).toString('base64')}`;

    await sql`
      UPDATE videos
      SET sprite_status = 'ready',
          sprite_preview_url = ${previewBase64},
          updated_at = NOW()
      WHERE id = ${vidNum};
    `;
    await logger.log('✅ สร้าง & อัปโหลด Sprite Sheet 5x5 สำเร็จแล้ว กำลังเริ่มตรวจสอบเนื้อหาด้วย AI', { level: 'success' });

    // 3. Send Sprite Sheet Grid to Gemini Vision AI for Content Rating Verification
    const visionResult = await analyzeSpriteWithGeminiVision(gridHighPath, video.title, effectiveUserRating, logger);

    const userSeverity = RATING_SEVERITY[effectiveUserRating] ?? -1;
    const aiSeverity = RATING_SEVERITY[visionResult.suggestedRating] ?? 0;

    let verificationStatus = 'AI_AUTO_SELECTED';
    let finalRating = visionResult.suggestedRating;
    let comparisonNote = '';

    if (USER_RATING === 'auto' || effectiveUserRating === 'auto') {
      verificationStatus = 'AI_AUTO_SELECTED';
      finalRating = visionResult.suggestedRating;
      comparisonNote = `AI ประเมินเรตเนื้อหาให้อัตโนมัติเป็น "${visionResult.suggestedRatingLabel}"`;
    } else if (aiSeverity > userSeverity) {
      verificationStatus = 'MISMATCH_UPGRADED';
      finalRating = visionResult.suggestedRating;
      comparisonNote = `ผู้ใช้งานเลือกเรต "${RATING_LABELS[effectiveUserRating] || effectiveUserRating}" แต่ AI ตรวจพบเนื้อหาระดับ "${visionResult.suggestedRatingLabel}" จึงปรับเรตตามความปลอดภัย`;
    } else if (aiSeverity === userSeverity) {
      verificationStatus = 'VERIFIED_MATCH';
      finalRating = effectiveUserRating;
      comparisonNote = `ผลการตรวจสอบตรงกับที่ผู้ใช้งานเลือกไว้ ("${visionResult.suggestedRatingLabel}")`;
    } else {
      verificationStatus = 'VERIFIED_SAFE';
      finalRating = AUTO_APPLY ? visionResult.suggestedRating : effectiveUserRating;
      comparisonNote = `AI ตรวจพบเนื้อหาระดับ "${visionResult.suggestedRatingLabel}" ซึ่งปลอดภัยภายใต้เรตที่ผู้ใช้งานเลือกไว้ ("${RATING_LABELS[effectiveUserRating] || effectiveUserRating}")`;
    }

    const fullAnalysis = {
      ...visionResult,
      userSelectedRating: effectiveUserRating,
      finalAppliedRating: finalRating,
      verificationStatus,
      comparisonNote,
      analyzedAt: new Date().toISOString(),
    };

    await sql`
      UPDATE videos
      SET sprite_status = 'ready',
          content_rating = ${finalRating},
          ai_suggested_rating = ${visionResult.suggestedRating},
          rating_check_status = ${verificationStatus},
          vision_analysis = ${JSON.stringify(fullAnalysis)}::jsonb,
          updated_at = NOW()
      WHERE id = ${vidNum};
    `;

    await logger.log(
      `🎉 จัดเรตเนื้อหาด้วย Gemini Vision สำเร็จ: ${verificationStatus} -> เรตสุดท้าย "${finalRating}" (หมวด ${visionResult.recommendedCategory || 'general'})`,
      { level: 'success' }
    );
  } catch (err) {
    console.error('❌ [Sprite & Content Rating Worker Error]:', err);
    await logger.log(`❌ ตรวจสอบเรต & Sprite Sheet ล้มเหลว: ${err.message}`, { level: 'error' }).catch(() => {});
    try {
      await sql`
        UPDATE videos
        SET sprite_status = CASE WHEN sprite_status = 'ready' THEN 'ready' ELSE 'failed' END,
            rating_check_status = 'failed',
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
