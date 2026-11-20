# Simple MediaPipe Exercise Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace restrictive exercise validators with responsive MediaPipe landmark movement counters and a forgiving plank timer.

**Architecture:** Keep `PoseLandmarker`, the current camera/tracker, and the workout UI. Remove readiness as a runtime gate; simplify each existing analyzer to finite joint-coordinate checks and a small hysteresis latch, then publish its count/time directly to controller state.

**Tech Stack:** JavaScript ES modules, `@mediapipe/tasks-vision`, Node.js built-in test runner, Vite.

**Spec:** [2026-11-12-simple-exercise-detection-design.md](../specs/2026-11-12-simple-exercise-detection-design.md)

## Global Constraints

- Keep MediaPipe Pose as the only pose-detection system.
- Do not apply a global confidence threshold, full-body framing rule, multi-frame stability gate, or landmark smoothing to exercise counting.
- Use the approved starting thresholds: squat/lunge bend `<=150°`, return `>=160°`; push-up bend `<=145°`, return `>=160°`; sit-up rise `>=40°`, return `<=25°`; jumping-jack open ankle width `>1.25×` hip width, close `<1.1×`; plank start `>=150°`, clear-loss boundary `<135°`.
- Plank loss grace is 300 ms for clear angle loss and 500 ms for missing landmarks; cap accumulated frame intervals at 200 ms.
- Preserve camera, exercise images, workout UI, goals, feedback, voice, pause/resume, and completed-workout behavior.
- Preserve all unrelated pre-existing worktree changes. The worktree is already dirty, so never stage or commit whole files containing unrelated user edits.
- Do not commit implementation changes in this worktree unless they can be isolated from existing user changes; finish with a scoped diff for review.

## File Structure

- `src/ui/app.js` — Start the workout after tracker startup, remove readiness gating, propagate analyzer state, and base goal completion on target progress.
- `src/exercises/squat.js`, `jumping-jacks.js`, `push-ups.js`, `sit-ups.js`, `lunges.js`, `plank.js` — Keep the current analyzer exports and result shapes while replacing validation/state machinery with direct movement signals and small latches.
- `src/exercises/readiness.js` and `test/exercise-readiness.test.js` — Delete after the app no longer imports the readiness classifier/gate.
- `src/exercises/geometry.js` — Retain `angleAt`, `distance`, and UI tracking helpers; remove smoothing/line-distance helpers only after all analyzers stop using them.
- `test/app.test.js` — Controller start, state propagation, pause/resume, and goal-completion behavior.
- `test/exercises.test.js`, `test/push-ups.test.js`, `test/sit-ups.test.js`, `test/lunges.test.js` — Movement-cycle and timer tests using normalized landmark fixtures.
- `src/pose/pose-tracker.js` — No changes; it remains the MediaPipe inference/callback boundary.

## Task 1: Remove Readiness From Controller Decisions

**Files:**
- Modify: `src/ui/app.js`
- Modify: `test/app.test.js`
- Delete: `src/exercises/readiness.js`
- Delete: `test/exercise-readiness.test.js`

**Interfaces:**
- `createWorkoutController` continues to receive `onPose(landmarks, timestamp, worldLandmarks)`.
- Exercise analyzers continue to expose `update`, `reset`, and `invalidatePhase`.
- `processPose` publishes `{ count, elapsedMs, formValid, exerciseState, movementPhase }`; `formValid` remains display/diagnostic data, not a goal-completion gate.

- [ ] **Step 1: Add a failing test that starts analysis without a ready pose**

Add a test in `test/app.test.js` using the existing `createHarness({ autoReadiness: false })` helper and a squat analyzer stub:

```js
test('workout starts analyzing when tracker startup completes without a ready pose', async () => {
  let analyzerCalls = 0;
  const harness = createHarness({
    autoReadiness: false,
    createAnalyzers: () => ({
      squats: {
        reset() {},
        invalidatePhase() {},
        update() {
          analyzerCalls += 1;
          return { count: 0, state: 'standing' };
        },
      },
    }),
  });

  await harness.controller.start();
  assert.equal(harness.controller.getState().workoutStatus, 'running');
  harness.trackers[0].callbacks.onPose([], 33);
  assert.equal(analyzerCalls, 1);
});
```

- [ ] **Step 2: Run the test and confirm it fails because start waits for readiness**

Run: `node --test --test-name-pattern="without a ready pose" test\app.test.js`

