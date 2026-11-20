# Six-Exercise Workout Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three validated MediaPipe exercises and a responsive, goal-earned completion flow that preserves results for the current app session.

**Architecture:** Keep the existing per-exercise analyzer and MediaPipe/readiness pipeline. Add independent Push-up, Sit-up, and Lunge analyzers, register their readiness/setup and coaching, then implement the shared controller completion result and dedicated completion/home navigation views.

**Tech Stack:** JavaScript ES modules, MediaPipe Tasks Vision (existing), Node.js built-in test runner, Vite, existing browser UI and CSS.

**Spec:** [2026-11-10-workout-completion-six-exercises-design.md](../specs/2026-11-10-workout-completion-six-exercises-design.md)

## Global Constraints

- “Keep MediaPipe and the existing camera/tracker pipeline.”
- “The completion screen contains no advertisements or commercial content.”
- “Successfully completed results remain in in-memory session state only. There is no persistent history or server storage.”
- “When no sequence is defined, “Next Workout” opens the home exercise chooser directly. “Back to Home” returns to the landing top. Neither action starts the camera.”
- “The displayed completion result is capped at the selected goal so later frames cannot inflate the achieved goal.”
- “Manual “End workout” is not a success event.”
- “Push-ups and Sit-ups use a side-on camera view. Lunges use a three-quarter view to balance leg identification with visibility of forward knee bend.”
- “These values are conservative initial computer-vision thresholds, not medical recommendations.”
- “Synthetic landmark tests establish deterministic branch behavior only.”
- Do not make paid YarnGPT requests or alter its endpoints, payloads, or credential handling.
- Preserve every pre-existing uncommitted change. Inspect dirty files before editing and integrate only the behavior required here.
- Work in the existing checkout because its uncommitted application changes are part of the current baseline. Do not stage or commit changes unless the user explicitly authorizes it.
- Keep all implementation edits unstaged; do not create commits without explicit user authorization.

---

## File Structure

- `src/exercises/push-ups.js` — Push-up phase validation and repetition count.
- `src/exercises/sit-ups.js` — Sit-up phase validation and repetition count.
- `src/exercises/lunges.js` — alternating-side lunge validation and repetition count.
- `src/exercises/readiness.js` — readiness classifiers and stable-start requirements for the three new exercise IDs.
- `src/ui/app.js` — exercise metadata, analyzer registration, goal defaults/presets, successful-completion result state, navigation actions, and view selection.
- `api/src/shared/coaching-messages.js` — English `alternate-legs` coaching identifier; other languages use the existing visible unverified fallback behavior until reviewed.
- `src/styles.css` — dedicated completion view and compact session-result styles, including mobile layout and reduced-motion behavior.
- `test/push-ups.test.js`, `test/sit-ups.test.js`, and `test/lunges.test.js` — isolated analyzer tests with synthetic MediaPipe image landmarks and deterministic timestamps.
- `test/exercise-readiness.test.js` — readiness coverage for required points, view, framing, and start pose for the new exercise IDs.
- `test/goal-session.test.js` — goal defaults and custom target behavior for all six exercise IDs.
- `test/app.test.js` — ready-pose fixtures, controller completion, cleanup, in-memory results, and navigation integration coverage.
- `test/feedback.test.js` — the new English coaching ID and unverified non-English fallback behavior.

The checkout contains existing uncommitted user work in many of these surrounding areas. Do not overwrite or revert it. Review its current contents and integrate only the behavior required here.

## Interfaces Shared Across Tasks

Each analyzer exports one constructor and one frozen threshold object:

```js
export const PUSH_UP_THRESHOLDS = Object.freeze({
  confidence: 0.6,
  stableFrames: 3,
  smoothingWindow: 3,
  trackingGraceMs: 350,
  topAngle: 155,
  depthAngle: 95,
  alignmentRatio: 0.1,
});
export function createPushUpAnalyzer(config = PUSH_UP_THRESHOLDS);
```

`createSitUpAnalyzer` and `createLungeAnalyzer` follow the same interface with their own threshold objects. `update(landmarks, timestamp)` returns the existing analyzer shape:

```js
{
  count,
  state,
  phase: state,
  formValid,
  rejectionReasonId,
  feedbackId,
  metrics,
}
```

`count` is the number of completed valid cycles and never advances on an incomplete cycle. Invalid/missing landmarks cannot advance a phase. Use the existing `getLandmarkConfidence`, `isVisible`, `angleAt`, `distance`, `distanceFromLine`, and `createLandmarkSmoother` helpers rather than duplicating their logic.

With the required three-frame median smoother, feed at least five raw samples when a test abruptly changes pose so the analyzer sees three stable smoothed readings. Keep the analyzer's `stableFrames` threshold at `3`.

The controller's session-result record is:

```js
{
  exerciseId,
  exerciseName,
  target,
  unit: 'reps' | 'seconds',
  achieved,
  completedAt,
}
```

Add it to `state.completedWorkouts`, which begins as `[]`, survives Next Workout and Home navigation, and is never persisted.

---

### Task 1: Add Push-up Analyzer

**Files:**
- Create: `src/exercises/push-ups.js`
- Create: `test/push-ups.test.js`

