# English-Only Release and Mutually Exclusive Speaking Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release SabiBody with English as the only selectable language and enforce mutually exclusive Voice Coaching and Speak Each Rep modes without changing workout recognition.

**Architecture:** Keep the existing multilingual catalog and YarnGPT backend, but expose a release-level English-only allowlist and normalize saved UI language to English. Preserve the existing preference fields and shared speech queue; enforce mode exclusivity in preference normalization, controller setters, and the controller's single speech-eligibility path.

**Tech Stack:** JavaScript ES modules, Node.js built-in test runner, Vite, browser SpeechSynthesis, existing YarnGPT FastAPI backend.

**Spec:** `docs/superpowers/specs/2026-11-14-english-only-speaking-modes-design.md`

## Global Constraints

- Keep the complete `LANGUAGES` catalog, translations, backend language support, and YarnGPT implementation.
- Retain the existing `voiceEnabled` and `countEachRep` preference/state fields to minimize compatibility changes.
- Normalize a persisted conflict using Voice Coaching as the winner.
- Voice Coaching may enqueue contextual coaching, instructions, progress, and completion messages, but never per-repetition announcements.
- Speak Each Rep may enqueue only the repetition-count event generated after the existing analyzer count increases; contextual messages remain visual feedback only.
- With both modes off, the controller enqueues no workout speech.
- Continue using the existing shared queue and its browser/YarnGPT playback adapters. Do not add a queue or announcement controller.
- Do not change MediaPipe, exercise analyzers, camera behavior, targets, or completion-screen behavior.
- Do not add another TTS provider or voice test controls.

---

### Task 1: Restrict Release Language Availability to English

**Files:**
- Modify: `src/feedback/messages.js`
- Modify: `src/feedback/preferences.js`
- Modify: `src/ui/app.js`
- Modify: `README.md`
- Test: `test/feedback.test.js`
- Test: `test/voice-preferences.test.js`
- Test: `test/app.test.js`

**Interfaces:**
- Preserve `LANGUAGES` as the complete translation catalog list.
- Export `SELECTABLE_LANGUAGES` from `src/feedback/messages.js` as the release-level list containing English only.
- Use `SELECTABLE_LANGUAGES` for `languageOptions()` and `createWorkoutController().setLanguage()`.
- `loadVoicePreferences()` must normalize any saved non-English language to `en`.

- [ ] **Step 1: Add failing assertions for the active language allowlist**

In `test/feedback.test.js`, keep the existing assertion that `LANGUAGES` includes all five language codes and add:

```js
assert.deepEqual(
  SELECTABLE_LANGUAGES.map(({ code }) => code),
  ['en'],
);
```

In `test/voice-preferences.test.js`, change the persisted `language: 'yo'` expectation to `language: 'en'`, and add a stored `language: 'pcm'` case that also loads as `en`.

In `test/app.test.js`, add a controller assertion that `setLanguage('yo')` leaves state at `en`. Add a mounted-home assertion that `English` is present and `Yoruba`, `Igbo`, `Hausa`, and `Nigerian Pidgin` are not shown. Update controller tests that expected language persistence or runtime switching (`language and voice preferences persist without enabling voice by default`, `energetic coach resolves localized variant text and metadata`, `localized audio is requested once for an eligible analyzer event only`, `workout speech uses the selected locale across all five supported languages`, and the two language-change tests). Keep translation-catalog tests in `test/feedback.test.js` and YarnGPT/backend language tests unchanged; the app tests should now assert English-only behavior rather than trying to select hidden locales.

- [ ] **Step 2: Run the focused tests and verify the new expectations fail**

Run:

```powershell
node --test test\feedback.test.js test\voice-preferences.test.js test\app.test.js
```

Expected: the tests fail because the active-language list is not yet defined and saved/selected non-English preferences are still accepted.

- [ ] **Step 3: Add the release allowlist without removing translation data**

In `src/feedback/messages.js`, leave `LANGUAGES` unchanged and export:

```js
export const SELECTABLE_LANGUAGES = [
  { code: 'en', label: 'English' },
];
```

In `src/feedback/preferences.js`, accept only `en` when normalizing persisted UI language; preserve all other preference fields. In `src/ui/app.js`, use `SELECTABLE_LANGUAGES` for the selector and reject non-English `setLanguage()` calls. Do not change the translation service or backend supported languages.

- [ ] **Step 4: Remove unavailable language claims from the home page and README**