Expected: FAIL because the controller remains `loading` after the tracker starts.

- [ ] **Step 3: Add a failing goal test that does not require `formValid`**

Add:

```js
test('goal completion follows analyzer count without form-valid gating', async () => {
  const harness = createHarness({
    autoReadiness: false,
    createAnalyzers: () => ({
      squats: {
        reset() {},
        invalidatePhase() {},
        update() {
          return { count: 1, formValid: false, state: 'standing' };
        },
      },
    }),
  });
  harness.controller.setGoal(1);
  await harness.controller.start();
  harness.trackers[0].callbacks.onPose(createReadyLandmarks('squats'), 33);
  assert.equal(harness.controller.getState().workoutStatus, 'completed');
  assert.equal(harness.controller.getState().completedWorkouts.length, 1);
});
```

- [ ] **Step 4: Remove readiness gating and publish analyzer results directly**

In `src/ui/app.js`:

1. Remove imports of `classifyExerciseReadiness` and `createReadinessGate`, the gate instance, readiness reset/update calls, readiness feedback deduplication, and readiness-only early returns.
2. After `createdTracker.start(...)` succeeds, update `workoutStatus: 'running'`, `cameraStatus: 'ready'`, and a neutral tracking status. Do not wait for a pose classification.
3. In `processPose`, update the selected analyzer for every pose frame while running. Publish its count/time on that frame. Keep missing-body and full-body UI status informational only.
4. In `resume`, resume the current tracker directly into `running`; for a recreated tracker, use the same post-start transition.
5. On manual pause, call the active analyzer's `invalidatePhase()` so a partial repetition cannot complete across the pause; preserve count and plank elapsed time.
6. Determine completion from `nextCount` or `nextElapsedMs` reaching the target. Remove `analysis.formValid === true` from the completion condition.
7. Preserve the existing countdown, milestones, speech, completed-workout record, and one-time completion handling.
8. Replace controller tests that expect a ready-pose wait or three stable ready frames with immediate-running tests. Delete `src/exercises/readiness.js` and `test/exercise-readiness.test.js` after confirming no other runtime imports remain.

The completion condition should be:

```js
const goalAchieved =
  wasRunning &&
  goalTarget > 0 &&
  nextCompleted >= goalTarget;
```

The post-start state update should include:

```js
update({
  workoutStatus: 'running',
  cameraStatus: 'ready',
  readinessState: 'tracking',
  readinessReady: true,
  statusMessage: 'Camera and pose tracking are running.',
});
```

- [ ] **Step 5: Run controller tests and confirm they pass**

Run: `node --test test\app.test.js`

Expected: PASS, including camera lifecycle, pause/resume, speech, target completion, and the two new no-readiness tests.

## Task 2: Simplify Squat Counting

**Files:**
- Modify: `src/exercises/squat.js`
- Modify: `test/exercises.test.js`

**Interfaces:**
- `createSquatAnalyzer()` returns `update`, `reset`, and `invalidatePhase`.
- `update(landmarks, timestamp)` returns the existing result fields including `count`, `state`, `phase`, and optional feedback/metrics.

- [ ] **Step 1: Replace strict squat tests with a shallow bend/return regression**

Use the existing `createLandmarks(kneeAngle)` helper:

```js
test('squat counts a reasonable knee bend and return exactly once', () => {
  const analyzer = createSquatAnalyzer();
  assert.equal(analyzer.update(createLandmarks(180), 0).count, 0);
  assert.equal(analyzer.update(createLandmarks(145), 33).count, 0);
  assert.equal(analyzer.update(createLandmarks(160), 66).count, 1);
  assert.equal(analyzer.update(createLandmarks(160), 99).count, 1);
});
```

Add a second case using the same pose with the visible-side hip, knee, and ankle confidence set to `0.2`; the completed cycle must still count.

Add a tracking-gap case that feeds standing, a 145° bend, missing landmarks at timestamps `100` and `600`, then standing at `633`; it must remain at count `0`.

Replace old squat assertions that reject a 145° bend, require the hip below the knee, or reject a finite low-confidence pose. Change every `createSquatAnalyzer({ stableFrames: 3 })` call to `createSquatAnalyzer()`. Remove the low-confidence-frame rejection test, keep incomplete-cycle/reset coverage, and change the tracking-gap case from 350 ms to 500 ms.

- [ ] **Step 2: Run the squat tests and confirm the shallow cycle fails**

