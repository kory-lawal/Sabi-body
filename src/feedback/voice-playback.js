export function createVoicePlaybackManager({
  audioFactory = () => new Audio(),
  URLApi = globalThis.URL,
  onError = () => {},
} = {}) {
  let audio = null;
  let activePlayback = null;
  let volume = 1;
  let muted = false;

  function reportError(error) {
    try {
      onError(error);
    } catch {
      // Error reporting must not replace the playback error.
    }
  }

  function releasePlayback(playback, result, error) {
    if (!playback || activePlayback !== playback) {
      return;
    }

    activePlayback = null;
    audio = null;
    playback.audio.onended = null;
    playback.audio.onerror = null;
    try {
      playback.audio.pause();
      playback.audio.currentTime = 0;
      playback.audio.removeAttribute?.('src');
      playback.audio.load?.();
    } catch {
      // Releasing the object URL still lets the browser collect the audio.
    }
    if (playback.url) {
      try {
        URLApi.revokeObjectURL(playback.url);
      } catch {
        // A revocation failure must not leave the active playback promise pending.
      }
    }

    if (error) {
      playback.reject(error);
    } else {
      playback.resolve(result);
    }
  }

  function stop() {
    releasePlayback(activePlayback, false);
  }

  function play(blob, { allowMuted = false, onEnded } = {}) {
    if (muted && !allowMuted) {
      return Promise.resolve(false);
    }

    let nextAudio;
    let nextUrl;
    try {
      nextAudio = audioFactory();
      nextUrl = URLApi.createObjectURL(blob);
      nextAudio.volume = volume;
      nextAudio.playbackRate = 0.92;
      for (const pitchProperty of [
        'preservesPitch',
        'webkitPreservesPitch',
        'mozPreservesPitch',
      ]) {
        if (pitchProperty in nextAudio) {
          nextAudio[pitchProperty] = true;
        }
      }
      nextAudio.src = nextUrl;
    } catch (error) {
      try {
        nextAudio?.pause();
        if (nextUrl) {
          URLApi.revokeObjectURL(nextUrl);
        }
      } catch {
        // Preparation errors are reported even if partial cleanup also fails.
      }
      const preparationError = new Error('Audio playback could not be prepared.', {
        cause: error,
      });
      reportError(preparationError);
      return Promise.reject(preparationError);
    }
    audio = nextAudio;

    return new Promise((resolve, reject) => {
      const playback = {
        audio: nextAudio,
        url: nextUrl,
        resolve,
        reject,
      };
      activePlayback = playback;

      nextAudio.onended = () => {
        releasePlayback(playback, true);
        onEnded?.();
      };
      nextAudio.onerror = (event) => {
        const error = new Error(
          'Audio playback failed. Check browser audio permissions and try again.',
          { cause: event },
        );
        releasePlayback(playback, false, error);
        reportError(error);
      };

      function handlePlayFailure(cause) {
        if (activePlayback !== playback) {
          return;
        }
        const error = cause?.name === 'NotAllowedError'
          ? new Error(
            'Audio playback was blocked by browser autoplay protection. Interact with the page and check browser audio permissions, then try again.',
            { cause },
          )
          : new Error('Audio playback could not start.', { cause });
        releasePlayback(playback, false, error);
        reportError(error);
      }

      try {
        Promise.resolve(nextAudio.play()).catch(handlePlayFailure);
      } catch (error) {
        handlePlayFailure(error);
      }
    });
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
