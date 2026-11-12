# Simple MediaPipe Exercise Detection Design

**Status:** Approved design; implementation has not started.

## Goal

Replace the over-restrictive exercise detection behavior with practical, responsive movement tracking. Keep MediaPipe Pose, the existing camera pipeline, workout screen, exercise images, goals, voice features, and completion behavior.

## Approved behavior

- Start analyzing as soon as the camera and pose tracker are running. Do not wait for an exercise-specific ready pose.
- Use only the landmarks needed by the selected movement. Require finite coordinates for those points, but do not apply a global confidence threshold, full-body framing rule, multi-frame stability gate, or landmark smoothing.
- For repetitions, keep a small movement-cycle latch with separate movement and return thresholds. Increment once per completed cycle; preserve the count across tracking gaps and reset only an incomplete cycle after a sustained gap.
- Keep each exercise's geometry and thresholds explicit in its analyzer. Do not add a generic framework or retain the old validators as a fallback.
- Update displayed count and elapsed time directly from the selected analyzer on camera frames.
- Keep workout goals and completion, camera pause/resume, feedback, voice, and existing UI features. Remove readiness logic from the runtime decision path; it must not block analysis or goal completion.

## Movement rules and initial thresholds

These are starting defaults to validate and tune using the live camera. Hysteresis provides duplicate protection without requiring prolonged stable poses.

| Exercise | Movement signal | Count point |
|---|---|---|
| Squat | Either usable hip-knee-ankle angle reaches 150° or less | That knee returns to 160° or more |
| Push-up | Either usable shoulder-elbow-wrist angle reaches 145° or less | That elbow returns to 160° or more |
| Jumping jack | Average wrist height rises above average shoulder height and ankle separation exceeds 1.25× hip separation | Wrists return to shoulder level or lower and ankle separation is below 1.1× hip separation |
| Sit-up | Side-view shoulder-to-hip trunk angle relative to horizontal reaches 40° or more | Trunk returns to 25° or less |
| Lunge | Either usable hip-knee-ankle angle reaches 150° or less; latch one working side for the cycle | The latched knee returns to 160° or more; no alternating-side requirement |

For each repetition analyzer, a missing or non-finite required joint skips that frame. A continuous 500 ms landmark gap clears only the pending cycle, not the count. One complete movement cycle can increment at most once.

## Plank timing

- Measure the shoulder-hip-ankle angle from either usable side and require the body line to be roughly horizontal (horizontal displacement greater than vertical displacement).
- Start timing at an angle of at least 150°.
- While active, stop adding time below 135°. Mark the timer paused only if that loss lasts 300 ms; if form returns to at least 150° sooner, resume without a pause.
- Missing required landmarks stop time accumulation immediately and mark the timer paused after 500 ms. Resume when usable landmarks return and the angle is at least 150°.
- Preserve earned time and cap each accumulated frame interval at 200 ms so camera stalls do not create large jumps.

## Data flow and UI state

1. MediaPipe `PoseLandmarker` continues to provide image landmarks through the existing pose tracker.
2. The controller transitions from loading to running after camera/tracker startup, without waiting for readiness classification.
3. Each running frame goes directly to the selected exercise analyzer.
4. The controller publishes the analyzer's count or elapsed time and feedback immediately. Goal completion is determined by the selected count/time target, not by a separate form-valid flag.
5. Existing camera and workout controls remain. Basic camera/body tracking status may remain visible, but exercise readiness is informational only and cannot suppress analysis.

## Implementation scope

- Simplify the six existing analyzer modules and their focused tests.
- Delete the exercise-specific readiness classifier/gate module and its tests, replacing them with controller tests that prove immediate analysis. Preserve basic camera/body tracking status, but do not use it to block detection.
- Simplify controller start/resume and goal-completion gating only as required for immediate analyzer updates.
- Do not change MediaPipe models, camera acquisition, exercise imagery, workout layout, backend pose endpoints, or unrelated features.

## Validation and success criteria

- Automated tests cover complete cycles, threshold hysteresis, one count per cycle, missing-landmark recovery, and plank start/pause/resume for each relevant analyzer.
- Controller tests prove that analysis begins without a ready pose, and that count/time updates reach the displayed state without being gated by form validity.
- With the user's participation, use the shared browser page and actual webcam to perform each of the six exercises. Verify that each completed repetition increments once and that plank timing starts, pauses on clear form loss, and resumes on recovery. Record which movements were physically verified; fixture tests are not a substitute for this check.
- Run the complete test suite and production build after the live-camera adjustments.
