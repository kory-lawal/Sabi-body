# SabiBody Exercise Form Validation Design

## Status and scope

This design adds conservative, exercise-specific form validation and
positioning readiness to SabiBody's existing MediaPipe workout flow. It
strengthens the existing squat, jumping-jack, and plank analyzers rather than
replacing MediaPipe or creating a general-purpose exercise framework.

The implementation must preserve the camera lifecycle, workout controls,
exercise selection and goals, responsive UI, coach style, language selection,
voice queue, and working YarnGPT integration. Camera frames remain in the
browser. No paid YarnGPT requests are needed for implementation or automated
tests.

The system provides observable movement coaching, not medical advice or a
guarantee of safe or correct exercise form. Real-world accuracy must not be
claimed until tested with physical camera sessions.

## User-approved decisions

- Keep and strengthen the existing three analyzer modules.
- The first Start press is the user's explicit camera-consent action.
- Apply camera-size framing to the exercise's primary body axis: vertical body
  height for upright exercises and horizontal body length for planks, using the
  same conservative numeric bounds.
- After camera and MediaPipe startup, remain in a positioning state without
  counting repetitions or valid plank time until the exercise-specific pose is
  reliably ready. Automatically proceed through the existing countdown once
  readiness is stable.
- Reject uncertain or incomplete movements rather than risking false counts.
- Pause plank time whenever form or required tracking becomes invalid; preserve
  already-earned valid time.
- Keep all non-English coaching text visibly identified as unverified until
  fluent speakers review it.

## Existing implementation and integration points

- `src/pose/pose-tracker.js` initializes one MediaPipe Pose Landmarker and
  currently sends normalized landmarks and a timestamp to the workout
  controller once per decoded video frame.
- `src/exercises/geometry.js` contains 2D angle, visibility, and full-body
  helpers. Visibility currently accepts the maximum of available visibility
  and presence scores.
- `src/exercises/squat.js`, `jumping-jacks.js`, and `plank.js` each own an
  analyzer state machine but use fixed thresholds and do not share an
  exercise-specific startup readiness result.
- `src/ui/app.js` starts camera/tracking and transitions to `running` as soon as
  tracker initialization completes. It sends every subsequent pose to the
  selected analyzer. Its feedback IDs already flow through coach personality,
  localization, cooldown, and audio-priority handling.
- `api/src/shared/coaching-messages.js` is the centralized coaching message
  catalog for English, Yoruba, Igbo, Hausa, and Nigerian Pidgin.
- `src/pose/draw-pose.js` renders the current MediaPipe skeleton overlay.
- Existing exercise and controller tests are Node tests; backend tests cover
  the speech service. The TTS service is outside this change.

Changes should remain concentrated in the geometry/readiness helpers, pose
result forwarding, the three analyzers, workout-controller integration,
central coaching messages, the development-only diagnostics UI, and focused
tests. Avoid unrelated refactors.

## Readiness and camera positioning

The first Start press requests camera access and starts MediaPipe. During this
period the workout remains non-counting and presents an exercise-specific
positioning instruction. Camera permission denial, camera startup failure, and
camera-off states continue to use the existing lifecycle/error handling and
must remain distinguishable from a running camera with no visible person.

For each decoded frame, a shared readiness classifier evaluates the selected
exercise's required landmarks, their confidence, normalized frame bounds, and
starting pose. It reports a structured state and a human-readable reason:

- camera off or startup/permission failure;
- no person detected;
- required landmarks missing or unreliable;
- partial framing, including feet or hands outside the frame where required;
- framing too close or too far based on normalized body bounds;
- uncertain or unsuitable orientation for the exercise;
- visible and correctly positioned, with the exercise's required start pose.

Required landmarks are exercise-specific:

- **Squats:** shoulders, hips, knees, and ankles, with at least one reliable
  side for joint geometry and enough torso/hip information to estimate
  side-on orientation.
- **Jumping jacks:** shoulders, elbows, wrists, hips, knees, and ankles on both
  sides, plus the nose as a head-height reference for overhead wrists;
  full-body framing and a front-facing start position.
- **Planks:** shoulders, hips, ankles, and the arm landmarks used to identify
  the support position (elbow and wrist on at least one reliable side);
  sufficient side-view and horizontal-body evidence.

