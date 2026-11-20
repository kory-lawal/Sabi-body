# SabiBody Exercise Form Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conservative, exercise-specific readiness, squat/jumping-jack form validation, and valid-form plank timing to the existing MediaPipe workout without changing YarnGPT.

**Architecture:** Keep the existing three analyzers and strengthen their state machines. Add shared normalized-geometry/confidence helpers and an exercise readiness classifier, forward MediaPipe world landmarks as an optional callback argument, and let the existing workout controller gate progress until stable readiness. Route actionable state transitions through the existing localized coaching/voice queue and add development-only diagnostics.

**Tech Stack:** Vanilla JavaScript ES modules, Vite, `@mediapipe/tasks-vision`, Node.js built-in test runner, existing FastAPI backend tests.

**Spec:** `docs/superpowers/specs/2026-11-03-exercise-form-validation-design.md`

## Global Constraints

- Required-landmark confidence: 0.60.
- Stable readiness/phase transitions: at least 3 consecutive reliable frames.
- Brief tracking recovery window: up to 350 ms for retaining an in-progress rep phase, with no counting during the gap; after the grace window, discard the incomplete cycle and require a fresh starting pose.
- Framing boundary margin: 0.02 of frame width/height.
- Visible-body height: less than 0.35 of frame height is too far, and greater than 0.90 is too close.
- Front-view candidate: both shoulder and hip widths at least 0.35 of shoulder-to-hip torso length; side-view candidate: both widths at most 0.25 of torso length.
- Squat upright knee angle: at least 160 degrees.
- Squat depth knee angle: at most 105 degrees, with hip position at or below knee height, allowing at most 0.05 torso lengths above the knee to account for landmark noise.
- Jumping-jack closed ankle separation: at most 0.8 times hip width.
- Jumping-jack open ankle separation: at least 1.5 times hip width, plus both wrists at least 0.02 frame heights above the nose landmark.
- Plank shoulder-hip-ankle angle: at least 155 degrees, with hip deviation from the shoulder-to-ankle line within 0.10 of shoulder-to-ankle length.
- Plank timestamp contribution per frame: at most 200 ms.
- Camera frames stay in the browser; no YarnGPT endpoint, request format, credential, or client behavior changes; do not make paid YarnGPT requests.
- The first Start press remains the explicit camera-consent action. Do not count repetitions or valid plank time before stable exercise-specific readiness.
- Uncertain, incomplete, low-confidence, or invalid-form movements do not count. Invalid plank form pauses time immediately and preserves prior valid time.
- Supplied non-English coaching remains marked unverified; do not claim real-world accuracy before physical camera testing.
- The worktree contains unrelated pre-existing changes. Do not revert them; stage only files named for the current task.
- For camera-size framing, use vertical body height for upright exercises and horizontal body length for planks, retaining the approved 0.35–0.90 span bounds.
- This checkout is on `main` and contains unrelated uncommitted changes. Do not stage or commit during implementation; leave the worktree intact and ask separately before creating commits.

---

## File map

