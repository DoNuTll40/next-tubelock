const API = 'https://generativelanguage.googleapis.com';
export const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';

export function transcriptToCues(interaction, offsetMs = 0) {
  if (interaction.status !== 'completed') {
    throw new Error(`Transcription status: ${interaction.status || 'unknown'}`);
  }
  const content = (interaction.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((item) => item.type === 'text');
  if (!content.length) throw new Error('Transcription returned no text result');

  const cues = [];
  let cue;
  for (const word of content.flatMap((item) => item.annotations ?? [])) {
    if (word.type !== 'word_info' || !word.text?.trim()) continue;
    const start = Math.round(Number.parseFloat(word.start_offset) * 1000);
    const end = Math.round(Number.parseFloat(word.end_offset) * 1000);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      throw new Error('Transcription returned a word without valid timestamps');
    }
    const startMs = start + offsetMs;
    const endMs = Math.max(startMs + 1, end + offsetMs);
    const wordText = word.text.trim();
    const separator = /^[\p{P}]/u.test(wordText) && !/^\p{Ps}/u.test(wordText) ? '' : ' ';
    if (!cue || startMs - cue.endMs >= 700 || endMs - cue.startMs > 5000 ||
        cue.text.length + wordText.length > 64) {
      cue = { startMs, endMs, text: wordText };
      cues.push(cue);
    } else {
      cue.text += separator + wordText;
      cue.endMs = Math.max(cue.endMs, endMs);
    }
  }
  if (!cues.length && content.some((item) => item.text?.trim())) {
    throw new Error('Transcription returned text without word timestamps');
  }
  return cues;
}

export async function transcribeAudio(audio, offsetMs, apiKey, request) {
  const headers = { 'x-goog-api-key': apiKey };
  const start = await request(`${API}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(audio.length),
      'X-Goog-Upload-Header-Content-Type': 'audio/mpeg',
    },
    body: JSON.stringify({ file: { display_name: 'TubeLock subtitle audio' } }),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!start.ok || !uploadUrl) throw new Error(`Gemini upload start: HTTP ${start.status}`);

  const upload = await request(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: audio,
  }, 1);
  if (!upload.ok) throw new Error(`Gemini audio upload: HTTP ${upload.status}`);
  const { file } = await upload.json();
  if (!file?.uri || !file?.name) throw new Error('Gemini upload returned no file reference');

  try {
    const result = await request(`${API}/v1beta/interactions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TRANSCRIBE_MODEL,
        store: false,
        input: [{ type: 'audio', uri: file.uri, mime_type: file.mimeType || 'audio/mpeg' }],
        generation_config: {
          transcription_config: { mode: { type: 'verbatim', timestamp_granularities: ['word'] } },
        },
      }),
    }, 3, 2500, 180000, { retryOnTimeout: false });
    if (!result.ok) {
      const error = await result.json().catch(() => null);
      throw new Error(`Gemini Transcribe HTTP ${result.status}: ${error?.error?.message || result.statusText}`);
    }
    return transcriptToCues(await result.json(), offsetMs);
  } finally {
    await request(`${API}/v1beta/${file.name}`, { method: 'DELETE', headers }, 1, 0, 10000)
      .catch(() => {});
  }
}
