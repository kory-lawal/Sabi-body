# Global Speech Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every SabiBody spoken output through one priority queue so current speech always finishes before the next statement begins.

**Architecture:** Add a shared queue that owns ordering, deduplication, pacing, cancellation, and playback-error recovery. Keep browser speech and YarnGPT audio as output adapters; route feedback, tests, and diagnostics through the queue without changing the YarnGPT service or request payload.

**Tech Stack:** JavaScript ES modules, browser `SpeechSynthesis`, HTML audio playback, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-11-13-global-speech-queue-design.md`

## Global Constraints

- Keep English on browser speech and keep the existing YarnGPT provider, language selection, endpoints, and request payloads unchanged.
- Never interrupt the active statement to play a higher-priority announcement.
- Select the highest-priority waiting announcement next; preserve FIFO order among equal priorities.
- Coalesce duplicate event keys while queued or active and suppress the same key for 4.5 seconds after completion.
- Use priorities 100 (completion and audio diagnostics), 80 (essential form correction), 70 (controls and countdowns), 50 (rep count), and 30 (routine encouragement and milestones).
- Insert a 350 ms pause between completed statements.
- Use playback rate 0.92 for browser speech and YarnGPT audio; preserve audio pitch where supported.
- Explicit voice-off and language changes may cancel current speech and clear waiting announcements; workout completion must not cancel the active statement.
- Do not redesign UI or add a TTS provider.

---

## File Map

- Create `src/feedback/speech-queue.js`: one scheduler for queueing, priority, deduplication, inter-statement delay, cancellation, and failure recovery.
- Create `test/speech-queue.test.js`: deterministic tests of serialization, stable priority ordering, deduplication, delay, cancellation, and errors.
- Modify `src/feedback/speech.js`: make browser speech an adapter whose promise settles on utterance end/error; apply the moderate rate.
- Modify `test/feedback.test.js`: verify browser adapter completion, language restrictions, rate, cancellation, and errors.
- Modify `src/feedback/voice-playback.js`: make YarnGPT/local audio playback wait for end/error and apply rate/pitch settings; remove independent interruption and deduplication policy.
- Modify `test/voice-playback.test.js`: verify full playback lifecycle, resource release, cancellation, and playback rate.
- Modify `src/ui/app.js`: create/inject one queue, assign event priorities/keys, route all speech and audio playback through it, and adjust lifecycle cancellation.
- Modify `test/app.test.js`: verify controller feedback, YarnGPT, voice tests, diagnostics, and workout lifecycle all use the shared queue.

## Task 1: Create the Shared Queue

**Files:**
- Create: `src/feedback/speech-queue.js`
- Test: `test/speech-queue.test.js`

**Interfaces:**
- Produces `createSpeechQueue({ gapMs = 350, duplicateWindowMs = 4500, now, delay, onError })`.
- `queue.enqueue({ eventKey, priority = 0, play, cancel })` returns `true` when accepted and `false` for a duplicate.
- `queue.clearPending()` discards waiting entries without interrupting the active entry.
- `queue.cancel()` clears waiting entries and calls the active entry's cancellation callback.
- `play()` returns a promise that settles when the statement ends; a rejection is reported and does not prevent later entries from running.

- [ ] **Step 1: Write a failing serialization and priority test**

Add a test that enqueues a long-running routine item, then a completion item and another same-priority item. Assert only the first begins before its end promise resolves; afterward the completion item begins before the routine item, and the same-priority items retain arrival order.

```js
test('does not interrupt active speech and selects waiting items by stable priority', async () => {
  const starts = [];
  let finishActive;
  const queue = createSpeechQueue({ delay: async () => {} });
  const play = (name, wait = false) => () => {
    starts.push(name);
    return wait ? new Promise((resolve) => { finishActive = resolve; }) : undefined;
  };

  queue.enqueue({ eventKey: 'routine-1', priority: 30, play: play('routine-1', true) });
  queue.enqueue({ eventKey: 'complete', priority: 100, play: play('complete') });
  queue.enqueue({ eventKey: 'correction', priority: 80, play: play('correction') });
  queue.enqueue({ eventKey: 'correction-2', priority: 80, play: play('correction-2') });
  assert.deepEqual(starts, ['routine-1']);

  finishActive();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, ['routine-1', 'complete', 'correction', 'correction-2']);
});
```

- [ ] **Step 2: Run the queue test and confirm it fails because the module is missing**

Run: `node --test test\speech-queue.test.js`

Expected: FAIL with the missing-module error for `src/feedback/speech-queue.js`.

- [ ] **Step 3: Add the queue implementation**

Implement a stable priority queue ordered by descending priority and ascending insertion sequence. Track the active item and event keys in both waiting and active states. Record completed event-key timestamps for the 4.5-second duplicate window. Start the next item only after the prior `play()` settles and the injected `delay(350)` resolves. In `finally`, release the active slot even if `play()` or `cancel()` throws; report non-cancellation failures through `onError` and continue draining. Use a generation token so a late promise from a cancelled item cannot alter the new queue state.

Use this drain shape so arrival of a higher-priority item only affects the next selection:

```js
async function drain(token) {
  if (draining || waiting.length === 0) return;
  draining = true;
  try {
    while (token === generation && waiting.length > 0) {
      const item = takeHighestPriorityFifo();
      let releaseCancellation;
      const cancellation = new Promise((resolve) => { releaseCancellation = resolve; });
      active = { item, releaseCancellation };
      const playback = Promise.resolve().then(item.play);
      playback.catch((error) => {
        if (token === generation) onError(error);
      });
      try {
        await Promise.race([playback, cancellation]);
        if (token !== generation) break;
        rememberCompletedKey(item.eventKey, now());
      } catch {
        // The playback rejection was reported by the attached handler.
      }
      if (active?.item === item) active = null;
      if (token === generation && waiting.length > 0) {
        await Promise.race([delay(gapMs), cancellation]);
      }
    }
  } finally {
    draining = false;
    if (waiting.length > 0) void drain(generation);
  }
}
```

`cancel()` increments `generation`, clears `waiting`, invokes the active
adapter's `cancel()` inside `try/catch`, and resolves the active cancellation
promise in `finally` so a broken adapter cannot keep the drain loop pending.
Late completion or rejection from that old generation is ignored.

- [ ] **Step 4: Add failing deduplication, gap, and recovery tests**

Test that the same key is rejected while queued, active, and during its 4.5-second post-completion window; a different key is accepted. Inject a `delay` spy and assert it is called with `350` between consecutive completed items. Make one item reject and assert the next item still runs and `onError` receives the failure. Cancel a pending active item and assert its cancellation callback is called and queued items are cleared.

```js
test('coalesces duplicate keys and continues after a playback error', async () => {
  const starts = [];
  const errors = [];
  const queue = createSpeechQueue({
    delay: async () => {},
    onError: (error) => errors.push(error),
  });
  queue.enqueue({
    eventKey: 'same',
    play: async () => { starts.push('first'); },
  });
  assert.equal(queue.enqueue({
    eventKey: 'same',
    play: async () => { starts.push('duplicate'); },
  }), false);
  queue.enqueue({
    eventKey: 'broken',
    priority: 1,
    play: async () => { throw new Error('device error'); },
  });
  queue.enqueue({
    eventKey: 'after-error',
    play: async () => { starts.push('after-error'); },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, ['first', 'after-error']);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /device error/);
});
```

- [ ] **Step 5: Run the queue tests and confirm they pass**

Run: `node --test test\speech-queue.test.js`

Expected: all queue tests pass with no overlapping starts, correct priority/FIFO order, and no stalled queue after cancellation or failure.

## Task 2: Adapt Browser Speech

**Files:**
- Modify: `src/feedback/speech.js`
- Test: `test/feedback.test.js`

**Interfaces:**
- Consumes the `play()` callback contract from Task 1 when called by the controller.
- `createSpeechCoach({ synthesis, Utterance, onError })` returns `setEnabled(nextEnabled)`, `speak(messageId, text, languageCode)`, and `cancel()`.
- `speak()` returns a promise that settles on the utterance's `onend` or `onerror`; it does not schedule another statement itself.

- [ ] **Step 1: Write a failing browser speech lifecycle test**

Assert `speak()` sets `lang = 'en'` and `rate = 0.92`, remains pending until `onend`, and then resolves. Assert non-English language and disabled speech do not call `synthesis.speak`. Start a second utterance, call `cancel()`, and verify its adapter promise settles rather than remaining pending.

```js
test('browser speech resolves only after the utterance ends at a moderate rate', async () => {
  const harness = createSpeechHarness();
  const coach = createSpeechCoach(harness);
  coach.setEnabled(true);
  let finished = false;
  const spoken = coach.speak('great-job', 'Great work!', 'en').then(() => { finished = true; });

  assert.equal(harness.spoken[0].rate, 0.92);
  assert.equal(finished, false);
  harness.spoken[0].onend();
  await spoken;
  assert.equal(finished, true);
});
```

- [ ] **Step 2: Run the targeted feedback tests and confirm the expected failure**

Run: `node --test --test-name-pattern="speech" test\feedback.test.js`

Expected: the new test fails because the current adapter returns immediately and does not set a rate.

- [ ] **Step 3: Change the adapter to await utterance completion**

Create the utterance, set English language and rate `0.92`, and return a promise settled by `onend`/`onerror`. Wrap synchronous `synthesis.speak` failures and asynchronous utterance errors in explicit errors for the queue's error handler. Make cancellation safely call `synthesis.cancel()` without leaving the adapter's completion promise pending.

The lifecycle must be tied to the utterance events, not the return value of `synthesis.speak`:

```js
return new Promise((resolve, reject) => {
  utterance.onend = () => resolve(true);
  utterance.onerror = (event) => reject(new Error('Speech synthesis failed.', { cause: event }));
  try {
    synthesis.speak(utterance);
  } catch (error) {
    reject(new Error('Speech synthesis is unavailable.', { cause: error }));
  }
});
```

- [ ] **Step 4: Run feedback tests**

Run: `node --test --test-name-pattern="speech" test\feedback.test.js`

Expected: English speech completion, rate, disabled-language behavior, cancellation, and failure tests pass.

## Task 3: Adapt YarnGPT and Local Audio Playback

**Files:**
- Modify: `src/feedback/voice-playback.js`
- Test: `test/voice-playback.test.js`

**Interfaces:**
- `voicePlayback.play(blob, options)` is a queue adapter and resolves only after the audio `ended` event.
- `voicePlayback.stop()` cancels the active adapter operation and settles its promise as cancelled.
- `setMuted()` and `setVolume()` retain their current user-preference behavior.

- [ ] **Step 1: Write a failing playback-completion test**

Start `play(blob)`, assert its promise remains pending until the fake audio fires `onended`, then assert it resolves successfully. Assert the audio uses `playbackRate = 0.92` and enables pitch preservation where the audio element exposes that property. Start another item, call `stop()`, and assert its promise settles as cancelled.

```js
test('audio playback waits for ended and uses moderate pitch-preserving playback', async () => {
  const harness = createAudioHarness();
  const manager = createVoicePlaybackManager(harness);
  let finished = false;
  const playback = manager.play(new Blob(['voice'])).then((result) => {
    finished = true;
    return result;
  });

  assert.equal(finished, false);
  assert.equal(harness.created[0].playbackRate, 0.92);
  assert.equal(harness.created[0].preservesPitch, true);
  harness.created[0].onended();
  assert.equal(await playback, true);
});
```

- [ ] **Step 2: Run the targeted playback tests and confirm the expected failure**

Run: `node --test test\voice-playback.test.js`

Expected: the new test fails because `play()` currently resolves as soon as the browser accepts playback.

- [ ] **Step 3: Make playback wait for its end/error event**

Return a promise tied to `onended` and `onerror`. On `stop()`, release the audio and object URL and settle the active promise as cancelled. Remove the playback manager's priority replacement and event-key cooldown logic; the shared queue now owns those policies. Preserve the explicit `allowMuted` path used by the local audio diagnostic.

Resolve the active playback promise from its event handlers and keep `play()` pending after `HTMLAudioElement.play()` succeeds:

```js
nextAudio.playbackRate = 0.92;
if ('preservesPitch' in nextAudio) nextAudio.preservesPitch = true;
nextAudio.onended = () => finish(true);
nextAudio.onerror = (event) => finishWithError(event);
await nextAudio.play();
return await ended;
```

- [ ] **Step 4: Run the playback tests**

Run: `node --test test\voice-playback.test.js`

Expected: playback completion, stop, autoplay rejection, audio error cleanup, mute, volume, and pitch/rate tests pass.

## Task 4: Route Every Announcement Through the Queue

**Files:**
- Modify: `src/ui/app.js`
- Test: `test/app.test.js`

**Interfaces:**
- `createWorkoutController` accepts an optional `speechQueue`; create one queue when none is injected.
- Every queue entry uses the controller's stable `voiceEventKey` and the priority levels defined above.
- English feedback and English voice tests enqueue a task that calls the browser speech adapter.
- Localized feedback and YarnGPT voice tests enqueue a task that synthesizes with the existing `audioCoach` and then awaits `voicePlayback.play`.
- Local audio diagnostics enqueue their existing local sample with priority `100` and `allowMuted: true`.

- [ ] **Step 1: Add a failing shared-queue routing test**

Inject a queue spy into `createWorkoutController`, trigger several distinct English feedback events close together and a localized YarnGPT event, and assert all eligible distinct events use the same queue with stable event keys and the specified priorities. Assert a duplicate event key is offered only once and adapter callbacks are not invoked until the queue runs them. This fails against the current app-wide cooldown because it drops a different event that arrives inside 4.5 seconds.

- [ ] **Step 2: Run the targeted controller test and confirm it fails**

Run: `node --test --test-name-pattern="shared speech queue" test\app.test.js`

Expected: FAIL because the controller currently calls browser speech and audio playback independently.

- [ ] **Step 3: Wire the shared queue into all speech paths**

Create or accept one queue in `createWorkoutController`. In `setFeedback`, enqueue English and YarnGPT messages instead of starting either adapter directly. Apply priority `100` to completion, `80` to essential form corrections, `70` to countdown/control messages, `50` to repetition counts, and `30` to routine encouragement/milestones. Route `generateVoiceTest`, `playPreparedVoiceTest`, and `playBrowserAudioTest` through the same queue.

Replace the global 4.5-second suppression between different feedback events with the queue's per-event deduplication; retain the selected coach personality's speakability rules and the distinct repetition-count setting. Replace direct speech/audio stops in workout completion and pause with `clearPending()` so the active statement finishes; do not increment the YarnGPT generation token for completion or pause. Clear waiting announcements on reset/end to prevent stale coaching after navigation, but let the active statement finish. Enqueue the completion/pause announcement at its priority. Use full queue cancellation and increment the generation token only for explicit voice-off and language changes. Guard delayed YarnGPT results after explicit cancellation so stale synthesis is never played. Keep the existing voice catalog selection, request payload, and preference handling intact.

Use one helper for browser speech so feedback and the English voice test cannot diverge:

```js
function enqueueBrowserSpeech(messageId, text, languageCode, eventKey, priority) {
  return speechQueue.enqueue({
    eventKey,
    priority,
    play: () => coach.speak(messageId, text, languageCode),
    cancel: () => coach.cancel(),
  });
}
```

For YarnGPT output, enqueue the whole generate-then-play task, and make its
`cancel` callback stop the audio adapter. Check the captured voice generation
after synthesis and before playback. For browser audio diagnostics, enqueue
`playbackManager.play(createBrowserAudioSample(), { allowMuted: true })`.

- [ ] **Step 4: Update controller tests for queue-backed playback**

Retain assertions for language/voice selection and speech status. Update tests that assumed audio starts synchronously so they drain the queue's fake playback task and fire its end callback. Add a controller test that queues a routine message followed by completion and verifies completion waits for the active message but runs before other waiting messages.

- [ ] **Step 5: Run the focused controller and adapter tests**

Run: `node --test test\speech-queue.test.js test\feedback.test.js test\voice-playback.test.js test\app.test.js`

Expected: all focused tests pass, including the shared queue path for all announcement sources.

- [ ] **Step 6: Run final validation**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: Vite produces the production bundle successfully.