| File | Responsibility |
|---|---|
| `src/exercises/geometry.js` | Confidence, visibility, angle, normalized-distance, signed line-deviation, and small smoothing primitives shared by the readiness classifier and analyzers. |
| `src/exercises/readiness.js` | Exercise-specific required landmarks, exercise-axis framing/orientation/start-pose classification, diagnostics metrics, and the consecutive-frame readiness gate. |
| `src/pose/pose-tracker.js` | Preserve existing MediaPipe VIDEO lifecycle and callback arguments; append optional world landmarks from `PoseLandmarkerResult`. |
| `src/exercises/squat.js` | Tunable squat cycle state machine; count only stable upright → valid depth → stable upright cycles. |
| `src/exercises/jumping-jacks.js` | Tunable closed/open/return state machine using bilateral overhead arms and normalized foot separation. |
| `src/exercises/plank.js` | Tunable alignment checks and valid-only elapsed-time accumulation with immediate pause on invalid form. |
| `src/ui/app.js` | Positioning/readiness lifecycle, analyzer dispatch, event-only feedback, display state and controls. |
| `api/src/shared/coaching-messages.js` | Centralized exercise-specific camera, correction, valid-form, progress, and recovery messages in all supported languages. |
| `src/feedback/personality.js` | Speakability policy and selected coach-style variants for new event IDs. |
| `src/ui/exercise-diagnostics.js` | Development-only collapsed diagnostics markup/render helper, isolated from production UI. |
| `src/styles.css` | Restrained diagnostic panel and valid/invalid/missing overlay presentation. |
| `src/pose/draw-pose.js` | Reuse the current skeleton drawing path and support distinct diagnostic validity/missing-landmark styles. |
| `test/exercises.test.js` | Extend existing synthetic geometry and per-exercise analyzer tests. |
| `test/exercise-readiness.test.js` | Synthetic landmarks for required-landmark, framing, orientation, starting-pose, and stable-gate tests. |
| `test/camera-pose.test.js` | Verify optional world-landmark callback forwarding without changing MediaPipe lifecycle. |
| `test/app.test.js` | Verify readiness gates controller progress and workout controls/feedback still integrate. |
| `test/feedback.test.js` | Verify every new message ID is available in all supported languages and preserves translation status. |
| `README.md` | Document user positioning, tunable threshold defaults, limitations, and required physical camera checks. |

## Task 1: Add shared geometry and readiness classification

**Files:**
- Modify: `src/exercises/geometry.js`
- Create: `src/exercises/readiness.js`
- Create: `test/exercise-readiness.test.js`
- Test: `test/exercises.test.js`

**Interfaces:**
- `getLandmarkConfidence(landmark)` returns the weakest finite visibility/presence score, or `null` when the point has no confidence evidence.
- `isVisible(landmark, threshold = 0.60)` accepts only finite normalized coordinates and adequate available confidence.
- `distance(a, b)`, `angleAt(a, b, c)`, `distanceFromLine(point, a, b)`, and `signedDistanceFromLine(point, a, b)` return normalized geometry values or `null` for invalid/degenerate inputs.
- `createLandmarkSmoother({ windowSize = 3 })` exposes `update(landmarks)` and `reset()`; it filters only reliable points and never upgrades confidence.
- `classifyExerciseReadiness(exerciseId, landmarks, worldLandmarks = [], config = READINESS_THRESHOLDS)` returns `{ poseReady, state, reasonId, requiredIndices, confidences, metrics }`.
- `createReadinessGate({ stableFrames = 3 })` exposes `update(classification)` and `reset()`; `ready` is true only after three consecutive `poseReady` classifications.

- [ ] **Step 1: Add failing geometry and readiness tests**

Add tests for conservative confidence aggregation, non-finite/out-of-frame coordinates, normalized distances, straight/bent joint angles, positive and signed line deviation, smoothing/reset behavior, and the ready gate. A classification must expose a specific rejection state when required landmarks are missing or framing/orientation/start pose is invalid.

```js
const classification = classifyExerciseReadiness(
  'squats',
  createSideOnStandingPose(),
);
assert.equal(classification.poseReady, true);
assert.equal(createReadinessGate().update(classification).ready, false);
```

- [ ] **Step 2: Run the focused readiness tests and confirm they fail**

Run: `node --test test/exercise-readiness.test.js test/exercises.test.js`
Expected: FAIL because the new classifier and geometry helpers do not exist.

- [ ] **Step 3: Implement named readiness thresholds and helpers**

Use the approved spec defaults. Evaluate required points by exercise; reject missing/low-confidence/out-of-frame points before geometry. Compare exercise-axis body span (vertical for upright exercises, horizontal for planks) and shoulder/hip widths to normalized torso length. Classify start pose as upright standing for squats, closed stance for jumping jacks, or aligned horizontal support for planks. Return diagnostics metrics with the same classification used for readiness.

- [ ] **Step 4: Verify readiness and geometry tests pass**

