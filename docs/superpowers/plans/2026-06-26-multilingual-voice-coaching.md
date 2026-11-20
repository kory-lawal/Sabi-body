# Multilingual Voice Coaching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver complete five-language predefined coaching phrases and serialized, completion-aware speech while preserving YarnGPT and existing workout behavior.

**Architecture:** Expand the shared coaching catalog as the only phrase source, retain its existing message lookup contract, and route browser speech plus YarnGPT audio through the existing queue. Remove the developer voice-test interface and translation disclaimer without changing workout detection, timing, voice preferences, or provider integration.

**Tech Stack:** JavaScript ES modules, Node.js built-in test runner, browser SpeechSynthesis and HTMLAudioElement, existing YarnGPT client/API.

**Spec:** `docs/superpowers/specs/2026-06-26-multilingual-voice-coaching-design.md`

## Global Constraints

- Each phrase ID has a fixed template for all five language codes (`en`, `yo`, `ig`, `ha`, `pcm`).
- Required catalog entries must not fall back to English.
- Dynamic values remain limited to approved numeric parameters such as `count`, `remaining`, and `target`; sentences are not generated or translated at runtime.
- The browser speech adapter remains English-only and uses rate `0.92`.
- YarnGPT audio playback uses rate `0.92` with pitch preservation where supported.
- The existing queue remains the only owner of ordering, deduplication, and the 350 ms inter-announcement pause.
- A higher priority announcement never interrupts active output.
- Explicit voice-off or language changes may cancel active output and discard stale waiting work.
- Preserve existing supported language codes, voice preferences, YarnGPT requests, workout controls, analyzer IDs, detection logic, counters, and plank timer behavior.
- Non-English entries remain marked unverified until reviewed by fluent speakers.
- Do not change the mobile, tablet, or desktop layout beyond removing the specified voice-testing and disclaimer UI.

---

## File Map

- Modify `api/src/shared/coaching-messages.js`: create the categorized five-language catalog; retain `hasCoachingMessage` and `translateCoachingMessage`; add the exercise-to-instruction mapping; remove only test-prompt phrases that become unused.
- Modify `src/feedback/messages.js`: re-export the catalog and exercise mapping needed by the workout controller and tests while preserving `LANGUAGES` and `translateMessage`.
- Modify `test/feedback.test.js`: assert complete category/language coverage, valid controlled interpolation, exercise-specific entries, and translation-status metadata.
- Modify `src/feedback/personality.js`: make the new exercise-instruction IDs eligible under existing coach-style rules; preserve current eligibility for all existing message IDs.
- Modify `src/feedback/speech.js`: make browser speech a completion-aware English output adapter with moderate rate and explicit cancellation settlement.
- Modify `src/feedback/voice-playback.js`: make YarnGPT audio playback wait for `ended`, clean up on stop/error, and remove its independent replacement/deduplication behavior.
- Modify `test/feedback.test.js` and `test/voice-playback.test.js`: test adapter lifecycle, rate, cancellation, and errors.
- Modify `src/ui/app.js`: create/use one queue, route coaching through it, announce the selected exercise's instruction, add the five-second plank cue from existing elapsed time, and remove test-only UI/controller flows.
- Modify `test/app.test.js`: replace voice-test workflow tests with actual coaching/queue tests; preserve language and voice-selection coverage; assert removed UI is absent.
- Delete `src/feedback/browser-audio-sample.js` after its only app/test references are removed.
- Modify `README.md`: describe the categorized catalog and retain the honest native-review guidance.
- Reuse `src/feedback/speech-queue.js` and `test/speech-queue.test.js`; change them only if integration reveals a focused defect in the existing queue contract.
- Do not modify the Python speech routes, `api/src/handlers.js`, `api/src/naijalingo-service.js`, `src/services/voice-client.js`, MediaPipe, or exercise analyzers.

---

### Task 1: Build the Categorized Phrase Catalog

**Files:**
- Modify: `api/src/shared/coaching-messages.js`
- Modify: `src/feedback/messages.js`
- Test: `test/feedback.test.js`

