# Workout Readiness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep all existing workouts in positioning until their required landmarks and starting pose remain valid for 400 ms, without changing their repetition or plank timing rules.

**Architecture:** Add a small reusable stable-pose gate and a `checkReady(landmarks, timestamp)` method to each current analyzer. The workout controller keeps the camera preview active while positioning and transitions to running, countdown, and coaching only after readiness passes.

**Tech Stack:** JavaScript ES modules, MediaPipe Tasks Vision landmarks, Node.js built-in test runner, Vite.

**Spec:** [../specs/2026-11-14-six-mediapipe-exercises-design.md](../specs/2026-11-14-six-mediapipe-exercises-design.md)

## Global Constraints

- This plan gates the six existing exercises; the dependent six-exercise plan adds the same gate to the new analyzers, completing all 12.
- Require a stable 400 ms starting pose before countdown and active progress.
- Do not accrue repetitions or duration during initial positioning.
- Keep existing exercise thresholds, cycle rules, MediaPipe, and single speech queue.
- Synthetic landmark tests do not establish real-camera accuracy.

---

## File map

- Create `src/exercises/readiness.js` for the shared stable-pose timing contract.
- Modify `src/exercises/squat.js`, `jumping-jacks.js`, `plank.js`, `push-ups.js`, `sit-ups.js`, and `lunges.js` to expose readiness without changing `update`.
- Add focused tests in `test/exercises.test.js`, `test/push-ups.test.js`, `test/sit-ups.test.js`, and `test/lunges.test.js`.
- Modify `src/ui/app.js` to process positioning frames and gate the active transition.
- Modify `test/app.test.js` to replace the immediate-start expectation with the readiness lifecycle.

## Task 1: Add a stable-pose readiness helper

**Files:**
- Create: `src/exercises/readiness.js`
- Create: `test/readiness.test.js`

**Interfaces:**
- Consumes: a `measureStartPose(landmarks)` callback returning `{ poseReady, feedbackId, rejectionReasonId, metrics }`.
- Produces: `createStartPoseGate(measureStartPose, { stableMs = 400, gapMs = 500 } = {})`, returning `{ check, reset }`. `check(landmarks, timestamp)` returns the measured fields plus `ready`, which is true only after a stable 400 ms window.

- [ ] **Step 1: Write helper behavior tests**

```js
const measureReady = () => ({
  poseReady: true,
  feedbackId: null,
  rejectionReasonId: null,
  metrics: {},
});
const gate = createStartPoseGate(measureReady);
assert.equal(gate.check([], 0).ready, false);
assert.equal(gate.check([], 399).ready, false);
assert.equal(gate.check([], 400).ready, true);
```

Also assert that an invalid pose, a timestamp reversal, or a gap of at least 500 ms clears the stable window.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test test/readiness.test.js`
Expected: FAIL because `src/exercises/readiness.js` does not exist.

- [ ] **Step 3: Implement the shared gate**

Use the declared signature. On invalid measurement or timestamp, clear `readySince`; on a valid pose, restart the window after a backwards timestamp or a 500 ms tracking gap. Return `ready: timestamp - readySince >= stableMs`. `reset()` clears both timestamps.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `node --test test/readiness.test.js`
Expected: PASS for stable duration, invalid-pose reset, time reversal, and tracking-gap reset.

- [ ] **Step 5: Commit**

```text
git add src/exercises/readiness.js test/readiness.test.js
git commit -m "feat: add stable pose readiness gate" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 2: Gate squat readiness without changing squat counts

**Files:**
- Modify: `src/exercises/squat.js`
- Test: `test/exercises.test.js`

**Interfaces:**
- Consumes: `createStartPoseGate` and the existing standing-side measurement.
- Produces: `checkReady(landmarks, timestamp)` on the squat analyzer. It requires the existing visible hip, knee, and ankle measurement in the standing range.

- [ ] **Step 1: Add failing squat readiness assertions**

Assert that a standing pose at 0 ms is not ready, the same pose at 400 ms is ready, and calling readiness does not increment `count`. Assert that a bent pose resets readiness.

- [ ] **Step 2: Run `node --test test/exercises.test.js` and verify the new assertions fail because `checkReady` is missing**
- [ ] **Step 3: Add `checkReady` using the shared gate; reset the gate from `reset` and `invalidatePhase`, leaving `update` thresholds untouched**
- [ ] **Step 4: Run `node --test test/exercises.test.js` and verify existing squat tests plus readiness assertions pass**
- [ ] **Step 5: Commit with `feat: add squat start readiness` and the required Copilot co-author trailer**

## Task 3: Gate jumping-jack readiness

**Files:**
- Modify: `src/exercises/jumping-jacks.js`
- Test: `test/exercises.test.js`

**Interfaces:**
- Consumes: the existing `measurePose` result.
- Produces: `checkReady` that returns ready only for the existing closed stance with arms down and feet together, stable for 400 ms.

- [ ] **Step 1: Test the closed pose at 0 ms and 400 ms, an open pose reset, and zero count during readiness**
- [ ] **Step 2: Run `node --test test/exercises.test.js`; confirm failure on missing `checkReady`**
- [ ] **Step 3: Add the readiness gate without changing the open/closed rep cycle**
- [ ] **Step 4: Run `node --test test/exercises.test.js`; confirm all jumping-jack and existing exercise tests pass**
- [ ] **Step 5: Commit with `feat: add jumping jack start readiness` and the required trailer**