Run: `node --test test/exercise-readiness.test.js test/exercises.test.js`
Expected: PASS for confidence, geometry, framing, orientation, start-pose, and gate boundaries.

- [ ] **Step 5: Commit the isolated helper change**

Stage only `src/exercises/geometry.js`, `src/exercises/readiness.js`, `test/exercise-readiness.test.js`, and `test/exercises.test.js`; commit with `feat: add exercise readiness classification`.

## Task 2: Forward optional MediaPipe world landmarks

**Files:**
- Modify: `src/pose/pose-tracker.js`
- Modify: `test/camera-pose.test.js`

**Interfaces:**
- Preserve the callback signature `onPose(landmarks, timestamp)` for existing consumers.
- Append `worldLandmarks` as an optional third argument: `onPose(landmarks, timestamp, worldLandmarks = [])`.

- [ ] **Step 1: Add a callback-forwarding regression test**

Stub `detectForVideo()` with both `landmarks` and `worldLandmarks`, run one animation frame, and assert that the callback receives both arrays and the same timestamp.

```js
assert.deepEqual(poses[0], {
  landmarks: result.landmarks[0],
  timestamp: 10,
  worldLandmarks: result.worldLandmarks[0],
});
```

- [ ] **Step 2: Run the focused camera/pose test**

Run: `node --test test/camera-pose.test.js`
Expected: the new forwarding assertion fails while existing VIDEO lifecycle tests remain otherwise unchanged.

- [ ] **Step 3: Append the world-landmark argument**

Read `result.worldLandmarks?.[0] ?? []` beside `result.landmarks?.[0] ?? []` and pass it as the third callback argument. Do not alter inference, frame deduplication, overlay, or tracker cleanup.

- [ ] **Step 4: Re-run the camera/pose tests**

Run: `node --test test/camera-pose.test.js`
Expected: PASS, including GPU/CPU initialization fallback, one RAF loop, pause/resume, cleanup, and world-landmark forwarding.

- [ ] **Step 5: Commit the pose callback extension**

Stage only `src/pose/pose-tracker.js` and `test/camera-pose.test.js`; commit with `feat: expose optional MediaPipe world landmarks`.

## Task 3: Make squat detection conservative and depth-aware

**Files:**
- Modify: `src/exercises/squat.js`
- Modify: `test/exercises.test.js`

**Interfaces:**
- Export `SQUAT_THRESHOLDS`; accept optional overrides in `createSquatAnalyzer(config = SQUAT_THRESHOLDS)`.
- `update(landmarks, timestamp, worldLandmarks = [])` returns `{ count, state, phase, formValid, rejectionReasonId, feedbackId, metrics }`.
- Keep `reset()` and its count-reset behavior.

- [ ] **Step 1: Add failing positive and negative squat sequences**

Use normalized, confidence-tagged poses with a stable upright start. Verify each distinct phase is stable for three frames and a complete depth-and-return cycle counts once; shallow depth, depth without return, random angle motion, low-confidence landmarks, and a tracking gap over 350 ms do not count. Verify phase invalidation after a workout pause preserves completed repetitions while discarding an incomplete cycle.

```js
for (const pose of [standing, standing, standing, shallow, standing, standing, standing]) {
  result = analyzer.update(pose.landmarks, pose.timestamp);
}
assert.equal(result.count, 0);
```

- [ ] **Step 2: Run only the squat tests and confirm new cases fail**

Run: `node --test --test-name-pattern="squat" test/exercises.test.js`
Expected: new threshold, phase-stability, and invalid-cycle tests fail against the current single-frame transitions.

- [ ] **Step 3: Implement the squat phase state machine**

Use side-view readiness evidence, reliable side selection, a smoothed knee angle, and normalized hip-versus-knee depth. Require stable transitions through `waiting-for-standing`, `standing`, `lowering`, `valid-depth`, and `returning`. Increment only after a stable upright return; preserve an incomplete phase only during the approved short tracking grace window. Add `invalidatePhase()` to clear a pending cycle without clearing `count`; `reset()` continues to clear both.

