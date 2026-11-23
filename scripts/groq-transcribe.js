/**
 * Groq Whisper ASR Client (`whisper-large-v3-turbo` -> fallback `whisper-large-v3`)
 * Uses OpenAI-compatible `/openai/v1/audio/transcriptions` with `verbose_json`
 * and segment + word timestamps for drift-free subtitle alignment.
 */

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const GROQ_TRANSCRIBE_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'];

const NO_SPACE_SCRIPT_END = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]$/;
const NO_SPACE_SCRIPT_START = /^[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;

const WHISPER_LANG_NAME_TO_CODE = {
  thai: 'th',
  japanese: 'ja',
  english: 'en',
  chinese: 'zh',
  mandarin: 'zh',
  cantonese: 'yue',
  korean: 'ko',
  vietnamese: 'vi',
  indonesian: 'id',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  russian: 'ru',
  portuguese: 'pt',
  italian: 'it',
  arabic: 'ar',
  hindi: 'hi',
};

// Known Whisper phantom hallucinations emitted during silence or music
const WHISPER_SILENCE_HALLUCINATION_RE =
  /^(?:thank you(?: very much)?(?: for watching)?\.?|thanks for watching\.?|subtitles by.*|subscribe.*|amara\.org.*|ご視聴ありがとうございました[。!！]?|字幕.*|请不吝点赞.*|谢谢观看[。!！]?|感谢观看[。!！]?|시청해 주셔서 감사합니다\.?|mbc 뉴스.*|♪+|\.+)$/i;

function normalizeGroqLanguageInput(langCode) {
  const code = String(langCode || '').trim().toLowerCase();
  if (!code || code === 'auto' || code === 'none') return '';
  if (code === 'yue' || code.startsWith('cmn') || code.startsWith('zh')) return 'zh';
  const base = code.split('-')[0];
  return /^[a-z]{2}$/.test(base) ? base : '';
}

export function mapWhisperLanguageToCode(rawLang) {
  const lower = String(rawLang || '').trim().toLowerCase();
  if (!lower) return '';
  if (WHISPER_LANG_NAME_TO_CODE[lower]) return WHISPER_LANG_NAME_TO_CODE[lower];
  if (/^[a-z]{2,3}$/.test(lower)) return lower;
  return '';
}

function joinWordText(prev, next) {
  if (!prev) return next;
  if (/^[\p{P}]/u.test(next) && !/^\p{Ps}/u.test(next)) return prev + next;
  if (/\p{Ps}$/u.test(prev)) return prev + next;
  if (NO_SPACE_SCRIPT_END.test(prev) && NO_SPACE_SCRIPT_START.test(next)) {
    return prev + next;
  }
  return `${prev} ${next}`;
}

function isLikelyHallucination(seg, text) {
  const noSpeech = Number(seg?.no_speech_prob);
  const avgLogProb = Number(seg?.avg_logprob);
  const compRatio = Number(seg?.compression_ratio);

  if (Number.isFinite(noSpeech) && noSpeech >= 0.82) return true;
  if (Number.isFinite(noSpeech) && noSpeech >= 0.6 && Number.isFinite(avgLogProb) && avgLogProb < -1.0) {
    return true;
  }
  if (Number.isFinite(compRatio) && compRatio > 2.8) return true;
  if (WHISPER_SILENCE_HALLUCINATION_RE.test(text) && (!Number.isFinite(noSpeech) || noSpeech >= 0.4)) {
    return true;
  }
  return false;
}

function splitLongSegmentUsingWords(seg, segWords, offsetMs, maxChunkMs) {
  const cues = [];
  let current = null;

  for (const w of segWords) {
    const wordText = String(w?.word || '').trim();
    if (!wordText) continue;
    const rawStart = Math.max(0, Math.round((Number(w.start) || 0) * 1000));
    const rawEnd = Math.max(rawStart + 80, Math.round((Number(w.end) || 0) * 1000));
    const startMs = offsetMs + Math.min(rawStart, Math.max(0, maxChunkMs - 80));
    const endMs = offsetMs + Math.min(rawEnd, maxChunkMs);

    const endsSentence = /[。．.!?？！]$/.test(current?.text || '');
    if (
      !current ||
      startMs - current.endMs >= 700 ||
      endMs - current.startMs > 5000 ||
      current.text.length + wordText.length > 58 ||
      (endsSentence && endMs - current.startMs >= 1600)
    ) {
      current = { startMs, endMs: Math.max(startMs + 150, endMs), text: wordText };
      cues.push(current);
    } else {
      current.text = joinWordText(current.text, wordText);
      current.endMs = Math.max(current.endMs, endMs);
    }
  }

  return cues;
}

export function groqVerboseJsonToCues(data, offsetMs = 0, chunkDurationSec = 600) {
  const maxChunkMs = Math.max(1000, Math.round((Number(chunkDurationSec) || 600) * 1000));
  const segments = Array.isArray(data?.segments) ? data.segments : [];
  const allWords = Array.isArray(data?.words) ? data.words : [];

  const rawCues = [];
  let repeatCount = 0;
  let lastNormText = '';

  for (const seg of segments) {
    const text = String(seg?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (isLikelyHallucination(seg, text)) continue;

    // Guard against Whisper looping the same short phrase 3+ times consecutively
    const norm = text.toLowerCase();
    if (norm === lastNormText) {
      repeatCount += 1;
      if (repeatCount >= 2) continue;
    } else {
      lastNormText = norm;
      repeatCount = 0;
    }

    const rawStartSec = Number(seg.start);
    const rawEndSec = Number(seg.end);
    if (!Number.isFinite(rawStartSec) || !Number.isFinite(rawEndSec)) continue;
    if (rawStartSec < -0.5 || rawStartSec > chunkDurationSec + 1.5) continue;

    const segDurSec = Math.max(0.15, rawEndSec - rawStartSec);

    // Split overly long segments using word-level timestamps when available
    if ((segDurSec > 6.5 || text.length > 68) && allWords.length > 0) {
      const segWords = allWords.filter((w) => {
        const ws = Number(w?.start);
        return Number.isFinite(ws) && ws >= rawStartSec - 0.12 && ws <= rawEndSec + 0.12;
      });
      if (segWords.length >= 2) {
        const splitCues = splitLongSegmentUsingWords(seg, segWords, offsetMs, maxChunkMs);
        if (splitCues.length > 0) {
          rawCues.push(...splitCues);
          continue;
        }
      }
    }

    const clampedStartMs = Math.max(0, Math.min(maxChunkMs - 80, Math.round(rawStartSec * 1000)));
    const clampedEndMs = Math.min(maxChunkMs, Math.max(clampedStartMs + 150, Math.round(rawEndSec * 1000)));
    rawCues.push({
      startMs: offsetMs + clampedStartMs,
      endMs: offsetMs + clampedEndMs,
      text,
    });
  }

  // Enforce strictly chronological non-overlapping cues
  rawCues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const cues = [];
  for (const cue of rawCues) {
    const prev = cues[cues.length - 1];
    if (prev && cue.startMs < prev.endMs) {
      if (cue.startMs > prev.startMs + 120) {
        prev.endMs = cue.startMs;
      } else {
        cue.startMs = prev.endMs;
        cue.endMs = Math.max(cue.startMs + 150, cue.endMs);
      }
    }
    cues.push(cue);
  }

  return cues;
}

export async function transcribeAudioWithGroq(
  audioBuffer,
  offsetMs,
  apiKey,
  request,
  { languageCode = '', chunkDurationSec = 600, logger = null, stepLabel = 'Groq Whisper' } = {}
) {
  if (!apiKey) throw new Error('Missing GROQ_API_KEY');
  const isoLang = normalizeGroqLanguageInput(languageCode);
  let lastError = null;

  for (const model of GROQ_TRANSCRIBE_MODELS) {
    const startMs = Date.now();
    try {
      const form = new FormData();
      form.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'audio_chunk.mp3');
      form.append('model', model);
      form.append('response_format', 'verbose_json');
      form.append('temperature', '0');
      form.append('timestamp_granularities[]', 'segment');
      form.append('timestamp_granularities[]', 'word');
      if (isoLang) {
        form.append('language', isoLang);
      }

      const res = await request(
        GROQ_TRANSCRIBE_URL,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
        },
        3,
        2500,
        120000,
        { retryOnTimeout: true, rateLimitDelayMs: 5000 }
      );

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const errMsg = `Groq ${model} HTTP ${res.status}: ${errBody.slice(0, 300)}`;
        lastError = new Error(errMsg);
        if (res.status === 429 || res.status >= 500 || res.status === 404) {
          if (logger) {
            await logger.log(`⚠️ ${stepLabel}: โมเดล "${model}" ตอบกลับ HTTP ${res.status} — ลองโมเดลสำรอง...`, {
              level: 'warn',
              toDb: true,
            });
          }
          continue;
        }
        throw lastError;
      }

      const data = await res.json();
      const cues = groqVerboseJsonToCues(data, offsetMs, chunkDurationSec);
      const detectedCode = mapWhisperLanguageToCode(data?.language) || isoLang;
      const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
      if (logger) {
        await logger.log(`⚡ ${stepLabel}: โมเดล "${model}" ถอดเสร็จใน ${elapsedSec}s (${cues.length} ประโยค)`, {
          toDb: false,
        });
      }
      return {
        cues,
        detectedCode,
        detectedName: String(data?.language || '').trim(),
        modelUsed: model,
      };
    } catch (err) {
      lastError = err;
      if (logger) {
        await logger.log(`⚠️ ${stepLabel}: โมเดล "${model}" ขัดข้อง (${err.message}) — ลองโมเดลสำรอง...`, {
          level: 'warn',
          toDb: true,
        });
      }
    }
  }

  throw lastError || new Error('Groq Whisper transcription failed for all models');
}