Run: `node --test --test-name-pattern="squat counts a reasonable" test\exercises.test.js`

Expected: FAIL because the existing analyzer requires a much deeper, stable cycle and extra hip-position validation.

- [ ] **Step 3: Replace the squat state machine with a knee-angle latch**

Use `angleAt(hip, knee, ankle)` on either side with finite coordinates. Set `bent = true` when a knee angle is `<=150`; when a usable knee returns to `>=160` while bent, increment once and clear the latch. Remove confidence ranking, smoothing, hip-height validation, stable-frame configuration, and multi-phase states. `invalidatePhase()` clears only the latch; `reset()` also clears `count`.

Latch the side that first reaches the bend threshold, choosing the smaller angle if both sides qualify on the same frame. Use that same knee for the return threshold:

```js
if (pendingSide === null && bentSides.length) {
  pendingSide = bentSides.sort((a, b) => a.angle - b.angle)[0].name;
}
if (pendingSide && anglesBySide[pendingSide] >= 160) {
  count += 1;
  pendingSide = null;
}
```

- [ ] **Step 4: Run squat tests**

Run: `node --test --test-name-pattern="squat" test\exercises.test.js`

Expected: PASS for bend/return, no duplicate while standing, low-confidence usable points, reset, and incomplete tracking gaps.

## Task 3: Simplify Push-Up Counting

**Files:**
- Modify: `src/exercises/push-ups.js`
- Modify: `test/push-ups.test.js`

**Interfaces:**
- `createPushUpAnalyzer()` keeps `update`, `reset`, and `invalidatePhase`.
- The measured angle is `angleAt(shoulder, elbow, wrist)` from either usable side.

- [ ] **Step 1: Add a failing shallow push-up cycle test**

Add:

```js
test('push-up counts a moderate elbow bend and extension once', () => {
  const analyzer = createPushUpAnalyzer();
  assert.equal(analyzer.update(pose({ elbowAngle: 180 }), 0).count, 0);
  assert.equal(analyzer.update(pose({ elbowAngle: 145 }), 33).count, 0);
  assert.equal(analyzer.update(pose({ elbowAngle: 160 }), 66).count, 1);
  assert.equal(analyzer.update(pose({ elbowAngle: 160 }), 99).count, 1);
});
```

Run the same cycle with confidence `0.2` on the used side and assert it still counts. In a separate cycle, clear the unused side's shoulder, elbow, and wrist landmarks and assert the remaining finite side still counts. Replace the existing shallow-depth/body-alignment rejection test with an assertion that a 130° elbow bend returns and counts even when `hipOffset` is `0.12`. Keep no-return, true missing-landmark, and sustained-gap checks.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test --test-name-pattern="moderate elbow bend" test\push-ups.test.js`

Expected: FAIL because the current detector rejects the 145° bend and enforces body-line alignment.

- [ ] **Step 3: Implement elbow-angle hysteresis**

Remove body-line validation, reliable-side sorting, smoothing, tracking-grace phase states, and stable-frame configuration. Set a pending bend at `<=145°`; count once when the same usable elbow returns to `>=160°`. Clear an incomplete pending bend on `invalidatePhase()` and preserve count.

Latch the side whose elbow first reaches `<=145°`. Increment only when that same elbow returns to `>=160°`, then clear the latch. This prevents a noisy switch to the opposite side from duplicating a rep.

- [ ] **Step 4: Run push-up tests**

Run: `node --test test\push-ups.test.js`

Expected: PASS for full cycles, moderate depth, low-confidence finite points, no duplicate count, reset, and missing landmarks.

## Task 4: Simplify Jumping-Jack Counting

**Files:**
- Modify: `src/exercises/jumping-jacks.js`
- Modify: `test/exercises.test.js`

**Interfaces:**
- `createJumpingJackAnalyzer()` keeps `update`, `reset`, and `invalidatePhase`.
- The open/closed signal uses wrist-vs-shoulder average height and ankle-width/hip-width ratio.

- [ ] **Step 1: Add a failing relaxed-open-pose test**

Starting from the existing `createJumpingJackLandmarks('open')`, set both wrists to `y: 0.3` (below the nose at `y: 0.25` but above the shoulders at `y: 0.4`) and ankle x-coordinates to `0.27` and `0.53` (ankle width `1.3×` the existing hip width, above the new `1.25×` threshold but below the old `1.5×` rule). Assert the sequence closed → this relaxed open pose → closed results in exactly one count, and repeated closed frames do not increment again. Repeat using `0.2` confidence on the used wrists, shoulders, hips, and ankles.