```js
if (state === 'returning' && stableUprightFrames >= config.stableFrames) {
  count += 1;
  state = 'standing';
  return result({ feedbackId: 'squat-completed', count });
}
```

- [ ] **Step 4: Verify all squat tests**

Run: `node --test --test-name-pattern="squat" test/exercises.test.js`
Expected: PASS for complete, shallow, partial, loss/recovery, confidence, reset, and one-count-only behavior.

- [ ] **Step 5: Commit the squat analyzer and tests**

Stage only `src/exercises/squat.js` and `test/exercises.test.js`; commit with `feat: validate full squat depth and return`.

## Task 4: Validate full bilateral jumping-jack cycles

**Files:**
- Modify: `src/exercises/jumping-jacks.js`
- Modify: `test/exercises.test.js`

**Interfaces:**
- Export `JUMPING_JACK_THRESHOLDS`; accept optional overrides in `createJumpingJackAnalyzer(config = JUMPING_JACK_THRESHOLDS)`.
- `update(landmarks, timestamp, worldLandmarks = [])` returns `{ count, state, phase, formValid, rejectionReasonId, feedbackId, metrics }`.
- `invalidatePhase()` discards an incomplete cycle but retains the completed count.

- [ ] **Step 1: Add failing full-cycle and rejection tests**

Cover a stable closed → fully-open → stable closed cycle, plus arms below overhead, one arm only, insufficient feet separation, feet-only motion, missing wrist/ankle/nose points, open without return, and phase jitter.

- [ ] **Step 2: Run the jumping-jack tests and confirm new cases fail**

Run: `node --test --test-name-pattern="jumping-jack" test/exercises.test.js`
Expected: newly added bilateral, overhead, normalized-width, and stable-return tests fail against the current classifier.

- [ ] **Step 3: Implement normalized bilateral open/closed state transitions**

Require a visible nose reference, both wrists overhead, both elbows/wrists reliable, and ankle separation at least 1.5 times hip width for `fully-open`. Require wrists beside the torso and ankle separation at most 0.8 times hip width for `closed`. Use three reliable frames for each phase and count only a complete return. Add `invalidatePhase()` to discard a partial cycle while preserving completed repetitions.

```js
const fullyOpen =
  bothWristsAboveNose &&
  ankleWidth / hipWidth >= config.openFeetRatio;
const closed = bothArmsDown && ankleWidth / hipWidth <= config.closedFeetRatio;
```

- [ ] **Step 4: Verify all jumping-jack tests**

Run: `node --test --test-name-pattern="jumping-jack" test/exercises.test.js`
Expected: PASS for accepted cycles and each incomplete/asymmetric rejection.

- [ ] **Step 5: Commit the jumping-jack analyzer and tests**

Stage only `src/exercises/jumping-jacks.js` and `test/exercises.test.js`; commit with `feat: validate complete jumping jack cycles`.

## Task 5: Gate plank time on stable valid form

**Files:**
- Modify: `src/exercises/plank.js`
- Modify: `test/exercises.test.js`

**Interfaces:**
- Export `PLANK_THRESHOLDS`; accept optional overrides in `createPlankAnalyzer(config = PLANK_THRESHOLDS)`.
- `update(landmarks, timestamp, worldLandmarks = [])` returns `{ elapsedMs, active, state, phase, formValid, rejectionReasonId, feedbackId, metrics }`.
- Preserve `reset()`; invalid frames never erase already accumulated `elapsedMs`.
- `invalidatePhase()` clears the timer's previous-frame baseline and stable-resume counter without clearing `elapsedMs`.

- [ ] **Step 1: Add failing valid/invalid timed-hold tests**

Add a 10-second stable aligned sequence, hip-sag and hip-rise cases, invalid view, missing support/ankle points, temporary loss and recovery, and a large timestamp gap. Assert no invalid interval accrues and prior valid time is retained.

```js
const beforeInvalid = analyzer.update(aligned, 10_000).elapsedMs;
const afterInvalid = analyzer.update(sagged, 10_100);
assert.equal(afterInvalid.elapsedMs, beforeInvalid);
assert.equal(afterInvalid.active, false);
```