In the home-page preview in `src/ui/app.js`, replace the four non-English badges with a single English badge and update the accompanying copy to describe English coaching. In `README.md`, state that this release exposes English only, that other translations/backend support remain in the codebase, and that English speech uses browser speech rather than requiring YarnGPT. Correct the privacy description to say English coaching text is spoken locally by browser speech; enabling English coaching may still load the existing YarnGPT voice catalogue, but does not require successful catalogue loading or send coaching text for audio generation.

Retain `English workout start uses browser speech without calling NaijaLingo` as a regression test and extend it to verify that coaching still speaks when the voice catalogue is unavailable.

- [ ] **Step 5: Run the language and preference tests**

Run:

```powershell
node --test test\feedback.test.js test\voice-preferences.test.js test\app.test.js
```

Expected: all tests pass; the full translation catalog tests still exercise the five existing language codes while the app exposes English only.

- [ ] **Step 6: Commit the language availability change**

```powershell
git add -- src\feedback\messages.js src\feedback\preferences.js src\ui\app.js README.md test\feedback.test.js test\voice-preferences.test.js test\app.test.js
git commit -m "feat: limit release language to English" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Enforce Mutually Exclusive Mode State

**Files:**
- Modify: `src/feedback/preferences.js`
- Modify: `src/ui/app.js`
- Test: `test/voice-preferences.test.js`
- Test: `test/app.test.js`

**Interfaces:**
- Keep the existing `setVoiceEnabled(enabled)` and `setCountEachRep(enabled)` controller methods.
- Enabling either mode must persist the other flag as `false`.
- Loading a legacy preference object with both flags true must result in `{ voiceEnabled: true, countEachRep: false }`.
- When one mode is active, `voiceStatus` must explain that the other mode cannot run because only one speaking mode may be active. Both modes off must display an off status.

- [ ] **Step 1: Add failing preference and controller transition tests**

In `test/voice-preferences.test.js`, add a legacy stored preference case with both flags set to `true`; assert that loading preserves Voice Coaching and disables Speak Each Rep.

In `test/app.test.js`, add assertions covering both directions:

```js
controller.setVoiceEnabled(true);
assert.equal(controller.getState().voiceEnabled, true);
assert.equal(controller.getState().countEachRep, false);

controller.setCountEachRep(true);
assert.equal(controller.getState().voiceEnabled, false);
assert.equal(controller.getState().countEachRep, true);

controller.setCountEachRep(false);
assert.equal(controller.getState().voiceEnabled, false);
assert.equal(controller.getState().countEachRep, false);
```

Also assert that the active mode's status says the other mode cannot run at the same time and that toggling the active mode off leaves both false.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
node --test test\voice-preferences.test.js test\app.test.js
```

Expected: failures show that preferences and controller setters currently allow both flags to remain true.

- [ ] **Step 3: Normalize persisted mode conflicts**

Update the preference normalizer so `voiceEnabled === true` takes precedence over a simultaneously true `countEachRep`. Ensure `saveVoicePreferences()` runs the same normalizer after merging changes so stored values always satisfy the invariant.

- [ ] **Step 4: Make mode setters update the pair and speech status together**

In `src/ui/app.js`, make enabling Voice Coaching persist `countEachRep: false`; make enabling Speak Each Rep persist `voiceEnabled: false`. A `false` action disables only the requested active mode so the other mode remains unchanged if it is already active. On each actual mode transition, cancel the existing speech queue and invalidate the voice generation before publishing the new state. Keep both controls switchable and use the existing `data-voice-status` live region to explain the exclusivity rule.

- [ ] **Step 5: Run mode and preference tests**

Run:

```powershell
node --test test\voice-preferences.test.js test\app.test.js
```

Expected: preference loads, persistence, both mode transitions, both-off behavior, status text, and legacy conflict precedence pass.

- [ ] **Step 6: Commit the mode-state change**