Name the test `a relaxed-open-pose jumping jack counts once` so the focused test command below selects it.

- [ ] **Step 2: Run the test and confirm it fails under the current strict classifier**

Run: `node --test --test-name-pattern="relaxed-open-pose" test\exercises.test.js`

Expected: FAIL because the current detector requires both wrists above the nose and feet wider than its stricter ratio.

- [ ] **Step 3: Replace classification and phase states with two pose predicates**

Compute `open` when average wrist y is above average shoulder y and ankle width / hip width is `>1.25`. Compute `closed` when average wrist y is at or below shoulder height and the ratio is `<1.1`. Record an open phase; count once when the pose returns closed; clear the phase after counting. Remove required full-body landmark lists, body-span/orientation checks, confidence thresholds, smoothing, partial-pose rejection rules, and stable-frame configuration. Skip only frames with missing/non-finite required points.

Change every `createJumpingJackAnalyzer({ stableFrames: 3 })` call to `createJumpingJackAnalyzer()`. Replace the test that rejects low-confidence open landmarks with a complete low-confidence cycle; retain the genuinely missing-landmark and incomplete-open-cycle tests.

The core transition is:

```js
if (isOpen) {
  opened = true;
} else if (isClosed && opened) {
  count += 1;
  opened = false;
}
```

- [ ] **Step 4: Run jumping-jack tests**

Run: `node --test --test-name-pattern="jumping jack" test\exercises.test.js`

Expected: PASS for relaxed opening, complete return, duplicate prevention, and missing-point recovery.

## Task 5: Simplify Sit-Up Counting

**Files:**
- Modify: `src/exercises/sit-ups.js`
- Modify: `test/sit-ups.test.js`

**Interfaces:**
- `createSitUpAnalyzer()` keeps `update`, `reset`, and `invalidatePhase`.
- The trunk angle is measured from the side-view shoulder-to-hip vector relative to horizontal.

- [ ] **Step 1: Add a failing moderate-rise cycle test**

Add:

```js
test('sit-up counts a moderate trunk rise and return once', () => {
  const analyzer = createSitUpAnalyzer();
  assert.equal(analyzer.update(loweredPose(), 0).count, 0);
  assert.equal(analyzer.update(risingPose(), 33).count, 0);
  assert.equal(analyzer.update(poseAtTrunkAngle(20), 66).count, 1);
  assert.equal(analyzer.update(loweredPose(), 99).count, 1);
});
```

Add a second cycle with confidence `0.2` on the shoulder/hip points and assert the count is still `1`.

Replace the old sit-up test that expects low confidence to reject the pose. Keep its missing-joint and incomplete-cycle checks.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test --test-name-pattern="moderate trunk rise" test\sit-ups.test.js`

Expected: FAIL because the current analyzer requires a 60° upright posture and stable multi-stage transitions.

- [ ] **Step 3: Implement a trunk-angle latch**

Use either available shoulder/hip pair with finite coordinates. Mark the rise when trunk angle is `>=40°`; count once on return to `<=25°`. Remove confidence sorting, smoothing, stable-frame configuration, and intermediate rising/returning states. Preserve completed count when clearing an incomplete cycle.

The cycle latch is:

```js
if (trunkAngle >= 40) {
  raised = true;
} else if (trunkAngle <= 25 && raised) {
  count += 1;
  raised = false;
}
```

- [ ] **Step 4: Run sit-up tests**

Run: `node --test test\sit-ups.test.js`

Expected: PASS for the moderate cycle, full rise/return, no duplicate while lowered, low-confidence usable coordinates, and missing landmarks.

## Task 6: Simplify Lunge Counting

**Files:**
- Modify: `src/exercises/lunges.js`
- Modify: `test/lunges.test.js`

**Interfaces:**
- `createLungeAnalyzer()` keeps `update`, `reset`, and `invalidatePhase`.
- A cycle latches one working leg and does not require the other leg to remain straight or the user to alternate legs.

- [ ] **Step 1: Add a failing same-side moderate-depth test**

Use the existing lunge fixtures to complete two consecutive left-leg cycles with `workingAngle: 145`. Assert the final count is `2`, and assert repeated standing frames leave it at `2`.

Repeat one cycle with the opposite leg's hip, knee, and ankle set to `null`; the available leg must still count.

Replace any existing shallow-depth rejection expectation; retain the ambiguous-pose and missing-point checks only where they prove that no complete cycle can be measured.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test\lunges.test.js`