**Interfaces:**
- Produces `createPushUpAnalyzer(config = PUSH_UP_THRESHOLDS)` with `update(landmarks, timestamp)`, `reset()`, and `invalidatePhase()`.
- Uses phases `waiting-for-top`, `top`, `lowering`, `valid-depth`, and `returning`.
- Counts a repetition only after a stable top → valid depth → top cycle.

- [ ] **Step 1: Write a failing complete-cycle and invalid-form test**

At the top of the test file import `assert` from `node:assert/strict`, `test` from `node:test`, and `createPushUpAnalyzer` from `../src/exercises/push-ups.js`. Create a synthetic 33-element landmark builder. For the left side use shoulder/elbow/wrist indices `11/13/15`, hip `23`, and ankle `27`; provide the other shoulder/hip required for side-view framing. Build the top with a `180°` elbow angle and aligned shoulder/hip/ankle coordinates. Build the bottom with a `90°` elbow angle. Feed each pose for three consecutive frames at 33 ms intervals.

```js
function point(x, y, confidence = 0.9) {
  return { x, y, visibility: confidence, presence: confidence };
}

function pose({ elbowAngle = 180, hipOffset = 0, confidence = 0.9 } = {}) {
  const landmarks = Array.from({ length: 33 }, () => null);
  const shoulder = point(0.2, 0.5, confidence);
  const elbow = point(0.4, 0.5, confidence);
  const wristDirection = ((180 - elbowAngle) * Math.PI) / 180;
  const wrist = point(
    elbow.x + 0.2 * Math.cos(wristDirection),
    elbow.y + 0.2 * Math.sin(wristDirection),
    confidence,
  );
  Object.assign(landmarks, {
    11: shoulder,
    12: point(0.21, 0.5, confidence),
    13: elbow,
    15: wrist,
    23: point(0.5, 0.5 + hipOffset, confidence),
    24: point(0.51, 0.5 + hipOffset, confidence),
    27: point(0.8, 0.5, confidence),
  });
  return landmarks;
}

function feed(analyzer, landmarks, startMs, frames = 5) {
  let result;
  for (let frame = 0; frame < frames; frame += 1) {
    result = analyzer.update(landmarks, startMs + frame * 33);
  }
  return result;
}

test('push-up counts one stable top-lower-top cycle', () => {
  const analyzer = createPushUpAnalyzer();
  feed(analyzer, pose({ elbowAngle: 180 }), 0);
  feed(analyzer, pose({ elbowAngle: 90 }), 165);
  const result = feed(analyzer, pose({ elbowAngle: 180 }), 330);
  assert.equal(result.count, 1);
  assert.equal(result.state, 'top');
});

test('push-up rejects shallow depth, poor alignment, and missing return', () => {
  const shallow = createPushUpAnalyzer();
  feed(shallow, pose({ elbowAngle: 180 }), 0);
  feed(shallow, pose({ elbowAngle: 130 }), 165);
  assert.equal(feed(shallow, pose({ elbowAngle: 180 }), 330).count, 0);

  const misaligned = createPushUpAnalyzer();
  feed(misaligned, pose({ elbowAngle: 180 }), 0);
  const invalid = feed(misaligned, pose({ elbowAngle: 90, hipOffset: 0.12 }), 165);
  assert.equal(invalid.count, 0);
  assert.equal(invalid.rejectionReasonId, 'body-alignment-invalid');

  const incomplete = createPushUpAnalyzer();
  feed(incomplete, pose({ elbowAngle: 180 }), 0);
  const bottom = feed(incomplete, pose({ elbowAngle: 90 }), 165);
  assert.equal(bottom.count, 0);
});
```

For the alignment rejection, offset the hip by `0.12` normalized units from a `0.60`-unit shoulder-to-ankle segment, making the deviation ratio `0.20`, greater than `0.10`. Add two more assertions using the same builder: set `confidence: 0.2` and verify the analyzer reports `missing-landmarks` without counting; then set landmark `15` to `null` and verify the same. For tracking loss, feed top and valid depth, call `update([], 700)` to exceed the `350ms` grace period, then feed top again and assert the incomplete cycle still has count `0`.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test test\push-ups.test.js`

Expected: FAIL because the analyzer module does not exist.

- [ ] **Step 3: Implement the Push-up phase machine**

Use the approved thresholds: confidence `0.60`, stable frames `3`, smoothing window `3`, top elbow angle `155°`, valid depth `95°` or lower, alignment ratio `0.10` maximum, and tracking grace `350ms`. Keep every threshold in `PUSH_UP_THRESHOLDS`. Reject unreliable shoulder/elbow/wrist/hip/ankle evidence. Do not accept depth while body alignment is invalid; clear the pending phase on invalid form and reset an incomplete cycle after the tracking-grace limit.

- [ ] **Step 4: Run focused analyzer tests**

Run: `node --test test\push-ups.test.js`

Expected: PASS for complete cycle, shallow movement, no return, bad alignment, low confidence, missing landmarks, and recovery after tracking loss.

---

### Task 2: Add Sit-up Analyzer

**Files:**
- Create: `src/exercises/sit-ups.js`
- Create: `test/sit-ups.test.js`

**Interfaces:**
- Produces `createSitUpAnalyzer(config = SIT_UP_THRESHOLDS)` with the common analyzer interface.
- Uses phases `waiting-for-lowered`, `lowered`, `rising`, `upright`, and `returning`.
- Counts only lowered-start → upright → lowered-start.

- [ ] **Step 1: Write failing phase-cycle tests**

At the top of the test file import `assert` from `node:assert/strict`, `test` from `node:test`, and `createSitUpAnalyzer` from `../src/exercises/sit-ups.js`. Build side-on landmarks with a shoulder-to-hip trunk axis within `25°` of horizontal for the lowered pose, and at least `60°` from horizontal for the upright pose. Keep shoulder, hip, and knee landmarks visible with confidence `0.9`. Require three stable frames at each phase. Define `poseAtTrunkAngle(angleDegrees)` by setting hip to `(0.5, 0.6)`, shoulder to `(0.5 - 0.3*cos(angle), 0.6 - 0.3*sin(angle))`, and visible knees to `(0.7, 0.6)` and `(0.71, 0.6)`. `loweredPose()` calls it with `0`; `uprightPose()` calls it with `90`.

```js
function point(x, y, confidence = 0.9) {
  return { x, y, visibility: confidence, presence: confidence };
}

