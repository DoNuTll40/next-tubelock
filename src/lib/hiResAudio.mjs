const START_BUFFER_SECONDS = 4;
const LOW_BUFFER_SECONDS = 0.35;
const SEEK_DRIFT_SECONDS = 0.35;
const RESUME_DRIFT_SECONDS = 0.08;
const CLOCK_DRIFT_SECONDS = 0.06;
const END_TOLERANCE_SECONDS = 0.05;

export function getMediaBufferAhead(media, time) {
  const ranges = media?.buffered;
  if (!ranges || !Number.isFinite(time)) return 0;

  for (let index = 0; index < ranges.length; index++) {
    if (ranges.start(index) <= time && time < ranges.end(index)) {
      return ranges.end(index) - time;
    }
  }
  return 0;
}

export function connectHiResAudio(video, audio, {
  url, isActive, onStatus, onPlayBlocked, startPlaying = false,
}) {
  let playRequested = startPlaying;
  let running = false;
  let needsSeek = true;
  let pendingStart = null;
  let status;

  video.muted = true;

  function report(nextStatus) {
    if (status === nextStatus) return;
    status = nextStatus;
    onStatus(status);
  }

  function hold(nextStatus) {
    running = false;
    pendingStart = null;
    if (!audio.paused) audio.pause();
    if (!video.paused) video.pause();
    report(nextStatus);
  }

  function start(audioFinished) {
    const attempt = {};
    pendingStart = attempt;
    video.muted = true;
    const audioPlay = audioFinished ? Promise.resolve() : audio.play();
    Promise.all([audioPlay, video.play()]).then(() => {
      if (pendingStart !== attempt) return;
      pendingStart = null;
      running = true;
      report('ready');
    }).catch((error) => {
      if (pendingStart !== attempt) return;
      if (error?.name === 'AbortError') {
        hold('loading');
      } else {
        playRequested = false;
        hold(error?.name === 'NotAllowedError' ? 'idle' : 'error');
        if (error?.name === 'NotAllowedError') onPlayBlocked?.();
      }
    });
  }

  function update() {
    if (!playRequested || status === 'error' || video.ended) return;
    if (!isActive() || video.readyState < 3 || video.seeking || video.error || audio.readyState < 1 || audio.seeking) {
      hold('loading');
      return;
    }

    const time = video.currentTime;
    const rate = video.playbackRate;
    const remaining = Number.isFinite(audio.duration) ? audio.duration - time : Infinity;
    // The actual lossless track can end slightly before the last video frame.
    const audioFinished = remaining <= (audio.ended ? LOW_BUFFER_SECONDS : END_TOLERANCE_SECONDS);
    if (audioFinished) {
      if (!pendingStart && !running) start(true);
      return;
    }
    const buffer = getMediaBufferAhead(audio, time);
    const drift = audio.currentTime - time;
    const warmup = Math.min(START_BUFFER_SECONDS * rate, remaining - END_TOLERANCE_SECONDS);
    if (running) {
      if (audio.readyState < 3 || buffer < Math.min(LOW_BUFFER_SECONDS * rate, warmup)
        || Math.abs(drift) > SEEK_DRIFT_SECONDS) {
        hold('loading');
        return;
      }
      const correction = Math.abs(drift) > CLOCK_DRIFT_SECONDS ? 1 - Math.sign(drift) * 0.02 : 1;
      const audioRate = rate * correction;
      if (audio.playbackRate !== audioRate) audio.playbackRate = audioRate;
      return;
    }
    if (pendingStart) return;

    const canAlign = needsSeek || buffer >= warmup;
    needsSeek = false;
    if (canAlign && Math.abs(drift) > RESUME_DRIFT_SECONDS) {
      hold('loading');
      audio.currentTime = time;
      return;
    }
    if (audio.readyState < 3 || buffer < warmup) {
      hold('loading');
      return;
    }
    audio.playbackRate = rate;
    start(false);
  }

  function play() {
    if (status === 'error') {
      needsSeek = true;
      audio.load();
    }
    playRequested = true;
    if (!running && !pendingStart) report('loading');
    update();
  }

  function pause() {
    playRequested = false;
    hold(status === 'error' ? 'error' : 'idle');
  }

  function onVideoPlay() {
    if (video.paused || pendingStart || running) return;
    if (status === 'error') video.pause();
    else play();
  }

  function onVideoPause() {
    if (video.paused && (running || pendingStart)) pause();
  }

  function onWaiting() {
    if (playRequested && status !== 'error' && !video.ended && !audio.ended) hold('loading');
  }

  function onVideoSeeking() {
    needsSeek = true;
    if (playRequested) hold(status === 'error' ? 'error' : 'loading');
  }

  function onAudioError() {
    playRequested = false;
    hold('error');
  }

  function keepVideoMuted() {
    if (!video.muted) video.muted = true;
  }

  const videoEvents = {
    play: onVideoPlay, pause: onVideoPause, ended: pause, waiting: onWaiting,
    seeking: onVideoSeeking, seeked: update, canplay: update, progress: update, ratechange: update,
    volumechange: keepVideoMuted, error: update,
  };
  const audioEvents = {
    loadedmetadata: update, progress: update, canplay: update, seeked: update,
    waiting: onWaiting, error: onAudioError,
  };

  for (const [event, handler] of Object.entries(videoEvents)) video.addEventListener(event, handler);
  for (const [event, handler] of Object.entries(audioEvents)) audio.addEventListener(event, handler);
  if (audio.getAttribute('src') !== url) {
    audio.src = url;
    audio.load();
  }

  const timer = setInterval(update, 125);
  report(playRequested ? 'loading' : 'idle');
  update();

  function disconnect() {
    playRequested = false;
    pendingStart = null;
    clearInterval(timer);
    for (const [event, handler] of Object.entries(videoEvents)) video.removeEventListener(event, handler);
    for (const [event, handler] of Object.entries(audioEvents)) audio.removeEventListener(event, handler);
    audio.pause();
  }

  return { play, pause, isPlayRequested: () => playRequested, disconnect };
}
