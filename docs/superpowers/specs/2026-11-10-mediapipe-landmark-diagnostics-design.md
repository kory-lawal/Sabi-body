# MediaPipe Landmark Diagnostics Design

## Status

Design approved in chat; awaiting user review before implementation planning.

## Context

SabiBody already runs MediaPipe Pose Landmarker in the browser and passes its
image landmarks to exercise-readiness checks and exercise analyzers. The
development-only Pose diagnostics panel currently reports camera/readiness
state, movement phase, form validity, rejection reason, and analyzer metrics.
It does not expose the per-frame landmark coordinates or confidence evidence
used by those checks.

The existing visibility rule requires finite normalized `x` and `y`
coordinates within `[0, 1]`, plus at least one finite confidence score.
Effective confidence is the minimum of the available `visibility` and
`presence` scores and must meet the existing `0.6` threshold. This design
does not change that policy or any exercise behavior.

## Goal

Make the current MediaPipe landmark evidence inspectable alongside the
existing exercise metrics, phases, and rejection reasons, so later accuracy
work can be guided by testable evidence rather than speculative threshold
tuning.

## Design

Keep the existing browser MediaPipe model, camera pipeline, `onPose` callback,
readiness gate, exercise analyzers, and YarnGPT integration unchanged. In
development builds, capture the raw image-landmark array supplied to the
workout controller and add a compact diagnostic representation to the
existing collapsible Pose diagnostics JSON.

Each available array slot is represented by its landmark `index`, normalized
`x` and `y`, raw `visibility` and `presence`, effective `confidence`, and a
`visible` boolean evaluated with the existing visibility rule. This is the
raw MediaPipe input, not a smoothed copy; current readiness and exercise
metrics remain separately available as before. Coordinates and confidence
values that are absent or non-finite are represented as `null`; a missing
landmark is retained by index with null measurements and `visible: false`.
An absent/non-array pose is represented as an empty list.

For example:

```json
{
  "index": 11,
  "x": 0.4,
  "y": 0.3,
  "visibility": 0.9,
  "presence": 0.8,
  "confidence": 0.8,
  "visible": true
}
```

The snapshot exists only in development state and is rendered only inside the
existing development-only diagnostics panel. It is not persisted, transmitted,
or included in production UI. No raw image, video, world-landmark, or
additional user data is added to the diagnostics payload.

## Data flow

1. `createPoseTracker` continues producing the same MediaPipe image landmarks
   and invoking the existing `onPose` callback.
2. The workout controller captures the raw image landmarks for the current
   frame only when development diagnostics are enabled.
3. The existing diagnostics renderer serializes that snapshot with the
   existing camera/readiness/form/phase/rejection/metrics fields.
4. The exercise analyzers continue receiving and processing landmarks exactly
   as they do now; diagnostic capture does not feed back into recognition.

## Error and privacy behavior

Missing landmark entries and missing confidence channels are represented
explicitly rather than silently treated as visible. Non-finite numeric values
are serialized as `null`, consistent with the diagnostics renderer's existing
handling of non-finite metrics. There are no new network calls, storage
operations, or broad exception handlers.

## Scope

### In scope

- Add per-frame raw image-landmark evidence to the development diagnostics
  payload.
- Preserve the existing effective-confidence and visibility semantics.
- Keep current joint/pose metrics, movement phases, and rejection reasons in
  the same diagnostics view.
- Add focused tests for serialization of complete, low-confidence, missing,
  and non-finite landmark data, plus a controller-level update test.
- Confirm production build output does not expose the development diagnostics.

### Out of scope

- Changing MediaPipe, its model, inference settings, or camera lifecycle.
- Changing confidence thresholds, smoothing, readiness, or exercise counting.
- Adding a pose engine or altering the camera pipeline.
- Adding new joint-angle measurements or new exercise rejection rules.
- Changing coaching messages, voice synthesis, or YarnGPT behavior.
- Real-world webcam accuracy claims; physical testing remains a separate step.

## Acceptance criteria

1. For a development frame, the diagnostics JSON contains the indexed raw
   image-landmark snapshot and the existing diagnostic fields.
2. Landmark entries expose coordinates, visibility, presence, effective
   confidence, and the result of the existing visibility check without
   changing those checks.
3. Missing and non-finite values are explicit and JSON-safe.
4. The diagnostic snapshot is not added to production UI or persisted or sent
   off-device.
5. Existing camera behavior, readiness, counts, plank elapsed time, coaching,
   and all supported workout routes retain their behavior.
6. Focused tests cover the diagnostic data shape and controller integration;
   the frontend test suite and production build pass.

## Implementation surface

- `src/ui/app.js`: capture and render the development-only diagnostic snapshot.
- `test/app.test.js`: verify controller integration and unchanged workout
  behavior.
- A focused test module for the pure landmark diagnostic serialization helper
  if implementation extracts one for direct unit testing.

## Validation

Run the focused diagnostics and controller tests, then the frontend test suite
and production build. Physical webcam validation is intentionally deferred and
must be reported separately from synthetic-test results.