**Interfaces:**
- Produce `COACHING_PHRASES`, keyed by the six categories, with each phrase ID mapped to `{ en, yo, ig, ha, pcm }` fixed templates.
- Produce `EXERCISE_INSTRUCTION_IDS`, keyed by the existing IDs `squats`, `jumping-jacks`, `plank`, `push-ups`, `sit-ups`, and `lunges`.
- Preserve `hasCoachingMessage(messageId)` and `translateCoachingMessage(messageId, languageCode, parameters)`.
- Re-export `COACHING_PHRASES` and `EXERCISE_INSTRUCTION_IDS` through `src/feedback/messages.js`.

- [ ] **Step 1: Write catalog-completeness tests**

In `test/feedback.test.js`, import the catalog and mapping. Add a test that iterates every phrase in every category and checks the five exact locale keys and non-empty strings:

```js
const expectedLocales = ['en', 'yo', 'ig', 'ha', 'pcm'];
for (const [category, phrases] of Object.entries(COACHING_PHRASES)) {
  for (const [messageId, translations] of Object.entries(phrases)) {
    assert.deepEqual(
      Object.keys(translations).sort(),
      [...expectedLocales].sort(),
      `${category}/${messageId} must define all locales`,
    );
    for (const language of expectedLocales) {
      assert.ok(translations[language].trim(), `${messageId}/${language} must not be empty`);
      assert.equal(translateMessage(messageId, language).isFallback, false);
    }
  }
}
```

Add a mapping test asserting the six exercise IDs are all present, unique, and point to a phrase in the exercise-instruction group. Add interpolation tests proving `{count}`, `{remaining}`, and `{target}` use the supplied values while unapproved values are not interpolated.

- [ ] **Step 2: Run the focused tests and verify the missing coverage fails**

Run: `node --test test\feedback.test.js`

Expected: the new tests fail because the current flat dictionaries do not expose categorized phrases and do not contain all requested exercise instructions.

- [ ] **Step 3: Author the catalog and preserve compatibility**

Organize entries into these six categories and include the listed statements as fixed localized templates:

1. **Camera/body alignment:** position the phone for the whole body; move farther away; show head and feet; adjust position; stand straight; get ready; confirm clear visibility.
2. **Workout instructions:** let's begin; start slowly; bend knees; keep back straight; lower the body; push back up; balance; hold position; breathe; keep going; plus one distinct correct instruction for each of the six exercises.
3. **Motivation:** at least eight encouraging variants; select them deterministically in the controller, not randomly.
4. **Progress:** workout start, exact repetition count, halfway, approaching the target, target reached, and next exercise. Keep numeric values as controlled template parameters.
5. **Plank:** hold position, keep the body straight, hips up, keep holding, five seconds left, countdown encouragement, and completed-plank praise.
6. **Completion:** congratulations, workout complete, excellent work, rest, and pride in the effort.

Keep all currently used analyzer/controller message IDs, including camera corrections, `great-job`, `keep-going`, `repetition-count`, `milestone-reps`, `milestone-plank`, and completion IDs. Add localized entries for existing exercise-specific analyzer IDs instead of allowing an unknown-ID generic English fallback. Preserve English `verified` and non-English `unverified` metadata. Remove only the `test-count-sequence`, `test-positioning`, and `test-completion` prompt entries once their test UI callers are removed in Task 4.

Keep `translateCoachingMessage` output fields (`text`, `isFallback`, `translationStatus`) and its safe unknown-message behavior. Required phrases always resolve locally for all five languages; no runtime translation or AI phrase generation is introduced.

- [ ] **Step 4: Run catalog tests and verify all IDs and locales pass**

Run: `node --test test\feedback.test.js`

Expected: all six categories have complete locale maps; each selected exercise points to a different localized instruction; legacy lookup and translation-status tests pass.

- [ ] **Step 5: Commit the catalog change**