- [ ] **Step 2: Run focused plank tests and confirm new cases fail**

Run: `node --test --test-name-pattern="plank" test/exercises.test.js`
Expected: new hip-deviation, immediate-pause, stable-recovery, and timestamp tests fail.

- [ ] **Step 3: Implement configurable alignment and valid-time accumulation**

Use the reliable side with the approved 155-degree angle and normalized hip-to-segment deviation. Invalidate the accumulated interval immediately when form or required tracking is invalid; require three consecutive valid frames to resume. Cap each accepted timestamp delta at 200 ms and retain all previously accrued valid time.

```js
if (!formValid || !landmarksReliable) {
  previousAlignedAt = null;
  stableValidFrames = 0;
  return result({ active: false, elapsedMs });
}
```

- [ ] **Step 4: Verify focused plank tests**

Run: `node --test --test-name-pattern="plank" test/exercises.test.js`
Expected: PASS for valid timing, sag/rise pause, loss, recovery, max delta, and reset.

- [ ] **Step 5: Commit the plank analyzer and tests**

Stage only `src/exercises/plank.js` and `test/exercises.test.js`; commit with `feat: count plank time only with valid alignment`.

## Task 6: Gate controller progress on exercise readiness

**Files:**
- Modify: `src/ui/app.js`
- Modify: `test/app.test.js`
- Test: `test/exercise-readiness.test.js`

**Interfaces:**
- Controller pose handler accepts `(landmarks, timestamp, worldLandmarks = [])`.
- Controller state exposes `readinessState`, `readinessReasonId`, `readinessReady`, `movementPhase`, `formValid`, `rejectionReasonId`, and `diagnosticMetrics`.
- While camera/tracker are active but readiness is not stable, keep the existing loading/positioning lifecycle; `count` and `elapsedMs` remain unchanged.
- Each analyzer exposes `invalidatePhase()` to cancel an incomplete cycle or timer baseline without discarding completed repetitions or earned plank time.

- [ ] **Step 1: Add controller tests for startup gating and recovery**

Use the existing injected fake tracker to emit no-pose, partial-pose, wrong-start, and three stable ready frames. Assert no analyzer progress before readiness, then countdown/running only after the stable gate. Assert invalid exercise events do not increment counts and loss during a plank stops elapsed-time progress immediately.

- [ ] **Step 2: Run the focused controller tests and confirm they fail**

Run: `node --test --test-name-pattern="readiness|position|plank|count" test/app.test.js`
Expected: startup currently transitions to running before any readiness frame, so the new gate assertions fail.

- [ ] **Step 3: Integrate readiness before analyzer dispatch**

Continue processing pose frames during camera-active positioning. Update structured readiness state and localized text, but do not invoke progress accounting until the readiness gate passes. On the stable transition, initialize the exercise analyzer from its valid start pose, fire the existing countdown feedback once, and continue normal workout controls. While running, always pass unreliable/missing landmarks to the analyzer so plank timing stops immediately and pending reps cannot advance. On pause, resume, camera loss, or exercise change, reset readiness and call `invalidatePhase()`; preserve completed repetitions and accumulated valid plank time. Do not send a second countdown on ordinary recovery after tracking loss. Reset progress only on the existing Reset/new-workout paths.

```js
if (!state.readinessReady) {
  analyzer.update([], timestamp, worldLandmarks);
  return;
}
const analysis = analyzer.update(landmarks, timestamp, worldLandmarks);
```

- [ ] **Step 4: Keep positioning controls operable**

Ensure End remains available while positioning and Start/Pause/Resume/Reset retain their documented enabled states. Update exercise-state, camera badge, body/position labels, and progress displays without changing the existing layout or camera permission timing.

- [ ] **Step 5: Verify controller and complete UI tests**

Run: `node --test --test-name-pattern="readiness|position|plank|count|Start|Pause|Resume|Reset|End" test/app.test.js`
Expected: PASS for gating, camera lifecycle, voice event ordering, goals, and controls.

