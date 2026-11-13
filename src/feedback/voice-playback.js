export function createVoicePlaybackManager({
  audioFactory = () => new Audio(),
  URLApi = globalThis.URL,
  onError = () => {},
  now = () => Date.now(),
  cooldownMs = 4500,
} = {}) {
  let audio = null;
  let audioUrl = null;
  let volume = 1;
  let muted = false;
  let currentPriority = -Infinity;
  let generation = 0;
  let currentEventKey = null;
  const lastPlayedByEvent = new Map();
  const pendingByEvent = new Map();

  function releaseCurrent() {
    if (
      currentEventKey &&
      pendingByEvent.get(currentEventKey) === generation
    ) {
      pendingByEvent.delete(currentEventKey);
    }
    currentEventKey = null;
    generation += 1;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.removeAttribute?.('src');
        audio.load?.();
      } catch {
        // Releasing the object URL still lets the browser collect the audio.
      }
      audio = null;
    }
    if (audioUrl) {
      URLApi.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    currentPriority = -Infinity;
  }

  function stop() {
    releaseCurrent();
  }

  async function play(blob, { priority = 0, eventKey, allowMuted = false, onEnded } = {}) {
    if (muted && !allowMuted) {
      return false;
    }
    if (audio && priority < currentPriority) {
      return false;
    }

    const timestamp = now();
    if (
      eventKey &&
      (pendingByEvent.has(eventKey) ||
        timestamp - (lastPlayedByEvent.get(eventKey) ?? -Infinity) < cooldownMs)
    ) {
      return false;
    }

    releaseCurrent();
    const playbackGeneration = generation;
    currentEventKey = eventKey ?? null;
    if (eventKey) {
      pendingByEvent.set(eventKey, playbackGeneration);
    }
    let nextAudio;
    let nextUrl;
    try {
      nextAudio = audioFactory();
      nextUrl = URLApi.createObjectURL(blob);
    } catch (error) {
      releaseCurrent();
      onError(error);
      throw error;
    }
    audio = nextAudio;
    audioUrl = nextUrl;
    currentPriority = priority;
    nextAudio.volume = volume;
    nextAudio.src = nextUrl;
    nextAudio.onended = () => {
      if (audio === nextAudio) {
        releaseCurrent();
      }
      onEnded?.();
    };
    nextAudio.onerror = (event) => {
      const error = new Error('Audio playback failed. Check browser audio permissions and try Test Voice.');
      error.cause = event;
      onError(error);
      if (audio === nextAudio) {
        releaseCurrent();
      }
    };

    try {
      await nextAudio.play();
      if (generation !== playbackGeneration || audio !== nextAudio || (muted && !allowMuted)) {
        try {
          nextAudio.pause();
          nextAudio.currentTime = 0;
        } catch {
          // A stale play promise must not restart speech after cancellation.
        }
        return false;
      }
      if (eventKey) {
        lastPlayedByEvent.set(eventKey, timestamp);
      }
      return true;
    } catch (error) {
      if (audio === nextAudio) {
        releaseCurrent();
      }
      const playbackError = error?.name === 'NotAllowedError'
        ? new Error(
          'Audio playback was blocked by browser autoplay protection. Interact with the page and try Test Voice again.',
          { cause: error },
        )
        : error;
      onError(playbackError);
      throw playbackError;
    }
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    if (muted) {
      stop();
    }
  }

  function setVolume(nextVolume) {
    const parsed = Number(nextVolume);
    if (!Number.isFinite(parsed)) {
      return;
    }
    volume = Math.min(1, Math.max(0, parsed));
    if (audio) {
      audio.volume = volume;
    }
  }

  return { play, stop, setMuted, setVolume };
}