```powershell
git add -- api\src\shared\coaching-messages.js src\feedback\messages.js test\feedback.test.js
git commit -m "feat: add categorized multilingual coaching phrases" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Make Speech Adapters Await Completion

**Files:**
- Modify: `src/feedback/speech.js`
- Modify: `src/feedback/voice-playback.js`
- Test: `test/feedback.test.js`
- Test: `test/voice-playback.test.js`

**Interfaces:**
- `createSpeechCoach(...).speak(messageId, text, languageCode)` resolves `true` on `onend`, returns `false` when disabled/non-English/cancelled, and rejects on synthesis error.
- `createVoicePlaybackManager(...).play(blob)` resolves `true` only on audio `ended`, returns `false` when muted/cancelled, and rejects on playback error.
- `stop()` and `cancel()` settle active adapter operations so the queue can release its active slot.

- [ ] **Step 1: Add a browser speech completion test**

Update the speech harness in `test/feedback.test.js` so the fake utterance exposes event handlers. Assert that `speak` remains pending until `onend`, sets `lang` to `en` and `rate` to `0.92`, resolves `true` after `onend`, and rejects after `onerror`. Keep tests proving non-English messages are not sent to browser speech.

- [ ] **Step 2: Run the browser speech tests and confirm the new lifecycle assertion fails**

Run: `node --test --test-name-pattern="speech" test\feedback.test.js`

Expected: current speech returns synchronously and does not wait for `onend`.

- [ ] **Step 3: Implement the browser adapter lifecycle**

Remove the adapter's independent five-second cooldown; the queue owns duplicate suppression. Keep enabled and English-language guards. Set the utterance language and rate before calling synthesis. Resolve only on `onend`, reject with a useful error on `onerror` or a synchronous `synthesis.speak` failure, and settle the active utterance as cancelled when `cancel()` or `setEnabled(false)` is called.

- [ ] **Step 4: Add audio end, cancellation, and rate tests**

Update `createAudioHarness` in `test/voice-playback.test.js` to expose `onended`, `onerror`, `playbackRate`, and pitch-preservation properties. Assert `play()` stays pending until `onended`; `stop()` resolves a pending playback as `false`; an audio error rejects and releases the object URL; `playbackRate` is `0.92`; and pitch is preserved where supported. Retain mute and volume tests.

- [ ] **Step 5: Make the audio adapter completion-aware**

Remove `currentPriority`, direct interruption/replacement, and `lastPlayedByEvent`/`pendingByEvent`; those policies belong to the shared queue. Keep URL creation/revocation, volume, mute, and `allowMuted` behavior only if still used by production code. Set moderate playback rate and pitch preservation where available. Resolve from `onended`; reject after cleanup on `onerror` or a rejected `audio.play()`; make `stop()` clean up and settle as cancelled. Replace error copy that tells users to use “Test Voice” with useful browser-permission guidance.

- [ ] **Step 6: Run adapter tests and commit**

Run:

```powershell
node --test test\feedback.test.js test\voice-playback.test.js
```

Expected: both adapters await completion, cancellation releases their promises, errors are explicit, and existing volume/mute/language restrictions remain.

```powershell
git add -- src\feedback\speech.js src\feedback\voice-playback.js test\feedback.test.js test\voice-playback.test.js
git commit -m "fix: await coaching speech playback completion" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Route Workout Coaching Through One Queue

**Files:**
- Modify: `src/ui/app.js`
- Modify: `src/feedback/personality.js`
- Test: `test/app.test.js`
- Reuse: `src/feedback/speech-queue.js`
- Reuse: `test/speech-queue.test.js`

**Interfaces:**
- `createWorkoutController` accepts optional `speechQueue`; when omitted, it creates exactly one queue for that controller.
- Every eligible coaching event enqueues `{ eventKey, priority, play, cancel }` on that queue.
- Priorities: workout completion `100`; essential corrections `80`; controls/countdown `70`; repetitions `50`; routine feedback/milestones `30`.
- Localized queue work performs voice resolution, YarnGPT synthesis, and awaited playback inside the queue item's `play` callback.

- [ ] **Step 1: Add failing controller tests for shared queue serialization**

Inject a real `createSpeechQueue` configured with `delay: async () => {}` and fake output adapters that remain pending until an explicit end callback. Trigger a regular announcement and then a completion announcement. Assert completion does not start before the active item ends, begins before lower-priority waiting work, and no two adapters are active simultaneously. Add assertions that distinct repetition counts have distinct event keys and a duplicate event is offered only once.

- [ ] **Step 2: Run the targeted controller test to confirm current direct calls fail**

Run: `node --test --test-name-pattern="shared speech queue" test\app.test.js`

Expected: current direct `coach.speak` and `voicePlayback.play` calls bypass the queue.