- [ ] **Step 6: Commit the readiness-gated controller**

Stage only `src/ui/app.js` and `test/app.test.js`; commit with `feat: gate workouts on stable exercise readiness`.

## Task 7: Add event-based localized form and positioning coaching

**Files:**
- Modify: `api/src/shared/coaching-messages.js`
- Modify: `src/feedback/personality.js`
- Modify: `test/feedback.test.js`
- Modify: `src/ui/app.js`
- Modify: `test/app.test.js`

**Interfaces:**
- Add stable message IDs for camera/no-person/partial/near/far/missing/orientation/ready states; squat depth and stand-up; bilateral jack corrections and return; plank sag/rise/alignment/recovery; and valid-form encouragement. Add new form-correction IDs to the calm/friendly speakability sets and selected energetic variants to the personality mapping.
- All IDs have English, Yoruba, Igbo, Hausa, and Nigerian Pidgin entries. Existing `translateCoachingMessage()` continues to return `translationStatus: 'unverified'` for non-English.

- [ ] **Step 1: Add failing catalog and language-selection tests**

For each new ID, assert `hasCoachingMessage(id)` and that translation returns nonempty text in all five language codes, preserves tone-mark/special-character strings, and marks non-English as unverified. Extend controller tests to verify each event uses the selected language and personality.

- [ ] **Step 2: Run the focused feedback tests**

Run: `node --test test/feedback.test.js test/app.test.js`
Expected: missing message IDs and event-to-coach mapping fail.

- [ ] **Step 3: Add natural, event-specific messages**

Add concise text for every approved state in the centralized catalog. Map analyzer `feedbackId`/readiness reason IDs through the existing personality and `setFeedback()` path; do not call YarnGPT from the pose loop directly.

```js
const eventKey = JSON.stringify([
  feedbackId,
  state.language,
  state.personality,
  parameters,
]);
if (eventKey !== lastCoachingEventKey) {
  lastCoachingEventKey = eventKey;
  setFeedback(feedbackId, parameters);
}
```

- [ ] **Step 4: Deduplicate and prioritize state transitions**

Track `lastCoachingEventKey` separately from the voice queue's existing `lastVoiceEventKey`. Reset the coaching key on workout reset, exercise change, and new session. Only call `setFeedback()` when the event/reason changes; let its existing voice cooldown, priority, mute, cancellation, and duplicate behavior remain authoritative. Keep completion higher priority than routine encouragement. Test by emitting the same invalid state over many frames and asserting one queued speech event.

- [ ] **Step 5: Verify localized feedback tests**

Run: `node --test test/feedback.test.js test/app.test.js`
Expected: PASS for all message translations, selected language/style, event cooldown, and exactly event-bound speech scheduling.

- [ ] **Step 6: Commit the localized coaching changes**

Stage only `api/src/shared/coaching-messages.js`, `src/feedback/personality.js`, `src/ui/app.js`, `test/feedback.test.js`, and `test/app.test.js`; commit with `feat: localize exercise form coaching events`.

## Task 8: Add developer-only diagnostics and state-aware skeleton colors

**Files:**
- Create: `src/ui/exercise-diagnostics.js`
- Modify: `src/ui/app.js`
- Modify: `src/pose/draw-pose.js`
- Modify: `src/pose/pose-tracker.js`
- Modify: `src/styles.css`
- Modify: `test/app.test.js`
- Modify: `test/camera-pose.test.js`

**Interfaces:**
- Diagnostics renderer accepts the controller state object and returns no production markup.
- Pose overlay accepts optional diagnostic state; the default rendering remains the existing neutral skeleton when diagnostics are disabled.
- `createPoseTracker` accepts an optional `getDiagnosticState()` callback and passes its result to `drawPose` only while the developer toggle is enabled.

- [ ] **Step 1: Add failing development/production markup and overlay tests**