function poseAtTrunkAngle(angleDegrees) {
  const angle = (angleDegrees * Math.PI) / 180;
  const hip = point(0.5, 0.6);
  const shoulder = point(
    hip.x - 0.3 * Math.cos(angle),
    hip.y - 0.3 * Math.sin(angle),
  );
  const landmarks = Array.from({ length: 33 }, () => null);
  Object.assign(landmarks, {
    11: shoulder,
    12: point(shoulder.x + 0.01, shoulder.y),
    23: hip,
    24: point(hip.x + 0.01, hip.y),
    25: point(0.7, 0.6),
    26: point(0.71, 0.6),
  });
  return landmarks;
}

const loweredPose = () => poseAtTrunkAngle(0);
const uprightPose = () => poseAtTrunkAngle(90);

function feed(analyzer, landmarks, startMs, frames = 3) {
  let result;
  for (let frame = 0; frame < frames; frame += 1) {
    result = analyzer.update(landmarks, startMs + frame * 33);
  }
  return result;
}

test('sit-up counts only after upright and return to the lowered start', () => {
  const analyzer = createSitUpAnalyzer();
  feed(analyzer, loweredPose(), 0, 3);
  feed(analyzer, uprightPose(), 99, 3);
  const result = feed(analyzer, loweredPose(), 198, 3);
  assert.equal(result.count, 1);
  assert.equal(result.state, 'lowered');
});

test('sit-up does not count an incomplete rise or an upright pose without return', () => {
  const incompleteRise = createSitUpAnalyzer();
  feed(incompleteRise, loweredPose(), 0, 3);
  feed(incompleteRise, poseAtTrunkAngle(40), 99, 3);
  assert.equal(feed(incompleteRise, loweredPose(), 198, 3).count, 0);

  const missingReturn = createSitUpAnalyzer();
  feed(missingReturn, loweredPose(), 0, 3);
  const result = feed(missingReturn, uprightPose(), 99, 3);
  assert.equal(result.count, 0);
  assert.equal(result.state, 'upright');
});

test('sit-up rejects unreliable or missing landmarks and clears a cycle after tracking loss', () => {
  const unreliable = createSitUpAnalyzer();
  feed(unreliable, loweredPose(), 0, 3);
  const lowConfidence = poseAtTrunkAngle(90);
  lowConfidence[11].visibility = 0.2;
  lowConfidence[12].visibility = 0.2;
  assert.equal(feed(unreliable, lowConfidence, 99, 3).count, 0);
  const missing = poseAtTrunkAngle(90);
  missing[25] = null;
  missing[26] = null;
  assert.equal(feed(unreliable, missing, 198, 3).count, 0);

  const lost = createSitUpAnalyzer();
  feed(lost, loweredPose(), 0, 3);
  feed(lost, uprightPose(), 99, 3);
  lost.update([], 600);
  assert.equal(feed(lost, loweredPose(), 700, 3).count, 0);
});
```

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `node --test test\sit-ups.test.js`

Expected: FAIL because the analyzer module does not exist.

- [ ] **Step 3: Implement the Sit-up phase machine**

Use confidence `0.60`, stable frames `3`, smoothing window `3`, lowered angle `0–25°` from horizontal, upright angle `60–90°` from horizontal, and tracking grace `350ms`. Validate the shoulder/hip/knee evidence before a phase can advance. Use `Math.atan2(Math.abs(shoulder.y - hip.y), Math.abs(shoulder.x - hip.x))` converted to degrees as the trunk angle from horizontal. Preserve an incomplete cycle only during the configured grace window and never increment on the rising phase alone.

- [ ] **Step 4: Run focused analyzer tests**

Run: `node --test test\sit-ups.test.js`

Expected: PASS for a complete cycle, partial rise, missing return, unreliable landmarks, and tracking loss.

---

### Task 3: Add Alternating Lunge Analyzer

**Files:**
- Create: `src/exercises/lunges.js`
- Create: `test/lunges.test.js`

**Interfaces:**
- Produces `createLungeAnalyzer(config = LUNGE_THRESHOLDS)` with the common analyzer interface.
- Uses phases `waiting-for-standing`, `standing`, `lowering`, `valid-lunge`, and `returning`.
- Exposes the selected/last working leg in `metrics.workingLeg`.
- Accepts either leg as the first repetition; every later counted rep must use the opposite leg.

- [ ] **Step 1: Write failing complete-cycle and alternation tests**

At the top of the test file import `assert` from `node:assert/strict`, `test` from `node:test`, and `createLungeAnalyzer` from `../src/exercises/lunges.js`. Build 33-element three-quarter-view poses with both hip/knee/ankle sides. Set both shoulders to y=`0.25`, both hips to y=`0.55`, and each shoulder/hip pair width to `0.09`; this yields a three-quarter width-to-torso ratio of `0.30`. A standing pose has both knee angles `180°`. For a valid left lunge, set the left knee angle to `100°` and the opposite knee angle to `150°`; mirror the values for a valid right lunge. Feed each phase for three stable frames. Construct each knee angle by putting the knee at `(x, 0.70)`, the hip at `(x, 0.55)`, and the ankle `0.15` units away from the knee at angle `-90° + kneeAngle`.

```js
function point(x, y, confidence = 0.9) {
  return { x, y, visibility: confidence, presence: confidence };
}