- [ ] **Step 3: Add the queue to the controller and route English events**

Import `createSpeechQueue`; accept an optional `speechQueue` dependency. Create a default queue whose `onError` updates `voiceStatus` with the playback error and that written coaching remains available. In `setFeedback`, retain existing personality/speakability rules, but replace `lastVoiceEventAt`, `lastCorrectionAt`, and global cooldown dropping with a queue event key built from message ID, language, personality, and the actual parameters. Enqueue English speech with `play: () => coach.speak(...)` and `cancel: () => coach.cancel()`. Keep the queue item pending until the speech adapter settles.

- [ ] **Step 4: Route YarnGPT synthesis and playback through the same queue**

Enqueue one localized task per eligible event. Capture language, resolved phrase, voice-generation token, and selected voice at enqueue time. Inside `play`, check that voice remains enabled and the generation is current, resolve the compatible voice if necessary, call the existing `audioCoach.synthesizeAudio({ text, language, voice })`, re-check generation, then `await voicePlayback.play(audio)`. Do not play directly or let a stale request begin after a language change. Use the same event key and priority as English. Report synthesis/playback failures through queue `onError`.

- [ ] **Step 5: Preserve lifecycle behavior and add exercise/plank announcements**

Map `state.selectedExercise` through `EXERCISE_INSTRUCTION_IDS`. When the camera-ready workout countdown is announced, enqueue the selected exercise instruction as a separate prewritten phrase; add those IDs to the existing personality speakability sets without changing other personality rules. Keep numeric repetition values and targets from `getWorkoutProgress()` in the queue key and phrase parameters. Add the plank five-second cue when the existing elapsed-time progress crosses `target - 5` seconds; do not alter timer accumulation, pause accounting, goal completion, or analyzer logic. Keep `next-exercise` as catalog-only because the app has no multi-exercise session transition.

On explicit voice-off and language changes, cancel the queue and increment the voice generation so active/pending work is invalidated. On reset/end, clear only pending work; on workout completion, keep the active item and enqueue the completion phrase at priority `100`. Preserve voice catalog refresh and saved voice/language choices. Store the last resolved message ID and parameters so changing languages re-renders the same coaching event with current-language text instead of dropping dynamic values.

- [ ] **Step 6: Update controller tests for all five languages and six exercises**

Replace direct synchronous speech assertions with queue-drain/end-callback assertions. For each of `en`, `yo`, `ig`, `ha`, and `pcm`, drive a workout start and assert the spoken locale/voice path uses that language. For each of the six exercise IDs, assert the queued workout instruction is its own mapped phrase and does not contain another exercise's instruction. Assert repetition announcements use the actual controller count, plank cues use the actual elapsed seconds/target, and completion only occurs in the completed state.

- [ ] **Step 7: Run focused tests and commit**

Run:

```powershell
node --test test\speech-queue.test.js test\feedback.test.js test\voice-playback.test.js test\app.test.js
```

Expected: queue ordering, duplicate suppression, language-specific phrase selection, exercise mapping, progress values, cancellation, and non-overlap tests pass.