Expected: FAIL because the existing analyzer only accepts working angles `<=110°` and requires both legs' geometry/confidence.

- [ ] **Step 3: Implement a single active-leg cycle**

Measure each available hip-knee-ankle angle. When either angle reaches `<=150°`, latch that side; if both do, latch the smaller angle. Count once when the latched knee returns to `>=160°`, then clear the side latch. Remove opposite-leg-angle validation, alternation rules, confidence checks, smoothing, stable-frame configuration, and intermediate states. A 500 ms tracking gap clears only the pending side.

Choose the available side at `<=150°`; when both are bent on the same frame, choose the lower angle. Keep this side until its angle returns to `>=160°`, then increment once and clear the side. If the latched knee is missing, skip the frame; do not switch sides mid-cycle.

- [ ] **Step 4: Run lunge tests**

Run: `node --test test\lunges.test.js`

Expected: PASS for consecutive same-side cycles, alternating cycles, moderate depth, one count per return, reset, and missing-point recovery.

## Task 7: Simplify Plank Start, Pause, and Resume

**Files:**
- Modify: `src/exercises/plank.js`
- Modify: `test/exercises.test.js`
- Modify: `test/app.test.js`

**Interfaces:**
- `createPlankAnalyzer()` keeps `update(landmarks, timestamp)`, `reset`, and `invalidatePhase`.
- `update` returns `{ elapsedMs, active, state, phase, formValid, rejectionReasonId, feedbackId, metrics }`.

- [ ] **Step 1: Add a failing immediate-start and pause/resume test**

Use the existing `createPlankLandmarks()` fixture:

```js
test('plank starts immediately and pauses only after clear alignment loss', () => {
  const analyzer = createPlankAnalyzer();
  const aligned = createPlankLandmarks();
  assert.equal(analyzer.update(aligned, 1000).active, true);
  assert.equal(analyzer.update(aligned, 1100).elapsedMs, 100);

  const lost = createPlankLandmarks({ hipDeviation: 0.2 });
  assert.equal(analyzer.update(lost, 1200).elapsedMs, 100);
  assert.equal(analyzer.update(lost, 1400).active, true);
  assert.equal(analyzer.update(lost, 1500).active, false);

  assert.equal(analyzer.update(aligned, 1600).active, true);
  assert.equal(analyzer.update(aligned, 1700).elapsedMs, 200);
});
```

In a separate analyzer, verify a brief loss at `1200` that recovers at `1300` never marks paused and resumes accumulating at `1400`. Also assert an aligned finite pose with confidence `0.2` on its measured points starts the timer. Verify missing points stop accumulation immediately and mark the timer paused at 500 ms.

For the missing-point case, start an analyzer with aligned frames at `1000` and `1100`, send an all-null 33-entry landmark array at `1200`, and send it again at `1700`. Assert elapsed time remains `100` and `active` is false at `1700`.

Add a controller assertion that the plank `elapsedMs` reported by the analyzer is published while the workout is running even when `formValid` is false.

In `test/app.test.js`, create a plank stub whose `update()` returns `{ elapsedMs: 1250, active: false, formValid: false, state: 'paused' }`; after one pose callback, assert controller state has `elapsedMs === 1250` and `formValid === false`.

Replace old plank tests that require three stable frames, reject low-confidence finite points, or pause immediately on a single bad frame. Keep tests for a vertical non-plank pose, sustained clear loss, missing landmarks, and `invalidatePhase()` preserving earned time.

- [ ] **Step 2: Run the tests and confirm the immediate-start assertion fails**

Run: `node --test --test-name-pattern="plank starts immediately" test\exercises.test.js`

Expected: FAIL because the current analyzer waits for three stable aligned frames.

- [ ] **Step 3: Replace strict plank validation with angle hysteresis and loss grace**

Measure the shoulder-hip-ankle angle from either usable side and require horizontal displacement greater than vertical displacement. Start immediately at `>=150°`. While active, do not add time below `135°`; mark paused after 300 ms continuously below that boundary. If the angle returns to `>=150°` before then, clear the loss timer and continue. Missing joints stop accumulation immediately and mark paused after 500 ms. Resume at `>=150°` without resetting elapsed time. Cap each frame's credited interval at 200 ms. Remove confidence ranking, hip-deviation validation, smoothing, stable-frame waiting, and multiple phase states.