## Task 4: Gate plank readiness without accruing hold time

**Files:**
- Modify: `src/exercises/plank.js`
- Test: `test/exercises.test.js`

**Interfaces:**
- Consumes: the existing side-orientation and alignment measurement.
- Produces: `checkReady` that returns ready only after the current plank alignment criteria remain valid for 400 ms. It must not call `update` or alter `elapsedMs`.

- [ ] **Step 1: Test that the stable aligned pose becomes ready at 400 ms while `elapsedMs` stays zero; test that misalignment and tracking loss reset readiness**
- [ ] **Step 2: Run `node --test test/exercises.test.js`; confirm the new readiness assertions fail**
- [ ] **Step 3: Implement readiness with the shared gate and preserve all current timer constants and update behavior**
- [ ] **Step 4: Run `node --test test/exercises.test.js`; confirm plank timing regressions remain green**
- [ ] **Step 5: Commit with `feat: add plank start readiness` and the required trailer**

## Task 5: Gate push-up readiness

**Files:**
- Modify: `src/exercises/push-ups.js`
- Test: `test/push-ups.test.js`

**Interfaces:**
- Consumes: existing visible shoulder, elbow, wrist, and hip measurements.
- Produces: `checkReady` for the existing extended top position, with no count changes.

- [ ] **Step 1: Add a test for a stable extended pose, a bent pose, and zero repetitions while checking readiness**
- [ ] **Step 2: Run `node --test test/push-ups.test.js`; confirm failure because `checkReady` is missing**
- [ ] **Step 3: Add the readiness gate and reset it from analyzer reset/invalidation**
- [ ] **Step 4: Run `node --test test/push-ups.test.js`; verify all existing push-up cycles still pass**
- [ ] **Step 5: Commit with `feat: add push-up start readiness` and the required trailer**

## Task 6: Gate sit-up readiness

**Files:**
- Modify: `src/exercises/sit-ups.js`
- Test: `test/sit-ups.test.js`

**Interfaces:**
- Consumes: existing trunk measurement.
- Produces: `checkReady` for the existing lowered starting posture, stable for 400 ms.

- [ ] **Step 1: Add a test for a stable lowered pose, a raised pose, and zero repetitions during readiness**
- [ ] **Step 2: Run `node --test test/sit-ups.test.js`; confirm failure because `checkReady` is missing**
- [ ] **Step 3: Implement the readiness gate without changing the rise/return thresholds**
- [ ] **Step 4: Run `node --test test/sit-ups.test.js`; verify existing sit-up cycle tests pass**
- [ ] **Step 5: Commit with `feat: add sit-up start readiness` and the required trailer**

## Task 7: Gate lunge readiness

**Files:**
- Modify: `src/exercises/lunges.js`
- Test: `test/lunges.test.js`

**Interfaces:**
- Consumes: existing visible hip, knee, and ankle measurements.
- Produces: `checkReady` for the upright starting stance, stable for 400 ms.

- [ ] **Step 1: Add tests for a stable standing pose, a bent lunge pose, and zero counts during readiness**
- [ ] **Step 2: Run `node --test test/lunges.test.js`; confirm failure because `checkReady` is missing**
- [ ] **Step 3: Implement the readiness gate while preserving alternating-leg lunge counting**
- [ ] **Step 4: Run `node --test test/lunges.test.js`; verify existing lunge behavior passes**
- [ ] **Step 5: Commit with `feat: add lunge start readiness` and the required trailer**

## Task 8: Keep the workout positioning until readiness passes

**Files:**
- Modify: `src/ui/app.js`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: each analyzer's `checkReady(landmarks, timestamp)` result.
- Produces: camera-ready positioning state followed by a single transition to running, countdown, and exercise instruction.

- [ ] **Step 1: Replace the immediate-start controller test**

Update `workout starts analyzing when tracker startup completes without a ready pose` so tracker startup leaves the controller in `loading` with `cameraStatus: 'ready'` and `readinessReady: false`. Inject an analyzer whose `checkReady` returns false until the 400 ms test interval, then true. Assert there is no rep update or countdown before readiness.

- [ ] **Step 2: Run `node --test test/app.test.js`; confirm the new test fails against immediate-running behavior**
- [ ] **Step 3: Update `processPose` to call only `checkReady` while loading, update positioning feedback, and return without calling `update`. On readiness, transition once to running, then queue countdown and the exercise instruction. Leave normal running frames on the existing `update` path**
- [ ] **Step 4: Update tracker initialization to keep `workoutStatus: 'loading'` after camera/tracker startup; rely on the existing positioning label until readiness**
- [ ] **Step 5: Run `node --test test/app.test.js`; verify startup, pause/resume, camera cleanup, speech deduplication, and completion tests pass**
- [ ] **Step 6: Commit with `feat: gate workout start on pose readiness` and the required trailer**

## Task 9: Run existing-exercise regression checks

**Files:**
- No source changes unless a regression is found.

- [ ] **Step 1: Run `node --test test/readiness.test.js test/exercises.test.js test/push-ups.test.js test/sit-ups.test.js test/lunges.test.js test/app.test.js`**
- [ ] **Step 2: Run `npm test` and `npm run build`**
- [ ] **Step 3: Run `git diff --check`**
- [ ] **Step 4: Record failures with exact test names; fix only regressions introduced by the gate and rerun the failing selector**