```powershell
git add -- src\feedback\preferences.js src\ui\app.js test\voice-preferences.test.js test\app.test.js
git commit -m "feat: enforce exclusive speaking modes" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Gate Speech by Mode and Invalidate Stale Announcements

**Files:**
- Modify: `src/ui/app.js`
- Test: `test/app.test.js`

**Interfaces:**
- Keep `workoutSpeechQueue` as the only scheduler.
- Voice Coaching speech is eligible only when `state.voiceEnabled` is true and the feedback is not `repetition-count`.
- Speak Each Rep speech is eligible only when `state.countEachRep` is true and `feedbackId` is `repetition-count`.
- The existing analyzer count increase remains the sole source of repetition-count events.
- Before an enqueued task starts browser speech or YarnGPT audio playback, check that its captured voice generation and mode still match current state.

- [ ] **Step 1: Add failing tests for mode-specific announcement eligibility**

Update the existing rep event test in `test/app.test.js` to enable only Speak Each Rep. Assert that two distinct analyzer count increases enqueue counts `1` and `2`, while contextual correction, milestone, and instruction events do not invoke speech. Add a Voice Coaching case that emits an analyzer count increase and contextual feedback; assert contextual feedback may speak and no `repetition-count` event is enqueued.

Add a both-off case that starts a workout and verifies no item reaches the speech queue. Add an English playback-failure case whose speech adapter throws; assert the workout remains running, its analyzer count still advances, and the failure is surfaced through the existing status path.

- [ ] **Step 2: Add a failing test for the final valid repetition**

Update `optional spoken rep counts follow analyzer increments and completion takes precedence` so a count increment that reaches the target still produces the matching final rep-count announcement in Speak Each Rep mode, and no completion coaching is spoken in that mode.

- [ ] **Step 3: Run the focused controller tests and verify they fail**

Run:

```powershell
node --test --test-name-pattern="rep|speaking mode|completion" test\app.test.js
```

Expected: failures show that the controller gates both message kinds through `voiceEnabled` and returns before announcing the final completed rep.

- [ ] **Step 4: Centralize speech eligibility in `setFeedback()`**

In `src/ui/app.js`, branch speech scheduling on the single active state:

```js
const isRepAnnouncement = feedbackId === 'repetition-count';
const shouldSpeak = state.voiceEnabled
  ? !isRepAnnouncement && isSpeakableFeedback(state.personality, feedbackId)
  : state.countEachRep && isRepAnnouncement;
```

Use the existing event keys, priorities, browser speech adapter, and YarnGPT path. Add mode and generation checks inside the queued `play` callback and again after any awaited synthesis before calling `voicePlayback.play()`. Do not modify the speech queue or add another adapter. Keep the existing voice selector/catalog refresh and voice preference controls.

- [ ] **Step 5: Preserve the final valid rep while replacing stale completion speech**

When `processPose()` sees a target-reaching analyzer count increase in Speak Each Rep mode, pass that count into the completion path. In `finishWorkout()`, cancel and invalidate prior queued/active announcements, then enqueue only the final `repetition-count` event for Speak Each Rep mode. For Voice Coaching mode, enqueue a fresh completion message after cancellation. Explicit `end()` and `selectExercise()` must cancel the old queue and increment the voice generation so prior speech and delayed synthesis cannot cross the transition.

- [ ] **Step 6: Update lifecycle tests to match the release requirements**

Update the completion test to verify that an old active/pending message is cancelled before a fresh Voice Coaching completion message is queued. Update the manual End test to assert active and pending speech do not continue after ending. Keep reset's existing active-announcement behavior unchanged unless a regression test demonstrates it is required to satisfy the specified transitions.

Add a mode-switch test with a pending/active speech item that asserts its cancellation callback runs, the old-generation task does not speak later, and the newly selected mode remains the only eligible mode.

- [ ] **Step 7: Run focused app tests**

Run:

```powershell
node --test --test-name-pattern="rep|speaking mode|completion|End|exercise|speech" test\app.test.js
```

Expected: mode-specific speech, distinct valid rep counts (including the goal-reaching rep), cancellation, and existing completion behavior pass.

- [ ] **Step 8: Commit speech gating and lifecycle changes**

```powershell
git add -- src\ui\app.js test\app.test.js
git commit -m "fix: isolate workout speech by mode" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Run Full Regression Validation

**Files:**
- Verify: all changed files
- Verify: existing JavaScript and Python backend test suites

**Interfaces:**
- No new interfaces. This task verifies the release behavior and confirms the existing YarnGPT service and workout analyzers remain unchanged.

- [ ] **Step 1: Run the complete Node.js test suite**

Run:

```powershell
npm test
```

Expected: all Node tests pass, including translation catalog coverage and six-exercise/plank regression cases. Update only assertions made obsolete by the new English-only app selector or exclusive mode semantics.

- [ ] **Step 2: Build the production frontend**

Run:

```powershell
npm run build
```

Expected: Vite completes and produces the production bundle.

- [ ] **Step 3: Run existing YarnGPT backend tests**

Run:

```powershell
py -3.10 -m unittest discover -s backend\tests -v
```

Expected: existing backend tests pass, confirming the YarnGPT service and its multilingual implementation were not changed.

- [ ] **Step 4: Review the final diff and worktree**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only the planned release files are changed by this work. Preserve pre-existing `index.html`, `src/styles.css`, and untracked workspace files.