Remove the analyzer's configurable threshold object; keep the approved values as local constants. For the timer, track `active`, `belowPauseSince`, `missingSince`, and `lastValidAt`. Add elapsed time only when active and the current frame is usable; cap `timestamp - lastValidAt` at 200 ms.

Use this update order to avoid counting invalid intervals:

```js
if (!measurement) {
  missingSince ??= timestamp;
  lastValidAt = null;
  if (timestamp - missingSince >= 500) active = false;
  return output();
}

missingSince = null;
if (!active && measurement.angle >= 150) {
  active = true;
  lastValidAt = timestamp;
}
if (active && measurement.angle < 135) {
  belowPauseSince ??= timestamp;
  lastValidAt = null;
  if (timestamp - belowPauseSince >= 300) active = false;
} else if (active) {
  belowPauseSince = null;
  if (lastValidAt !== null) {
    elapsedMs += Math.min(timestamp - lastValidAt, 200);
  }
  lastValidAt = timestamp;
}
return output();
```

- [ ] **Step 4: Run plank and controller tests**

Run: `node --test --test-name-pattern="plank|timer" test\exercises.test.js test\app.test.js`

Expected: PASS for immediate start, capped increments, short wobble tolerance, sustained-loss pause, recovery, tracking loss, manual pause/resume, and visible controller state.

## Task 8: Remove Obsolete Detection Helpers and Expectations

**Files:**
- Modify: `src/exercises/geometry.js`
- Modify: `test/exercises.test.js`

**Interfaces:**
- Keep `angleAt`, `distance`, `isVisible`, and `hasFullBodyVisible` only where still used by analyzer geometry or informational camera/body status.
- Remove unused `createLandmarkSmoother`, `distanceFromLine`, and `signedDistanceFromLine` exports after confirming no source imports remain.

- [ ] **Step 1: Search for remaining obsolete-helper consumers**

Run: `rg -n "createLandmarkSmoother|distanceFromLine|signedDistanceFromLine" src test`

Expected: only the helper definitions and their geometry unit tests remain after Tasks 2–7.

- [ ] **Step 2: Remove obsolete helper tests and implementations**

Delete the smoothing and line-distance tests in `test/exercises.test.js`, then remove those unused exports and their private helper implementation from `src/exercises/geometry.js`. Keep angle, distance, finite-coordinate, and informational camera/body-status tests.

- [ ] **Step 3: Run exercise tests**

Run: `node --test test\exercises.test.js test\push-ups.test.js test\sit-ups.test.js test\lunges.test.js`

Expected: PASS with no references to deleted helpers or readiness classifiers.

## Task 9: Full Regression and Live Webcam Verification

**Files:**
- Modify only files identified by failing tests; preserve all unrelated worktree edits.

**Interfaces:**
- The shared browser page at `http://localhost:5176/` continues to load the existing SabiBody UI and MediaPipe assets.

- [ ] **Step 1: Run the full frontend suite**

Run: `npm test`

Expected: all tests pass, including the unrelated existing application features.

- [ ] **Step 2: Build the production frontend**

Run: `npm run build -- --outDir C:\Users\H\AppData\Local\Temp\sabi-body-dist --emptyOutDir`

Expected: Vite completes successfully. Do not change dependencies or create build output in the repository.

- [ ] **Step 3: Exercise each movement with the live webcam**

With the user in front of the shared browser's connected camera, start a workout and perform several complete cycles of squat, jumping jack, push-up, sit-up, and lunge. For each, record the displayed count before and after each cycle and verify it increments once per return. For plank, hold the aligned position, deliberately lose alignment long enough to cross the 300 ms pause boundary, then recover; confirm elapsed time stops and resumes without resetting.

- [ ] **Step 4: Tune only thresholds contradicted by observed webcam evidence**

If a demonstrated movement fails, inspect the live landmark angle/width metrics for that exact movement and adjust only its movement/return threshold. Re-run its focused regression test, then repeat that movement in the live camera. Do not restore global readiness, confidence, smoothing, stable-frame, or form-validation gates.

- [ ] **Step 5: Report verified outcomes**

Report the automated test/build results and separately list which of the six movements were physically tested. Do not describe fixture-only coverage as actual-webcam validation.