Assert diagnostics contain camera/readiness status, confidence by required landmark, phase, geometry metrics, form validity/rejection reason, and plank active state in development. Assert production markup omits the diagnostics toggle and diagnostic state does not alter pose inference or the existing neutral overlay.

- [ ] **Step 2: Run focused diagnostics tests**

Run: `node --test --test-name-pattern="diagnostic|drawPose" test/app.test.js test/camera-pose.test.js`
Expected: diagnostic UI tests fail because no diagnostics component exists.

- [ ] **Step 3: Implement a collapsed development-only panel**

Use the same `import.meta.env.DEV` convention as the existing YarnGPT test panel. Render only developer state; keep all user-facing copy in the existing normal workout view and keep the panel collapsed by default.

- [ ] **Step 4: Add optional validity colors to the current overlay**

Reuse `DrawingUtils` and the existing confidence visibility checks. When diagnostic state is provided, distinguish valid required landmarks, invalid/missing required landmarks, and the current movement phase. Have `createPoseTracker` request current diagnostic state after `onPose` so the overlay matches the just-processed frame. Keep no-state callers and production rendering unchanged.

- [ ] **Step 5: Verify focused diagnostics tests**

Run: `node --test --test-name-pattern="diagnostic|drawPose" test/app.test.js test/camera-pose.test.js`
Expected: PASS for development-only diagnostics and existing overlay rendering behavior.

- [ ] **Step 6: Commit diagnostics**

Stage only `src/ui/exercise-diagnostics.js`, `src/ui/app.js`, `src/pose/draw-pose.js`, `src/pose/pose-tracker.js`, `src/styles.css`, `test/app.test.js`, and `test/camera-pose.test.js`; commit with `feat: add development exercise diagnostics`.

## Task 9: Document tuning, run regression suites, and verify integration boundaries

**Files:**
- Modify: `README.md`
- Test: `test/exercises.test.js`
- Test: `test/exercise-readiness.test.js`
- Test: `test/camera-pose.test.js`
- Test: `test/app.test.js`
- Test: `test/feedback.test.js`
- Test: backend `tests/test_yarngpt_service.py` and frontend `test/feedback.test.js`

- [ ] **Step 1: Document thresholds and physical validation**

Update the exercise logic section in `README.md` with the configurable defaults from the spec, camera placement instructions, threshold limitations, how to find diagnostics in a development build, and the physical test matrix. State explicitly that synthetic tests do not certify real-world accuracy.

- [ ] **Step 2: Run all focused exercise/readiness/camera/controller tests**

Run: `node --test test/exercises.test.js test/exercise-readiness.test.js test/camera-pose.test.js test/app.test.js`
Expected: PASS for analyzer scenarios, readiness gating, camera lifecycle, event feedback, and controls.

- [ ] **Step 3: Run the full frontend suite and production build**

Run: `npm test`
Run: `npm run build`
Expected: all Node tests pass and Vite produces a production build.

- [ ] **Step 4: Run backend YarnGPT contract tests without live provider requests**

Run: `Set-Location backend; py -3.10 -m unittest discover -s tests -v`
Expected: PASS using mocks; no paid YarnGPT request is sent.

- [ ] **Step 5: Inspect the final scoped diff**

Run `git diff --check` and inspect `git diff --stat` plus the diff for files touched by this plan. Confirm no dependency, YarnGPT request, secret, camera-permission timing, or unrelated workout behavior changed. Confirm existing pre-existing worktree edits remain unstaged unless they are listed files intentionally changed by this plan.

- [ ] **Step 6: Document the physical camera checklist**

Manually test each exercise with camera at the instructed angle; check too-near/too-far/partial-body cases; complete and intentionally incomplete movements; verify loss and recovery; verify plank time pauses immediately on sag/rise/landmark loss and resumes without reset; check all four localized messages. Record threshold adjustments only from observable physical testing, and do not claim verified exercise accuracy without that evidence.

- [ ] **Step 7: Commit only the documentation and any final scoped test adjustments**

Stage `README.md` and only explicitly reviewed feature files changed in this task; commit with `docs: document exercise validation tuning`.