function kneePose(hipX, kneeAngle) {
  const knee = point(hipX, 0.7);
  const angle = ((-90 + kneeAngle) * Math.PI) / 180;
  return {
    hip: point(hipX, 0.55),
    knee,
    ankle: point(
      knee.x + 0.15 * Math.cos(angle),
      knee.y + 0.15 * Math.sin(angle),
    ),
  };
}

function standingPose() {
  return makeLungePose(180, 180);
}

function lungePose(side, { workingAngle = 100 } = {}) {
  return side === 'left'
    ? makeLungePose(workingAngle, 150)
    : makeLungePose(150, workingAngle);
}

function makeLungePose(leftAngle, rightAngle) {
  const left = kneePose(0.42, leftAngle);
  const right = kneePose(0.51, rightAngle);
  const landmarks = Array.from({ length: 33 }, () => null);
  Object.assign(landmarks, {
    11: point(0.40, 0.25),
    12: point(0.49, 0.25),
    23: left.hip,
    24: right.hip,
    25: left.knee,
    26: right.knee,
    27: left.ankle,
    28: right.ankle,
  });
  return landmarks;
}

function feed(analyzer, landmarks, startMs, frames = 3) {
  let result;
  for (let frame = 0; frame < frames; frame += 1) {
    result = analyzer.update(landmarks, startMs + frame * 33);
  }
  return result;
}

test('lunges count complete alternating left-right and right-left cycles', () => {
  for (const order of [['left', 'right'], ['right', 'left']]) {
    const analyzer = createLungeAnalyzer();
    feed(analyzer, standingPose(), 0);
    feed(analyzer, lungePose(order[0]), 99);
    feed(analyzer, standingPose(), 198);
    feed(analyzer, lungePose(order[1]), 297);
    const result = feed(analyzer, standingPose(), 396);
    assert.equal(result.count, 2);
  }
});

test('lunges reject shallow, same-side, and incomplete cycles', () => {
  const shallow = createLungeAnalyzer();
  feed(shallow, standingPose(), 0);
  feed(shallow, lungePose('left', { workingAngle: 130 }), 99);
  assert.equal(feed(shallow, standingPose(), 198).count, 0);

  const sameSide = createLungeAnalyzer();
  feed(sameSide, standingPose(), 0);
  feed(sameSide, lungePose('left'), 99);
  feed(sameSide, standingPose(), 198);
  feed(sameSide, lungePose('left'), 297);
  const repeatedSide = feed(sameSide, standingPose(), 396);
  assert.equal(repeatedSide.count, 1);
  assert.equal(repeatedSide.feedbackId, 'alternate-legs');

  const incomplete = createLungeAnalyzer();
  feed(incomplete, standingPose(), 0);
  const result = feed(incomplete, lungePose('left'), 99);
  assert.equal(result.count, 0);

  const ambiguous = createLungeAnalyzer();
  feed(ambiguous, standingPose(), 0);
  assert.equal(feed(ambiguous, makeLungePose(100, 100), 99).count, 0);
});

