import { getDb } from './db';

// ── In-Memory State across Fast Refresh / Hot Reloading ───────────────
const viewBuffer = globalThis.__tubelock_view_buffer || (globalThis.__tubelock_view_buffer = new Map());
const viewCooldown = globalThis.__tubelock_view_cooldown || (globalThis.__tubelock_view_cooldown = new Map());

// ── Configuration ─────────────────────────────────────────────────────
// 1. ครบ 5 วิวเมื่อไหร่ ให้เขียนลง Database ทันที
export const BATCH_THRESHOLD = 5;

// 2. Cooldown ป้องกันผู้ใช้เดิม / IP เดิมปั๊มวิวซ้ำภายใน 15 นาที
export const COOLDOWN_MS = 15 * 60 * 1000;

// 3. ปัดกวาดวิวที่ยังไม่ถึง 5 วิวลง DB ทุกๆ 30 วินาที เพื่อไม่ให้ยอดตกหล่น
export const FLUSH_INTERVAL_MS = 30 * 1000;

/**
 * Flush pending views count for a specific video into Neon DB
 */
export async function flushVideoViews(videoId) {
  const vId = String(videoId);
  const count = viewBuffer.get(vId) || 0;
  if (count <= 0) return 0;

  // Atomically claim the count
  viewBuffer.delete(vId);

  try {
    const sql = getDb();
    await sql`
      UPDATE videos 
      SET views_count = COALESCE(views_count, 0) + ${count}
      WHERE id = ${Number(vId)};
    `;
    console.log(`[ViewTracker] 🚀 Flushed ${count} view(s) to DB for Video #${vId}`);
    return count;
  } catch (err) {
    console.error(`[ViewTracker Error] Failed to flush views for Video #${vId}:`, err?.message);
    // Put back count if DB update failed
    viewBuffer.set(vId, (viewBuffer.get(vId) || 0) + count);
    return 0;
  }
}

/**
 * Periodic Sweep: Flush all pending views in buffer to DB
 */
export async function flushAllPendingViews() {
  if (viewBuffer.size === 0) return;
  const entries = Array.from(viewBuffer.entries());
  for (const [vId, count] of entries) {
    if (count > 0) {
      await flushVideoViews(vId);
    }
  }
}

// Ensure background sweep timer is started once
if (!globalThis.__tubelock_view_flush_timer) {
  globalThis.__tubelock_view_flush_timer = setInterval(() => {
    flushAllPendingViews().catch((err) => {
      console.warn('[ViewTracker Background Sweep Warning]:', err?.message);
    });

    // Cleanup expired cooldown keys
    const now = Date.now();
    for (const [key, expiresAt] of viewCooldown.entries()) {
      if (expiresAt <= now) {
        viewCooldown.delete(key);
      }
    }
  }, FLUSH_INTERVAL_MS);
}

/**
 * Record a verified quality view
 * 
 * @param {Object} params
 * @param {string|number} params.videoId
 * @param {string} params.clientKey - Unique fingerprint (e.g. userId_videoId or ip_videoId)
 * @param {number} params.watchTime - Accumulated active playback time in seconds
 * @param {number} params.duration - Total video duration in seconds
 */
export async function recordVerifiedView({ videoId, clientKey, watchTime, duration }) {
  if (!videoId) {
    return { success: false, error: 'Video ID is required' };
  }

  const vId = String(videoId);
  const now = Date.now();

  // 1. ตรวจสอบเงื่อนไขเวลาในการรับชมจริง (Watch Time Threshold)
  // ต้องดูอย่างน้อย 15 วินาที หรือ 30% ของคลิปหากเป็นคลิปสั้น
  const dur = Number(duration) || 0;
  const minRequiredSec = dur > 0 ? Math.min(15, Math.max(3, dur * 0.3)) : 15;
  const elapsed = Number(watchTime) || 0;

  if (elapsed < minRequiredSec) {
    return {
      success: false,
      counted: false,
      reason: 'insufficient_watch_time',
      message: `ต้องรับชมอย่างน้อย ${Math.ceil(minRequiredSec)} วินาที (ดูไปแล้ว ${elapsed} วินาที)`,
    };
  }

  // 2. ตรวจสอบ Cooldown ป้องกันการปั๊มวิวซ้ำ (F5 หรือเปิดดูซ้ำภายใน 15 นาที)
  const cooldownKey = `${clientKey}_${vId}`;
  const existingCooldown = viewCooldown.get(cooldownKey);

  if (existingCooldown && existingCooldown > now) {
    const remainingMin = Math.ceil((existingCooldown - now) / 60000);
    return {
      success: true,
      counted: false,
      reason: 'cooldown',
      message: `วิวนี้ถูกบันทึกไปแล้ว (Cooldown อีก ${remainingMin} นาที)`,
    };
  }

  // Set 15-minute cooldown
  viewCooldown.set(cooldownKey, now + COOLDOWN_MS);

  // 3. สะสมแต้มใน In-Memory Buffer
  const currentCount = (viewBuffer.get(vId) || 0) + 1;
  viewBuffer.set(vId, currentCount);

  console.log(`[ViewTracker] 📈 Video #${vId} buffer count: ${currentCount}/${BATCH_THRESHOLD}`);

  // 4. เงื่อนไข Batch: ถ้าครบ 5 วิว ให้เขียนลง Neon DB ทันที
  let flushed = false;
  if (currentCount >= BATCH_THRESHOLD) {
    await flushVideoViews(vId);
    flushed = true;
  }

  return {
    success: true,
    counted: true,
    flushed,
    bufferCount: flushed ? 0 : currentCount,
  };
}

/**
 * Get current pending buffer count (useful for UI preview or telemetry)
 */
export function getPendingBufferCount(videoId) {
  return viewBuffer.get(String(videoId)) || 0;
}
