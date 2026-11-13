/**
 * Shared Node 24 Utilities for TubeLock GitHub Actions Workers:
 * - Atomic Neon DB + GitHub Actions Console Logger (worker_logs JSONB)
 * - Streaming Downloader with stall-timeout, MB/s speed, % & ETA logging
 * - FFmpeg Runner with time/speed progress parsing
 */

import fs from 'node:fs';
import { spawn } from 'node:child_process';

export function nowTimeLabel() {
  try {
    return new Date().toLocaleTimeString('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour12: false,
    });
  } catch {
    return new Date().toISOString().slice(11, 19);
  }
}

export function formatDurationShort(totalSeconds = 0) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export async function ensureWorkerLogsColumn(sql) {
  try {
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS worker_logs JSONB DEFAULT '[]'::jsonb;`;
  } catch (err) {
    console.warn('[worker_logs schema warning]:', err.message);
  }
}

export function createWorkerLogger(sql, videoId, sourceTag, sourceLabel) {
  const vidNum = Number(videoId);
  let seq = 0;
  let columnReady = false;

  async function ensureColOnce() {
    if (columnReady) return;
    columnReady = true;
    await ensureWorkerLogsColumn(sql);
  }

  async function log(message, { level = 'info', toDb = true } = {}) {
    const time = nowTimeLabel();
    const consoleLine = `[${time}] [${sourceLabel}] ${message}`;
    if (level === 'error') {
      console.error(consoleLine);
    } else if (level === 'warn') {
      console.warn(consoleLine);
    } else {
      console.log(consoleLine);
    }

    if (!toDb || !sql || !Number.isFinite(vidNum)) return;

    const entry = {
      id: `${sourceTag}_${Date.now()}_${++seq}`,
      ts: new Date().toISOString(),
      time,
      source: sourceTag,
      label: sourceLabel,
      level,
      message: String(message || '').slice(0, 500),
    };

    try {
      await ensureColOnce();
      const entryJson = JSON.stringify([entry]);
      await sql`
        UPDATE videos
        SET worker_logs = COALESCE(
          (
            SELECT jsonb_agg(elem ORDER BY ord ASC)
            FROM (
              SELECT elem, ord
              FROM jsonb_array_elements(COALESCE(videos.worker_logs, '[]'::jsonb) || ${entryJson}::jsonb)
              WITH ORDINALITY AS t(elem, ord)
              ORDER BY ord DESC
              LIMIT 120
            ) sub
          ),
          '[]'::jsonb
        )
        WHERE id = ${vidNum};
      `;
    } catch (err) {
      console.warn(`[worker_logs append warning]: ${err.message}`);
    }
  }

  return { log };
}

function writeChunkWithBackpressure(stream, chunk) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      stream.off('error', onError);
      stream.off('drain', onDrain);
    };

    stream.once('error', onError);
    const ok = stream.write(chunk);
    if (ok) {
      cleanup();
      resolve();
    } else {
      stream.once('drain', onDrain);
    }
  });
}

function endWriteStream(stream) {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.once('finish', resolve);
    stream.end();
  });
}

/**
 * Streams a remote URL to disk with active-stall timeout protection and live progress logging.
 */
export async function downloadFileWithProgress(
  url,
  destPath,
  {
    label = 'ไฟล์ต้นฉบับ',
    expectedSizeBytes = 0,
    logger = null,
    stallTimeoutMs = 90000,
    retries = 3,
  } = {}
) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    let stallTimer = null;
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        controller.abort(new Error(`Stall timeout (${Math.round(stallTimeoutMs / 1000)}s without data)`));
      }, stallTimeoutMs);
    };

    try {
      resetStallTimer();
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} while downloading ${label}`);
      }

      const headerLen = Number(res.headers.get('content-length') || 0);
      const totalBytes = headerLen > 0 ? headerLen : Number(expectedSizeBytes || 0);
      const totalMB = totalBytes > 0 ? (totalBytes / 1048576).toFixed(1) : '?';

      const startMs = Date.now();
      let receivedBytes = 0;
      let lastConsolePct = -10;
      let lastConsoleTime = startMs;
      let lastDbMilestone = -1;

      if (logger) {
        await logger.log(
          `⬇️ เริ่มดาวน์โหลด ${label}${totalBytes > 0 ? ` (ขนาด ${totalMB} MB)` : ''}...`,
          { toDb: true }
        );
      }

      const writer = fs.createWriteStream(destPath);
      const reader = res.body.getReader();

      try {
        while (true) {
          resetStallTimer();
          const { done, value } = await reader.read();
          if (done) break;

          if (value && value.byteLength > 0) {
            await writeChunkWithBackpressure(writer, value);
            receivedBytes += value.byteLength;

            const now = Date.now();
            const elapsedSec = Math.max(0.1, (now - startMs) / 1000);
            const speedMBs = (receivedBytes / 1048576 / elapsedSec).toFixed(1);
            const recMB = (receivedBytes / 1048576).toFixed(1);

            if (totalBytes > 0) {
              const pct = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
              if (pct - lastConsolePct >= 10 || now - lastConsoleTime >= 4000) {
                lastConsolePct = pct;
                lastConsoleTime = now;
                const remainingBytes = Math.max(0, totalBytes - receivedBytes);
                const bytesPerSec = receivedBytes / elapsedSec;
                const etaSec = bytesPerSec > 0 ? Math.round(remainingBytes / bytesPerSec) : 0;
                const dbMilestone = pct >= 75 ? 75 : pct >= 50 ? 50 : pct >= 25 ? 25 : -1;
                const pushDb = dbMilestone > lastDbMilestone && pct < 100;
                if (pushDb) lastDbMilestone = dbMilestone;

                const msg = `⬇️ ดาวน์โหลด ${label}: ${pct}% (${recMB}/${totalMB} MB • ${speedMBs} MB/s${etaSec > 1 ? ` • ~${etaSec}s` : ''})`;
                if (logger) {
                  await logger.log(msg, { toDb: pushDb });
                } else {
                  console.log(`[${nowTimeLabel()}] ${msg}`);
                }
              }
            } else if (now - lastConsoleTime >= 4000) {
              lastConsoleTime = now;
              const msg = `⬇️ ดาวน์โหลด ${label}: ${recMB} MB (${speedMBs} MB/s)...`;
              if (logger) await logger.log(msg, { toDb: false });
              else console.log(`[${nowTimeLabel()}] ${msg}`);
            }
          }
        }
        await endWriteStream(writer);
      } catch (streamErr) {
        writer.destroy();
        throw streamErr;
      }

      if (stallTimer) clearTimeout(stallTimer);
      const elapsedSec = Math.max(0.1, (Date.now() - startMs) / 1000);
      const finalMB = (receivedBytes / 1048576).toFixed(1);
      const avgSpeed = (receivedBytes / 1048576 / elapsedSec).toFixed(1);
      if (logger) {
        await logger.log(
          `✅ ดาวน์โหลด ${label} สำเร็จ (${finalMB} MB ใน ${elapsedSec.toFixed(1)}s • เฉลี่ย ${avgSpeed} MB/s)`,
          { level: 'success', toDb: true }
        );
      }
      return { bytes: receivedBytes, elapsedSec };
    } catch (err) {
      if (stallTimer) clearTimeout(stallTimer);
      lastError = err;
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      } catch {}

      if (attempt < retries) {
        const waitMs = attempt * 2500;
        const warnMsg = `⚠️ ดาวน์โหลด ${label} สะดุด (${err.message}) — ลองใหม่รอบ ${attempt + 1}/${retries} ใน ${(waitMs / 1000).toFixed(1)}s`;
        if (logger) await logger.log(warnMsg, { level: 'warn', toDb: true });
        else console.warn(warnMsg);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  throw lastError || new Error(`ดาวน์โหลด ${label} ไม่สำเร็จ`);
}