test('lunges reject missing landmarks and discard incomplete cycles after tracking loss', () => {
  const missing = standingPose();
  missing[27] = null;
  const analyzer = createLungeAnalyzer();
  assert.equal(feed(analyzer, missing, 0).count, 0);

  const lost = createLungeAnalyzer();
  feed(lost, standingPose(), 0);
  feed(lost, lungePose('left'), 99);
  lost.update([], 600);
  assert.equal(feed(lost, standingPose(), 700).count, 0);
});
```

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `node --test test\lunges.test.js`

Expected: FAIL because the analyzer module does not exist.

- [ ] **Step 3: Implement the Lunge phase machine**

Use confidence `0.60`, stable frames `3`, smoothing window `3`, standing knee angles `155°` or greater, working-leg knee angle `110°` or lower, opposite knee angle `140°` or greater, and tracking grace `350ms`. Reject ambiguous cases where both knees are flexed or neither leg satisfies the valid lunge threshold. Store the last counted side; if the next complete cycle repeats that side, leave count unchanged and return feedback ID `alternate-legs`.

- [ ] **Step 4: Run focused analyzer tests**

Run: `node --test test\lunges.test.js`

Expected: PASS for both alternating orders, shallow lunge rejection, same-side rejection, no return, unreliable landmarks, and tracking loss.

---

### Task 4: Register New Exercises, Goals, and Readiness

**Files:**
- Modify: `src/exercises/readiness.js`
- Modify: `src/ui/app.js`
- Modify: `api/src/shared/coaching-messages.js`
- Test: `test/exercise-readiness.test.js`
- Test: `test/goal-session.test.js`
- Test: `test/app.test.js`
- Test: `test/feedback.test.js`

**Interfaces:**
- Consumes the analyzer constructors from Tasks 1–3.
- Extends `classifyExerciseReadiness(exerciseId, landmarks, worldLandmarks = [], config = READINESS_THRESHOLDS)` for `push-ups`, `sit-ups`, and `lunges`.
- Extends the `EXERCISES`, `GOAL_PRESETS`, `getDefaultTarget`, and `createAnalyzers` mappings.

- [ ] **Step 1: Add failing readiness tests for each new exercise**

Add synthetic starting poses and assert:

```js
assert.equal(classifyExerciseReadiness('push-ups', pushUpTopPose()).poseReady, true);
assert.equal(classifyExerciseReadiness('sit-ups', sitUpLoweredPose()).poseReady, true);
assert.equal(classifyExerciseReadiness('lunges', lungeStandingPose()).poseReady, true);
```

Define fixture builders using the exact point coordinates and landmarks from Tasks 1–3, adding the opposite-side shoulder/hip/knee/ankle required by the classifier. Ensure each side-on fixture's required landmarks span at least `0.35` on the `x` axis; use a `0.60` `y` span for the standing lunge fixture. For each classifier, test a missing and a `0.2`-confidence required landmark, a required point with `x: 0.01`, an unsuitable orientation (front view for Push-ups/Sit-ups and front/side view for Lunges), an invalid start phase (elbow angle `130°`, trunk angle `40°`, or knee angle `130°`), and body spans below `0.35` and above `0.90` on that exercise's measurement axis. Test orientation boundaries explicitly: side-view classifiers accept `0.25` and reject `0.35`; neither boundary is accepted as three-quarter lunge readiness. Preserve the existing `0.02` frame margin and `0.35–0.90` body-span limits.

- [ ] **Step 2: Add failing setup/default and coaching tests**

In `test/goal-session.test.js`, assert `getDefaultTarget('push-ups') === 5`, `getDefaultTarget('sit-ups') === 6`, and `getDefaultTarget('lunges') === 10`; assert each accepts a valid custom target and normalizes `0` or `201` to its exercise default:

```js
for (const [exerciseId, expected] of [
  ['push-ups', 5],
  ['sit-ups', 6],
  ['lunges', 10],
]) {
  assert.equal(getDefaultTarget(exerciseId), expected);
  assert.equal(normalizeGoalTarget(exerciseId, 17), 17);
  assert.equal(normalizeGoalTarget(exerciseId, 0), expected);
  assert.equal(normalizeGoalTarget(exerciseId, 201), expected);
}
```

In `test/app.test.js`, extend `createReadyLandmarks(exerciseId)` with the side-on top/lowered fixtures and three-quarter standing fixture from the readiness tests, and keep `emitReadyFrames()` sending three frames for every ID. Select each new ID and assert its name and camera instructions appear. In `test/feedback.test.js`, add the English `alternate-legs` translation and assert a non-English lookup returns visible `translationStatus: 'unverified'`.

- [ ] **Step 3: Run focused readiness/setup tests and confirm failures**

Run: `node --test test\exercise-readiness.test.js test\goal-session.test.js test\app.test.js`

Expected: FAIL for the unsupported exercise IDs, missing analyzers, and absent goal defaults.

- [ ] **Step 4: Add exercise-specific readiness classifiers**

Add exercise-specific required landmark lists and classifiers in `readiness.js`; keep their tests in `test/exercise-readiness.test.js`:

- Push-ups: both shoulder/hip anchors plus one reliable shoulder/elbow/wrist/hip/ankle side; side orientation; safe-frame checks; horizontal body-span on the `x` axis because the top pose is side-on and nearly horizontal; top elbow angle `>=155°`; hip-line deviation ratio `<=0.10`.
- Sit-ups: reliable shoulder/hip/knee evidence; side orientation; safe-frame checks; horizontal body-span on the `x` axis for the lowered start pose; lowered trunk angle within `25°` of horizontal.
- Lunges: both hip/knee/ankle sides; three-quarter orientation where shoulder and hip width-to-torso ratios are each strictly between the existing `0.25` side and `0.35` front thresholds; safe-frame checks and vertical body-span on the `y` axis; both knees `>=155°`.

Return the existing structured result via `result(state, requiredIndices, landmarks, metrics)` so the readiness gate and diagnostics remain consistent.

- [ ] **Step 5: Register exercise metadata, analyzers, goals, and feedback**

Add IDs exactly as `push-ups`, `sit-ups`, and `lunges`. Use side-on instructions for Push-ups and Sit-ups and a three-quarter instruction for Lunges. Extend `createAnalyzers()` with each new constructor. Add preset targets `[5, 10, 15, 20, 25, 30, 50]` for each repetition exercise. Keep the existing repetition limit at `200` and Plank limit at `3600`. Add defaults `5`, `6`, and `10` respectively. Add English `alternate-legs` copy; rely on the current catalog's visible non-English unverified fallback instead of inventing unreviewed translations. Reuse existing localized `move-lower`, `return-to-start`, and `adjust-alignment` identifiers for analyzer feedback; do not emit additional identifiers without adding catalog entries.

- [ ] **Step 6: Run focused tests and full test suite**

Run: `node --test test\exercise-readiness.test.js test\goal-session.test.js test\app.test.js test\feedback.test.js test\exercises.test.js test\push-ups.test.js test\sit-ups.test.js test\lunges.test.js`

Expected: PASS; all six exercise IDs are selectable and each new analyzer starts only after its correct stable readiness pose.

Run: `npm test`

Expected: PASS with no regressions.

---

### Task 5: Capture Successful Completion Results in the Controller

**Files:**
- Modify: `src/ui/app.js`
- Test: `test/app.test.js`

**Interfaces:**
- Adds `completedWorkouts: []` to initial controller state.
- `finishWorkout()` records exactly one `{ exerciseId, exerciseName, target, unit, achieved, completedAt }` entry only when `processPose` verifies the selected target.
- Adds controller method `goToExerciseChooser()` that navigates Home without clearing session results or starting the camera.

- [ ] **Step 1: Add failing controller completion tests for all six exercise IDs**

Use a data-driven test with one injected analyzer per exercise. Each analyzer returns a valid count or elapsed time only after the test drives ready poses. Set each target to `1`, emit required stable readiness frames, then emit the valid goal-reaching analyzer result.

```js
for (const exerciseId of [
  'squats', 'jumping-jacks', 'plank', 'push-ups', 'sit-ups', 'lunges',
]) {
  test(`${exerciseId} completion records the achieved goal and releases tracking`, async () => {
    const harness = createHarness({
      autoReadiness: false,
      createAnalyzers: () => Object.fromEntries(
        ['squats', 'jumping-jacks', 'plank', 'push-ups', 'sit-ups', 'lunges']
          .map((id) => [id, {
            reset() {},
            invalidatePhase() {},
            update() {
              return id === 'plank'
                ? { elapsedMs: 2500, state: 'aligned', formValid: true }
                : { count: 3, state: 'complete', formValid: true };
            },
          }]),
      ),
    });
    harness.controller.selectExercise(exerciseId);
    harness.controller.setGoal(1);
    await harness.controller.start();
    emitReadyFrames(
      harness.trackers[0].callbacks.onPose,
      exerciseId,
    );

    const state = harness.controller.getState();
    assert.equal(state.workoutStatus, 'completed');
    assert.equal(state.completedWorkouts.length, 1);
    assert.equal(state.completedWorkouts[0].exerciseId, exerciseId);
    assert.equal(state.completedWorkouts[0].target, 1);
    assert.equal(state.completedWorkouts[0].achieved, 1);
    assert.equal(
      state.completedWorkouts[0].unit,
      exerciseId === 'plank' ? 'seconds' : 'reps',
    );
    assert.equal(Number.isFinite(state.completedWorkouts[0].completedAt), true);
    if (exerciseId === 'plank') {
      assert.equal(state.elapsedMs, 1000);
    } else {
      assert.equal(state.count, 1);
    }
    assert.equal(harness.cameraStops, 1);
    assert.equal(harness.trackers[0].stopCalls, 1);
  });
}
```

Also assert Plank completes only when `analysis.formValid === true` and `elapsedMs >= target * 1000`: with target `1`, output `elapsedMs: 999` across timestamps separated by several minutes and assert no result; output `elapsedMs: 1000` with `formValid: false` and assert no result; output `elapsedMs: 2500` with `formValid: true` and assert achieved time is capped to `1` second.

- [ ] **Step 2: Add failing non-success and idempotence tests**

Test that manual End, Pause, Reset, camera loss, and invalid form do not add a completed result. For invalid form, inject a fake analyzer result with `count: 1` or `elapsedMs: target * 1000` but `formValid: false`; the controller must reject it even if the readiness gate is ready. After successful completion, call the captured `onPose` callback repeatedly with valid landmarks and assert count, elapsed time, summary length, and completion announcements stay unchanged. Count completion feedback entries in the `createHarness` state snapshots: require exactly one `exercise-completed` entry for repetition exercises or `plank-completed` for Plank.

- [ ] **Step 3: Run focused controller tests and confirm failures**

Run: `node --test test\app.test.js`

Expected: FAIL because completed results are not stored and the chooser method is not exposed.

- [ ] **Step 4: Implement goal-only result capture and completion cleanup**

Only when the readiness gate is ready, `analysis.formValid === true`, and a repetition analyzer's count or Plank's valid `elapsedMs` reaches the selected target, clamp both the displayed progress and result `achieved` to the target, append one `{ exerciseId, exerciseName, target, unit, achieved, completedAt: Date.now() }` result, and invoke the existing idempotent finish path. Use `unit: 'seconds'` for Plank and `'reps'` otherwise. Ensure the finish path invalidates the run generation, stops tracker/camera, cancels playback, and blocks later frames. Keep manual `end()` separate from successful completion; preserve `completedWorkouts` during `end()` and new exercise selection. When selecting an exercise after completion, reset that workout's count/time even if the user selects the same exercise again, but retain the session results.

- [ ] **Step 5: Add and test the chooser navigation method**

Implement `goToExerciseChooser()` to set the Home view without calling `start()`, acquiring the camera, resetting completed results, or clearing the current session summary. Keep `goHome()` as the landing-top navigation and preserve completed results there too.

- [ ] **Step 6: Run focused controller tests**

Run: `node --test test\app.test.js`

Expected: PASS for all six goal-completion cases, cleanup, frozen progress, duplicate prevention, manual End, and session-result preservation.

---

### Task 6: Add Dedicated Completion and Session Summary Views

**Files:**
- Modify: `src/ui/app.js`
- Modify: `src/styles.css`
- Test: `test/app.test.js`

**Interfaces:**
- Adds a dedicated `renderCompletion(root, state)` screen derived from `state.view === 'workout' && state.workoutStatus === 'completed'`; the controller's existing `view` remains `home` or `workout`.
- Uses the controller's `goToExerciseChooser()` for “Next Workout” and `goHome()` for “Back to Home”.
- Renders `state.completedWorkouts` in the Home session summary without persistent storage.
- Adds optional `controllerOptions` to `mountApp(root, options)` so browser/UI tests can provide fake camera, tracker, and analyzer dependencies without changing production startup defaults.
- Adds `formatWorkoutQuantity(value, unit, { valid = false } = {})` for singular/plural rep/second labels in the completion and Home summaries.

Add `controllerOptions = {}` to the existing `mountApp` options destructuring. Spread test-only camera, tracker, analyzer, and storage dependencies before app-owned values so tests cannot replace rendering, speech, or media-element wiring:

```js
controller = createWorkoutController({
  ...controllerOptions,
  onState: render,
  speechCoach: coach,
  audioCoach,
  voicePlayback: playbackManager,
  getMediaElements: () => ({
    video: root.querySelector('video'),
    canvas: root.querySelector('canvas'),
  }),
});
```

- [ ] **Step 1: Add failing markup and action tests**

Drive completion through `mountApp` with `controllerOptions` supplying a fake camera, fake tracker, and a test analyzer that reports one valid rep (or 1000 valid Plank milliseconds) after stable readiness. The root stub returns fake `video` and `canvas` elements for those selectors, records event callbacks, and returns focus/scroll spies for `#exercise-selection`, `#exercises-title`, and `#welcome-title`. Assert the rendered markup includes the exact heading, exercise, achieved amount, selected goal, goal-achieved statement, success icon, “Next Workout,” and “Back to Home,” and contains no ad/commercial markup. Assert completion controls do not include Start/Pause/Resume/Reset/End. For each of the six exercise IDs, mount a fresh root/controller, reach completion, dispatch each delegated click action, and assert Next Workout focuses/scrolls to the chooser and Home focuses the landing top without another camera start.

