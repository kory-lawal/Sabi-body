export function createSpeechCoach({
  synthesis,
  Utterance,
  onError = () => {},
}) {
  let enabled = false;
  let activeSpeech = null;

  function reportError(error) {
    try {
      onError(error);
    } catch {
      // Error reporting must not replace the playback error.
    }
  }

  function settleActiveSpeech(result, error) {
    const active = activeSpeech;
    if (!active) {
      return;
    }

    activeSpeech = null;
    active.utterance.onend = null;
    active.utterance.onerror = null;
    if (error) {
      active.reject(error);
    } else {
      active.resolve(result);
    }
  }

  function cancel() {
    settleActiveSpeech(false);
    try {
      synthesis.cancel();
    } catch (error) {
      throw new Error('Speech synthesis could not be cancelled.', {
        cause: error,
      });
    }
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      cancel();
    }
  }

  function speak(messageId, text, languageCode) {
    if (!enabled || languageCode !== 'en') {
      return Promise.resolve(false);
    }

    let utterance;
    try {
      utterance = new Utterance(text);
      utterance.lang = 'en';
      utterance.rate = 0.92;
    } catch (error) {
      const unavailableError = new Error('Speech synthesis is unavailable.', { cause: error });
      reportError(unavailableError);
      return Promise.reject(unavailableError);
    }

    return new Promise((resolve, reject) => {
      activeSpeech = { utterance, resolve, reject };
      utterance.onend = () => settleActiveSpeech(true);
      utterance.onerror = (event) => {
        const error = new Error('Speech synthesis failed.', { cause: event });
        settleActiveSpeech(false, error);
        reportError(error);
      };

      try {
        synthesis.speak(utterance);
      } catch (error) {
        const speakError = new Error('Speech synthesis could not start.', { cause: error });
        settleActiveSpeech(false, speakError);
        reportError(speakError);
      }
    });
  }

  return { setEnabled, speak, cancel };
}