The existing pose callback is extended compatibly to make MediaPipe world
landmarks available when present, without removing normalized landmarks or
changing the existing timestamp argument. Normalized coordinates remain the
basis for frame-boundary and body-proportion checks. World coordinates may
inform orientation and angles, but are model estimates, not ground truth.
Orientation is a conservative estimate from one camera view; if evidence is
ambiguous, readiness fails with an actionable instruction rather than
pretending the angle is known.

The workout controller processes readiness while the camera is active but the
workout is still in its positioning/loading state. Analyzer progress is frozen
until readiness is valid for a short consecutive-frame stability window.
After readiness, it transitions through the existing countdown and starts the
workout. Temporary loss of required landmarks immediately prevents new
progress. Recovery requires reliable landmarks and stable pose again.

Exercise selection controls the positioning copy, for example side view for
squats/planks and front view with hands and feet in frame for jumping jacks.
Changing exercise or restarting/resuming must reset the relevant readiness
stability window so stale frames cannot authorize counting.

## Confidence, smoothing, and temporal validation

Create shared, testable helpers for landmark reliability, normalized body
measurements, and light temporal smoothing. Reliability uses MediaPipe
visibility/presence values where supplied; missing, non-finite, out-of-frame,
or low-confidence required points cannot advance a state machine. Confidence
must not be inflated by an unrelated high score when another available score
for the same required point is poor.

Use a small configurable temporal filter to reduce isolated landmark jitter,
then require state transitions to persist across multiple consecutive valid
frames. A transition is invalidated when its required landmarks are unreliable.
Use bounded timestamp deltas for plank accrual so frame stalls cannot create
large jumps. Tuning values live in named per-exercise configuration objects,
not duplicated inline in state-machine branches.

Initial thresholds are conservative starting values for manual tuning, not
validated universal biomechanical standards:

- required-landmark confidence: 0.60;
- stable readiness/phase transitions: at least 3 consecutive reliable frames;
- brief tracking recovery window: up to 350 ms for retaining an in-progress
  rep phase, with no counting during the gap; after the grace window, discard
  the incomplete cycle and require a fresh starting pose;
- framing boundary margin: 0.02 of frame width/height; classify required
  points outside this safe region as partial framing;
- visible-body span along the exercise's primary axis: less than 0.35 of the
  corresponding frame dimension is too far, and greater than 0.90 is too
  close; use vertical height for upright exercises and horizontal length for
  planks; values within the range may proceed to the remaining checks;
- front-view candidate: both shoulder and hip widths at least 0.35 of
  shoulder-to-hip torso length; side-view candidate: both widths at most 0.25
  of torso length; values between these thresholds are orientation-ambiguous;
- squat upright knee angle: at least 160 degrees;
- squat depth knee angle: at most 105 degrees, with hip position at or below
  knee height, allowing at most 0.05 torso lengths above the knee to account
  for landmark noise;
- jumping-jack closed ankle separation: at most 0.8 times hip width;
- jumping-jack open ankle separation: at least 1.5 times hip width, plus both
  wrists at least 0.02 frame heights above the nose landmark;
- plank shoulder-hip-ankle angle: at least 155 degrees, with hip deviation
  from the shoulder-to-ankle line within 0.10 of shoulder-to-ankle length;
- plank timestamp contribution per frame: at most 200 ms.

These defaults must be centralized, named, and adjustable after physical
testing. The front/side width ratios use normalized image coordinates and are
only conservative candidates, not reliable 3D orientation measurements.
Tests should verify the intended geometric boundaries rather than encode
behavior as unexplained literals.

## Exercise state machines

### Squats

Require a stable upright start and a sufficiently reliable side view. Measure
hip-knee-ankle angle on the best reliable side and use normalized hip-to-knee
position as a separate depth cue. If both sides are reliably visible, use a
stable combination; do not let an occluded side corrupt the reliable side.

The state sequence is:

`waiting-for-standing -> standing -> lowering -> valid-depth -> returning -> standing`

A repetition increments only on a stable return to standing after the same
cycle reached valid depth. A shallow bend that returns to standing, an
incomplete descent, or a descent without a return never counts. Losing
required landmarks during a cycle cannot create a count; after the short
recovery grace window, discard the incomplete cycle.

Return useful phase feedback such as stand upright to begin, go a little lower,
good depth/stand up, and excellent squat. Emit corrections only when the camera
view and landmarks support the inference.

### Jumping jacks

Require a stable front-facing closed stance with both arms and feet visible.
Use normalized ankle separation relative to hip width, and require both arms
and wrists to reach the configured overhead region. One arm or feet alone
cannot satisfy the open pose.

The state sequence is:

`waiting-for-closed -> closed -> opening -> fully-open -> closing -> closed`

A repetition increments only after a stable fully-open pose returns to a
stable closed pose. Partial arm motion, feet-only motion, one-sided movement,
an open pose with missing landmarks, and failure to return do not count.

Feedback distinguishes raising both arms, spreading feet, and returning to the
closed position, based only on reliable evidence.

### Planks

Require a side-view plank start and reliable shoulder, hip, ankle, and support
arm landmarks. Validate the shoulder-hip-ankle angle and normalized hip
deviation from the shoulder-to-ankle segment. Report distinct adjustment
reasons for sagging, excessive hip rise, invalid orientation, or missing
landmarks only when those conditions can be inferred reliably.

Accumulate time only across consecutive valid, reliably tracked intervals,
capping each frame's contribution. Invalid alignment or tracking stops
accrual immediately. Preserve all prior valid time while the user corrects
their position; resume only after the stable-valid window passes again. A
camera pause, user pause, reset, or end continues to obey the existing workout
control semantics.

## Coaching, localization, and UI

Represent camera readiness, movement phases, rejection reasons, valid form,
progress events, and completion with stable message/event identifiers. Add
exercise-specific positioning and correction messages to the centralized
catalog for English, Yoruba (`yo`), Igbo (`ig`), Hausa (`ha`), and Nigerian
Pidgin (`pcm`). Preserve UTF-8 characters and tone marks. Missing messages
continue to use the repository's visible fallback behavior; supplied
translations remain marked unverified.

Feed events through the existing coach personality, duplicate suppression,
cooldowns, priority queue, and YarnGPT playback path. Coaching is event-based,
never scheduled once per camera frame. Corrections should be deduplicated and
rate-limited; a higher-priority completion or safety-relevant form correction
must continue to follow existing queue priority rules. Do not send English
text as a selected non-English message except through the existing explicitly
visible fallback behavior. No YarnGPT endpoint, request format, credential,
or client behavior changes are part of this feature.

The normal workout UI keeps its current layout and controls. Update the
positioning note and readiness/status labels to explain the current
exercise-specific requirement and why the pose is not yet ready. Keep camera
permission deferred until Start.

Add a collapsed, developer-only diagnostics panel rendered only in development
builds. It displays camera/tracking status, readiness state/reason,
exercise/movement phase, required landmark confidence, relevant angles and
normalized ratios, valid/invalid form, rejection reason, and plank timer
running/paused state. Reuse the current skeleton overlay, adding clear visual
distinctions for valid, invalid, and missing required landmarks where
practical. Diagnostics must not add noisy controls or status updates to
production UI.

## Testing and verification

Add unit tests that feed synthetic normalized/world landmarks and timestamps to
the actual readiness classifier and each exercise analyzer. Required cases:

- **Camera/readiness:** no pose, partial upper body, feet/hands out of frame,
  too-near/too-far framing, low-confidence/missing required points, unsuitable
  orientation, valid starting pose, and stable recovery after temporary loss.
- **Squats:** one complete valid cycle counts once; shallow/half squat, no
  return, random knee motion, unreliable landmarks, and loss during a cycle do
  not count.
- **Jumping jacks:** one full closed-open-closed cycle counts once; insufficient
  arm elevation, insufficient foot separation, one arm only, missing points,
  open without return, and partial movement do not count.
- **Plank:** valid timestamps accumulate the expected bounded time; hip sag,
  excessive rise, invalid orientation, missing landmarks, and leaving frame
  pause accrual; correction resumes accrual without resetting prior time.
- **Controller/UI integration:** the analyzer cannot advance before readiness;
  start/countdown, pause/resume/reset/end and workout goals remain correct;
  event feedback follows selected language and coach style; YarnGPT calls
  remain tied to coaching events, not frames.

Run focused Node tests, the complete Node suite, backend speech tests, and the
production Vite build. Confirm no change to YarnGPT integration via existing
mock tests and no live paid requests. Synthetic tests validate algorithm
branches only; physical camera testing is required to tune thresholds and
assess real-world performance before making accuracy claims.

## Non-goals

- Replacing MediaPipe, the camera, the app framework, or existing analyzers with
  a generalized workout engine.
- Sending camera frames to a server, storing video, or adding another
  recognition provider.
- Claiming clinical, safety, or real-world accuracy from unit tests.
- Changing YarnGPT, its API key handling, or browser audio playback.
- Reworking unrelated branding, workout goals, or controls.