- [ ] **Step 2: Implement dedicated completion rendering**

Render the completion view instead of the active workout page when state is completed:

```js
function formatWorkoutQuantity(value, unit, { valid = false } = {}) {
  const noun = unit === 'seconds'
    ? (value === 1 ? 'second' : 'seconds')
    : (value === 1 ? 'rep' : 'reps');
  return `${valid && unit === 'seconds' ? 'valid ' : ''}${value} ${noun}`;
}

function renderCompletion(root, state) {
  const result = state.completedWorkouts.at(-1);
  const achieved = formatWorkoutQuantity(result.achieved, result.unit, { valid: true });
  const goal = formatWorkoutQuantity(result.target, result.unit);
  root.innerHTML = `
    <main class="completion-page">
      <section class="completion-card" aria-live="polite">
        <div class="completion-icon" aria-hidden="true">✓</div>
        <h1 data-completion-title tabindex="-1">Workout Completed!</h1>
        <p>Amazing work! You did it.</p>
        <p>${escapeHtml(result.exerciseName)}</p>
        <p>${achieved}</p>
        <p>Goal: ${goal} — goal achieved</p>
        <button class="button button--primary" data-action="next-workout">Next Workout</button>
        <button class="button button--quiet" data-action="home">Back to Home</button>
      </section>
    </main>`;
}
```

