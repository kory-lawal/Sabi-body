# MediaPipe Landmark Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-frame raw MediaPipe landmark evidence to the existing development-only diagnostics without changing recognition or workout behavior.

**Architecture:** Add pure helpers that serialize each landmark and compose the existing diagnostics payload. The workout controller captures this snapshot only when development diagnostics are enabled, and the existing diagnostics renderer displays it alongside readiness, phase, rejection, and metrics fields.

**Tech Stack:** JavaScript ES modules, MediaPipe Tasks Vision (existing), Node.js built-in test runner, Vite.

**Spec:** [2026-11-10-mediapipe-landmark-diagnostics-design.md](../specs/2026-11-10-mediapipe-landmark-diagnostics-design.md)

## Global Constraints

- “Keep the existing browser MediaPipe model, camera pipeline, `onPose` callback, readiness gate, exercise analyzers, and YarnGPT integration unchanged.”
- “Effective confidence is the minimum of the available `visibility` and `presence` scores and must meet the existing `0.6` threshold.”
- “The snapshot exists only in development state and is rendered only inside the existing development-only diagnostics panel. It is not persisted, transmitted, or included in production UI.”
- “No raw image, video, world-landmark, or additional user data is added to the diagnostics payload.”
- “There are no new network calls, storage operations, or broad exception handlers.”
- “Changing confidence thresholds, smoothing, readiness, or exercise counting” is out of scope.

---

## File Structure

- `src/pose/pose-diagnostics.js` — Pure serialization for indexed image landmarks and the diagnostics payload; reuses existing confidence and visibility helpers.
- `src/exercises/geometry.js` — Commit the required reusable landmark-confidence and visibility helpers while leaving unrelated working-tree geometry changes unstaged.
- `test/pose-diagnostics.test.js` — Unit tests for complete, low-confidence, missing, sparse, and non-finite landmarks and the composed diagnostics payload.
- `src/ui/app.js` — Captures a development-only per-frame snapshot and renders it in the existing diagnostics JSON.
- `test/app.test.js` — Verifies development snapshots update through the controller and are absent when diagnostics are disabled.

## Task 1: Create Pure Pose Diagnostics Helpers

**Files:**
- Create: `src/pose/pose-diagnostics.js`
- Test: `test/pose-diagnostics.test.js`

**Interfaces:**
- Produces `serializeLandmarkDiagnostics(landmarks)`, accepting an array of MediaPipe image landmarks (including null or sparse entries) and returning an indexed array of records with `index`, `x`, `y`, `visibility`, `presence`, `confidence`, and `visible`.
- Produces `createPoseDiagnostics(state)`, accepting the workout diagnostic state and returning the current camera/readiness/form/phase/rejection/metrics fields plus `landmarks`.
- Consumes `getLandmarkConfidence` and `isVisible` from `src/exercises/geometry.js`; it does not duplicate or alter their rules.

- [ ] **Step 1: Write failing tests for the landmark serializer and payload**

Create `test/pose-diagnostics.test.js` with these assertions:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPoseDiagnostics,
  serializeLandmarkDiagnostics,
} from '../src/pose/pose-diagnostics.js';

test('landmark diagnostics preserve confidence and visibility evidence by index', () => {
  const landmarks = [
    { x: 0.4, y: 0.3, visibility: 0.9, presence: 0.8 },
    { x: 0.4, y: 0.3, visibility: 0.4, presence: 0.8 },
    null,
    { x: Number.NaN, y: Number.POSITIVE_INFINITY, visibility: undefined, presence: 0.9 },
  ];

  assert.deepEqual(serializeLandmarkDiagnostics(landmarks), [
    { index: 0, x: 0.4, y: 0.3, visibility: 0.9, presence: 0.8, confidence: 0.8, visible: true },
    { index: 1, x: 0.4, y: 0.3, visibility: 0.4, presence: 0.8, confidence: 0.4, visible: false },
    { index: 2, x: null, y: null, visibility: null, presence: null, confidence: null, visible: false },
    { index: 3, x: null, y: null, visibility: null, presence: 0.9, confidence: 0.9, visible: false },
  ]);
});