```powershell
git add -- src\ui\app.js src\feedback\personality.js test\app.test.js
git commit -m "feat: serialize all workout coaching announcements" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Remove Voice-Test UI and Disclaimer

**Files:**
- Modify: `src/ui/app.js`
- Modify: `src/feedback/voice-playback.js`
- Modify: `api/src/shared/coaching-messages.js`
- Modify: `test/app.test.js`
- Modify: `test/feedback.test.js`
- Modify: `test/voice-playback.test.js`
- Delete: `src/feedback/browser-audio-sample.js`
- Modify: `README.md`

**Interfaces:**
- Keep the language and coach-style selectors, voice toggle, volume, “Select Voice” selector, and persistent preference handlers.
- Keep operational `voiceStatus` and `voiceCatalogStatus` output outside the removed test panel.
- Remove all developer-only test-panel actions and their controller methods; do not remove YarnGPT voice catalogue or synthesis services.

- [ ] **Step 1: Add UI assertions for the intended cleanup**

Update the mounted-app tests to assert rendered settings omit the translation-draft disclaimer, voice-test panel, test buttons, and pronunciation-review prompts while retaining language, coach style, and voice selectors. Assert `voiceOptions` still lists the selected compatible voice and controller language/voice preferences still persist.

- [ ] **Step 2: Remove test-only controller, markup, and event-handler paths**

In `src/ui/app.js`, remove `createBrowserAudioSample`, `preparedVoiceAudio`, `generateVoiceTest`, `playPreparedVoiceTest`, `playVoiceTest`, `playBrowserAudioTest`, `voiceTestPanel()`, their `data-action` click cases, `data-translation-draft`, and pronunciation-review status copy. Delete the `data-voice-test-status` update path. Move `data-voice-catalog-status` into the normal voice settings area so catalogue load/failure remains visible without a test panel. Keep `data-voice-status`.

- [ ] **Step 3: Remove unused test-only sample assets and phrases**

Delete `src/feedback/browser-audio-sample.js` after verifying no remaining imports. Remove its WAV-generation test and all controller tests that call the removed test actions. Remove the three `test-*` prompt IDs from the catalog and catalog tests; keep the provider routes and voice catalog implementation unchanged.

- [ ] **Step 4: Update documentation and scan for removed interface text**

Update the README translation-review section to describe the categorized phrase catalog and state that non-English phrases/audio have not received native-speaker verification. Keep this documentation guidance; remove only the user-interface disclaimer. Search the application and tests for `Test Voice`, `Prompt Pronunciation`, `test voice and pronunciation`, `test-positioning`, `test-count-sequence`, `test-completion`, and the exact disclaimer text. No removed interface/action references should remain.

- [ ] **Step 5: Run focused UI and voice tests and commit**

Run:

```powershell
node --test test\app.test.js test\feedback.test.js test\voice-playback.test.js
```

Expected: removed test controls and disclaimer are absent; all normal language, voice, catalog-status, and preference behaviors remain.

```powershell
git add -- src\ui\app.js src\feedback\voice-playback.js api\src\shared\coaching-messages.js test\app.test.js test\feedback.test.js test\voice-playback.test.js README.md
git add -u -- src\feedback\browser-audio-sample.js
git commit -m "chore: remove voice test interface" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Full Regression and Mobile Settings Verification

**Files:**
- Verify: all files in Tasks 1–4
- Do not modify unrelated pre-existing mobile work.

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`

Expected: all existing and new tests pass, including the existing mobile workout, goal, MediaPipe-boundary, and language/voice preference tests.

- [ ] **Step 2: Build the production bundle**

Run: `npm run build`

Expected: Vite produces the production bundle without warnings caused by the new catalog or removed actions.

- [ ] **Step 3: Check whitespace and remaining test/disclaimer references**

Run:

```powershell
git diff --check
rg -n -i "translation is an unverified draft|test voice|prompt pronunciation|test-positioning|test-count-sequence|test-completion" src api test
```

Expected: `git diff --check` passes and the search returns no removed application interface or test-action strings. The README may retain its explanatory native-review guidance.

- [ ] **Step 4: Inspect phone settings at representative widths**

Run the app using the existing Vite dev command and inspect the workout voice disclosure at 320 px, 390 px, and 430 px. Verify the language selector, “Select Voice”, volume, and catalogue/status text remain reachable without horizontal overflow, and removed test controls/disclaimer do not render. Do not alter the already-completed tablet/desktop or unrelated mobile redesign.

- [ ] **Step 5: Report verification limits**

Report test/build/phone-width results accurately. State that phrases remain unverified by native speakers and that real YarnGPT pronunciation could not be verified unless a configured provider was actually exercised. Do not make live provider calls without approval.

---

## Coverage Map

| Requirement | Task |
|---|---|
| Six categories and all five languages | 1 |
| Exercise-specific instructions for all six exercises | 1, 3 |
| Motivation variations, progress templates, controlled numbers | 1, 3 |
| Plank hold/countdown/completion phrases without timing changes | 1, 3 |
| One serialized queue for English and YarnGPT speech | 2, 3 |
| Moderate speech rate, pauses, deduplication, and error recovery | 2, 3 |
| Language/voice preferences and selected spoken language | 3, 4 |
| Remove disclaimer and all test-panel controls | 4 |
| Native-speaker caveat and final regression | 1, 4, 5 |
