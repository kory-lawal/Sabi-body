export function createSpeechCoach({
  synthesis,
  Utterance,
  now = () => Date.now(),
  cooldownMs = 5000,
  onError = () => {},
}) {
  let enabled = false;
  let lastSpokenAt = -Infinity;

  function cancel() {
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
      return false;
    }

    const timestamp = now();
    if (timestamp - lastSpokenAt < cooldownMs) {
      return false;
    }

    try {
      const utterance = new Utterance(text);
      utterance.lang = 'en';
      utterance.onerror = (event) => {
        onError(new Error('Speech synthesis failed.', { cause: event }));
      };
      synthesis.speak(utterance);
      lastSpokenAt = timestamp;
    } catch (error) {
      throw new Error('Speech synthesis is unavailable.', { cause: error });
    }

    return true;
  }

  return { setEnabled, speak, cancel };
}
