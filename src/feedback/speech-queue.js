export function createSpeechQueue({
  gapMs = 350,
  duplicateWindowMs = 4500,
  now = () => Date.now(),
  delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  onError = () => {},
} = {}) {
  let waiting = [];
  let active = null;
  let draining = false;
  let generation = 0;
  let nextSequence = 0;
  let drainCancellation = null;
  const pendingKeys = new Set();
  const completedAtByKey = new Map();

  function reportError(error) {
    try {
      onError(error);
    } catch {
      // Error reporting must not prevent the queue from draining.
    }
  }

  function hasKey(eventKey) {
    return eventKey !== undefined && eventKey !== null;
  }

  function discardExpiredKeys(timestamp) {
    for (const [eventKey, completedAt] of completedAtByKey) {
      if (timestamp - completedAt >= duplicateWindowMs) {
        completedAtByKey.delete(eventKey);
      }
    }
  }

  function takeHighestPriorityFifo() {
    waiting.sort((left, right) => (
      right.priority - left.priority || left.sequence - right.sequence
    ));
    return waiting.shift();
  }

  async function drain(token) {
    if (draining || waiting.length === 0) return;
    draining = true;

    let releaseDrainCancellation;
    const drainCancelled = new Promise((resolve) => {
      releaseDrainCancellation = resolve;
    });
    drainCancellation = { token, release: releaseDrainCancellation };

    try {
      while (token === generation && waiting.length > 0) {
        const item = takeHighestPriorityFifo();
        let releaseCancellation;
        const cancellation = new Promise((resolve) => {
          releaseCancellation = resolve;
        });
        active = { item, releaseCancellation };
        const playback = Promise.resolve().then(item.play);
        playback.catch((error) => {
          if (token === generation) reportError(error);
        });

        try {
          await Promise.race([playback, cancellation]);
          if (token !== generation) break;
          if (hasKey(item.eventKey)) {
            const timestamp = now();
            discardExpiredKeys(timestamp);
            completedAtByKey.set(item.eventKey, timestamp);
          }
        } catch {
          // The playback rejection was reported by the attached handler.
        } finally {
          if (active?.item === item) active = null;
          if (hasKey(item.eventKey)) pendingKeys.delete(item.eventKey);
        }

        if (token === generation && waiting.length > 0) {
          try {
            await Promise.race([
              Promise.resolve().then(() => delay(gapMs)),
              drainCancelled,
            ]);
          } catch (error) {
            if (token === generation) reportError(error);
          }
        }
      }
    } finally {
      draining = false;
      if (drainCancellation?.token === token) drainCancellation = null;
      if (waiting.length > 0) void drain(generation);
    }
  }

  function enqueue({ eventKey, priority = 0, play, cancel } = {}) {
    if (hasKey(eventKey)) {
      const timestamp = now();
      discardExpiredKeys(timestamp);
      if (pendingKeys.has(eventKey)) return false;
      const completedAt = completedAtByKey.get(eventKey);
      if (
        completedAt !== undefined &&
        timestamp - completedAt < duplicateWindowMs
      ) {
        return false;
      }
      pendingKeys.add(eventKey);
    }

    waiting.push({
      eventKey,
      priority,
      play,
      cancel,
      sequence: nextSequence++,
    });
    void drain(generation);
    return true;
  }

  function clearPending() {
    for (const item of waiting) {
      if (hasKey(item.eventKey)) pendingKeys.delete(item.eventKey);
    }
    waiting = [];
  }

  function cancel() {
    generation += 1;
    clearPending();
    const current = active;
    if (current?.item && hasKey(current.item.eventKey)) {
      pendingKeys.delete(current.item.eventKey);
    }

    try {
      Promise.resolve(current?.item.cancel?.()).catch(reportError);
    } catch (error) {
      reportError(error);
    } finally {
      current?.releaseCancellation();
      drainCancellation?.release();
    }
  }

  return { enqueue, clearPending, cancel };
}