/**
 * Runs FFmpeg and emits parsed progress updates every ~4s.
 */
export function runFFmpegWithProgress(
  args,
  {
    durationSec = 0,
    stepLabel = 'FFmpeg',
    logger = null,
    onProgress = null,
    logIntervalMs = 4000,
  } = {}
) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    let lastEmitMs = 0;

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 10000) stderr = stderr.slice(-5000);

      const timeMatches = [...text.matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
      if (timeMatches.length > 0) {
        const m = timeMatches[timeMatches.length - 1];
        const sec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
        const speedMatch = text.match(/speed=\s*([\d.]+x)/);
        const speedStr = speedMatch ? speedMatch[1] : '';
        const pct = durationSec > 0 ? Math.min(99, Math.round((sec / durationSec) * 100)) : 0;

        const now = Date.now();
        if (now - lastEmitMs >= logIntervalMs) {
          lastEmitMs = now;
          const timeDisplay = durationSec > 0
            ? `${pct}% (${formatDurationShort(sec)} / ${formatDurationShort(durationSec)})`
            : `${formatDurationShort(sec)}`;
          const speedDisplay = speedStr ? ` • speed=${speedStr}` : '';
          const consoleMsg = `[${nowTimeLabel()}] [${stepLabel}] ${timeDisplay}${speedDisplay}`;
          console.log(consoleMsg);
        }

        if (onProgress) {
          Promise.resolve(onProgress({ sec, pct, speedStr })).catch(() => {});
        }
      }
    });

    proc.on('close', async (code) => {
      if (code === 0) {
        resolve();
      } else {
        const tail = stderr.slice(-600);
        if (logger) {
          await logger.log(`❌ ${stepLabel} ล้มเหลว (exit ${code}): ${tail.slice(-180)}`, {
            level: 'error',
            toDb: true,
          });
        }
        reject(new Error(`FFmpeg (${stepLabel}) exited with code ${code}: ${tail}`));
      }
    });
    proc.on('error', reject);
  });
}