In the `mountApp` render function, derive the screen key as `completion` when `state.view === 'workout' && state.workoutStatus === 'completed'`, otherwise use `state.view`. Render Home, Workout, or Completion when that derived key changes; on transition to Completion focus `[data-completion-title]`. For repeated state notifications while the derived key remains Completion, update no markup, so the polite announcement is not recreated.

```js
const screen = state.view === 'workout' && state.workoutStatus === 'completed'
  ? 'completion'
  : state.view;
```

- [ ] **Step 3: Implement Next Workout and Back to Home DOM behavior**

Wire the actions with the existing delegated click listener:

```js
case 'next-workout':
  controller.goToExerciseChooser();
  root.querySelector('#exercise-selection')?.scrollIntoView?.();
  root.querySelector('#exercises-title')?.focus?.();
  break;
case 'home':
  controller.goHome();
  root.querySelector('#welcome-title')?.scrollIntoView?.({ block: 'start' });
  root.querySelector('#welcome-title')?.focus?.();
  break;
```

Exercise-card selection must continue to call `selectExercise()` and leave the camera off until Start.

- [ ] **Step 4: Render the session-only history on Home**

When `completedWorkouts.length > 0`, render a “Completed this session” section listing the exercise, achieved reps/seconds, and goal. Escape the exercise name with the existing `escapeHtml` helper:

```js
const sessionSummary = state.completedWorkouts.length
  ? `<section class="session-summary" aria-labelledby="session-summary-title">
       <h2 id="session-summary-title">Completed this session</h2>
       <ul>${state.completedWorkouts.map((item) =>
         `<li>${escapeHtml(item.exerciseName)}: ${formatWorkoutQuantity(item.achieved, item.unit)} of ${formatWorkoutQuantity(item.target, item.unit)}</li>`,
       ).join('')}</ul>
     </section>`
  : '';
```

Insert `sessionSummary` in Home before `#exercise-selection`. Do not use localStorage, cookies, or network APIs for this list.

- [ ] **Step 5: Style the completion and history views responsively**

Use existing SabiBody tokens (`--ink`, `--muted`, `--forest`, `--forest-deep`, `--lime`, `--paper`, `--white`, `--line`, `--line-strong`, and `--shadow-soft`), the existing `0.9rem` button radius, and the existing rounded completion card:

```css
.completion-page { display: grid; min-height: 100svh; place-items: center; padding: clamp(1rem, 4vw, 2.5rem); }
.completion-card { width: min(100%, 34rem); text-align: center; }
.completion-card h1 { margin: 0; color: var(--forest-deep); font-family: var(--display); }
.completion-card [data-action] { min-height: 44px; width: 100%; }
@media (prefers-reduced-motion: no-preference) {
  .completion-icon { animation: completion-pop 420ms ease-out both; }
}
@keyframes completion-pop {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}
@media (max-width: 600px) {
  .completion-card { padding: 1.25rem; }
}
```

Use the existing card background, border, shadow, and radius declarations as the base; add only completion-scoped rules. Keep the existing desktop workout layout unchanged.

- [ ] **Step 6: Run UI tests and build**

Run: `node --test test\app.test.js`

Expected: PASS for markup, accessibility attributes, action routing, retained session results, and no camera start from Next Workout.

Run: `npm run build`

Expected: PASS.

---

### Task 7: Verify the Six-Exercise Completion Experience

**Files:**
- Modify only if validation exposes a defect: the task-owned files above.
- Tests: `test/push-ups.test.js`, `test/sit-ups.test.js`, `test/lunges.test.js`, `test/exercises.test.js`, `test/exercise-readiness.test.js`, `test/goal-session.test.js`, `test/feedback.test.js`, `test/app.test.js`.

- [ ] **Step 1: Run the targeted six-exercise test set**

Run:

```powershell
node --test test\push-ups.test.js test\sit-ups.test.js test\lunges.test.js test\exercises.test.js test\exercise-readiness.test.js test\goal-session.test.js test\feedback.test.js test\app.test.js
```

Expected: PASS, including completion and both navigation actions exercised for each exercise.

- [ ] **Step 2: Run the full test suite and production build**

Run: `npm test`

Expected: PASS with no regressions.

Run: `npm run build`

Expected: PASS; no new dependencies or pose engines are bundled.

- [ ] **Step 3: Inspect the real rendered completion view in the browser**

Run `npm run dev` and open `http://localhost:5176`. Use the Vite-served `mountApp` module to mount a temporary test root in the browser with `controllerOptions` injecting a fake stream/tracker and analyzers. Feed each exercise's stable ready pose and goal-reaching output to render the actual completion markup and production CSS without requesting camera permission. At viewport widths `320`, `360`, `375`, `390`, `430`, and `480` pixels, then desktop, verify `document.documentElement.scrollWidth <= document.documentElement.clientWidth`, the completion card and text fit, both buttons have bounding-box height `>=44px`, no completion text is clipped, keyboard focus reaches the heading and actions, no camera preview or active workout controls remain, and repeated frames do not re-announce or redraw completion. Dispatch Next Workout and Back to Home and confirm the camera start count does not increase; verify the session summary remains visible after either action.

- [ ] **Step 4: Confirm user changes and index remain preserved**

Run: `git status --short` and `git diff --cached --stat`. Confirm unrelated pre-existing edits remain and the index matches its pre-task state; do not stage or commit.

- [ ] **Step 5: Record validation outcome**

Do not claim real-world exercise accuracy. Report automated synthetic results separately from any webcam observation; real-camera threshold tuning remains a follow-up validation activity.