test('landmark diagnostics retain sparse indices and represent absent pose data as empty', () => {
  const landmarks = [];
  landmarks.length = 2;
  landmarks[1] = { x: 0.5, y: 0.5, visibility: 0.7 };

  assert.deepEqual(serializeLandmarkDiagnostics(landmarks), [
    { index: 0, x: null, y: null, visibility: null, presence: null, confidence: null, visible: false },
    { index: 1, x: 0.5, y: 0.5, visibility: 0.7, presence: null, confidence: 0.7, visible: true },
  ]);
  assert.deepEqual(serializeLandmarkDiagnostics(undefined), []);
});

test('pose diagnostics preserve existing fields and add serialized landmarks', () => {
  const state = {
    cameraStatus: 'ready',
    readinessState: 'ready',
    readinessReady: true,
    readinessReasonId: null,
    movementPhase: 'standing',
    formValid: true,
    rejectionReasonId: null,
    diagnosticMetrics: { exercise: { kneeAngle: 170 } },
    diagnosticLandmarks: serializeLandmarkDiagnostics([
      { x: 0.4, y: 0.3, visibility: 0.9, presence: 0.8 },
    ]),
  };

  assert.deepEqual(createPoseDiagnostics(state), {
    cameraStatus: 'ready',
    readinessState: 'ready',
    readinessReady: true,
    readinessReasonId: null,
    movementPhase: 'standing',
    formValid: true,
    rejectionReasonId: null,
    metrics: { exercise: { kneeAngle: 170 } },
    landmarks: [
      { index: 0, x: 0.4, y: 0.3, visibility: 0.9, presence: 0.8, confidence: 0.8, visible: true },
    ],
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the module is missing**

Run: `node --test test\pose-diagnostics.test.js`

Expected: FAIL with the missing `src/pose/pose-diagnostics.js` module.

- [ ] **Step 3: Implement the pure helpers**

Create `src/pose/pose-diagnostics.js`:

```js
import {
  getLandmarkConfidence,
  isVisible,
} from '../exercises/geometry.js';

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function serializeLandmarkDiagnostics(landmarks) {
  if (!Array.isArray(landmarks)) {
    return [];
  }

  return Array.from({ length: landmarks.length }, (_, index) => {
    const landmark = landmarks[index];
    return {
      index,
      x: finiteOrNull(landmark?.x),
      y: finiteOrNull(landmark?.y),
      visibility: finiteOrNull(landmark?.visibility),
      presence: finiteOrNull(landmark?.presence),
      confidence: getLandmarkConfidence(landmark),
      visible: isVisible(landmark),
    };
  });
}

export function createPoseDiagnostics(state) {
  return {
    cameraStatus: state.cameraStatus,
    readinessState: state.readinessState,
    readinessReady: state.readinessReady,
    readinessReasonId: state.readinessReasonId,
    movementPhase: state.movementPhase,
    formValid: state.formValid,
    rejectionReasonId: state.rejectionReasonId,
    metrics: state.diagnosticMetrics,
    landmarks: state.diagnosticLandmarks,
  };
}
```

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run: `node --test test\pose-diagnostics.test.js`

Expected: PASS for all three tests, including the existing confidence semantics and missing/non-finite values.

- [ ] **Step 5: Commit the helper and its tests**

Stage only `src/pose/pose-diagnostics.js` and `test/pose-diagnostics.test.js`, then commit:

```text
feat: add MediaPipe pose diagnostics serializer
```

## Task 2: Wire Development Diagnostics Into the Workout Controller

**Files:**
- Modify: `src/ui/app.js`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes `serializeLandmarkDiagnostics(landmarks)` and `createPoseDiagnostics(state)` from Task 1.
- Adds the controller option `diagnosticsEnabled`, defaulting to `import.meta.env?.DEV === true`; tests may set it explicitly.
- When enabled, the controller state exposes the current frame as `diagnosticLandmarks`; when disabled, it exposes an empty list.

- [ ] **Step 1: Add failing controller tests for enabled and disabled diagnostics**

Extend `createHarness` in `test/app.test.js` with a `diagnosticsEnabled = false` option and pass it to `createWorkoutController`. Add tests that:

1. Start a harness with diagnostics enabled and automatic readiness disabled, emit three ready squat frames, then assert `controller.getState().diagnosticLandmarks[11]` contains index `11`, the expected normalized coordinates, visibility, presence, effective confidence, and `visible: true`.
2. Start a default harness, emit the same frames, then assert `controller.getState().diagnosticLandmarks` is `[]`.

Run: `node --test test\app.test.js`

Expected: FAIL because the controller does not yet accept or publish `diagnosticLandmarks`.

- [ ] **Step 2: Capture landmarks only when development diagnostics are enabled**

In `src/ui/app.js`, import both Task 1 helpers. Add `diagnosticLandmarks: []` to initial state. Add `diagnosticsEnabled = import.meta.env?.DEV === true` to `createWorkoutController` options, then set `diagnosticLandmarks` inside the `processPose` state update to:

```js
diagnosticLandmarks: diagnosticsEnabled
  ? serializeLandmarkDiagnostics(landmarks)
  : [],
```

Replace the inline diagnostics object in `updateWorkout` with `createPoseDiagnostics(state)` while retaining its current JSON formatting and non-finite-number replacer.

- [ ] **Step 3: Run the focused tests and confirm they pass**

Run: `node --test test\pose-diagnostics.test.js test\app.test.js`

Expected: PASS; enabled diagnostics update per frame, disabled diagnostics remain empty, and existing controller behavior tests pass.

- [ ] **Step 4: Run the full frontend tests and production build**

Run: `npm test`

Expected: PASS with no regressions in the existing test suite.

Run: `npm run build`

Expected: PASS; the production bundle does not render the development-only diagnostics panel or capture landmark snapshots by default.

- [ ] **Step 5: Commit only the controller and test changes**

Stage only `src/ui/app.js` and `test/app.test.js`, then commit:

```text
feat: expose MediaPipe landmarks in dev diagnostics
```

## Task 3: Include Committed Landmark Visibility Helpers

The diagnostics helper imports `getLandmarkConfidence` and uses `isVisible`.
Those exports and the approved weakest-score / normalized-coordinate semantics
are present in the user's working-tree version of `geometry.js` but absent or
different in the committed baseline. Commit only the required helper hunk so a
clean checkout can load and test the diagnostics code; preserve unrelated
geometry edits.

**Files:**
- Modify and stage only the required helper hunk: `src/exercises/geometry.js`
- Modify and stage only the added threshold/bounds test: `test/pose-diagnostics.test.js`

**Interfaces:**
- `getLandmarkConfidence(landmark)` returns the weakest available finite visibility/presence score, or `null`.
- `isVisible(landmark, threshold = 0.6)` requires finite normalized coordinates in `[0, 1]` and confidence at least the threshold.
- `hasFullBodyVisible` explicitly retains its existing `0.55` threshold.

- [ ] **Step 1: Add a regression test for the approved minimum confidence and framing rules**

Add a test to `test/pose-diagnostics.test.js` asserting that a landmark with coordinates `(0.5, 0.5)`, visibility `0.55`, and presence `0.9` serializes with `confidence: 0.55` and `visible: false`, and that a landmark with `x: 1.01`, `y: 0.5`, visibility `0.9`, and presence `0.9` serializes with `visible: false`.

The current dirty working copy already contains these semantics, so this test is expected to pass there. The failing clean-baseline evidence is the checked-in `geometry.js` at the recorded commit: it has no `getLandmarkConfidence` export and its `isVisible` uses the strongest score with a `0.55` default.

- [ ] **Step 2: Create and validate an index-only helper patch**

Build a patch against the current index that adds `getLandmarkConfidence`, updates `isVisible` to the interface above without depending on uncommitted helpers, and makes `hasFullBodyVisible` explicitly call `isVisible(landmarks[index], 0.55)`. Run `git apply --cached --check` first. The patch must not contain unrelated `geometry.js` changes.

- [ ] **Step 3: Stage only the helper patch and the new regression test**

Apply the validated helper patch to the index and stage only `test/pose-diagnostics.test.js`. Inspect `git diff --cached -- src/exercises/geometry.js test/pose-diagnostics.test.js`; confirm it contains only the helper/visibility behavior and regression test. Leave all other pre-existing geometry changes unstaged.

- [ ] **Step 4: Validate the focused tests, full suite, and production build**

Run: `node --test test\pose-diagnostics.test.js`

Expected: PASS for all pose-diagnostics tests.

Run: `npm test`

Expected: PASS with no regressions.

Run: `npm run build`

Expected: PASS with the same development-only diagnostics behavior.

- [ ] **Step 5: Commit only the validated helper and regression test**

Commit the staged patch with:

```text
fix: commit landmark confidence semantics
```
