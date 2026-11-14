# SabiBody: Six New MediaPipe Exercises

**Status:** Proposed design, approved in chat and awaiting user review
**Date:** 2026-11-14

## Goal

Add High Knees, Mountain Climbers, Donkey Kicks, Bicycle Crunches, Standing
Side Leg Raises, and Bird Dogs to SabiBody. Preserve the existing MediaPipe
pipeline, exercise analyzers, automatic coaching controller, speech queue,
targets, completion flow, and layouts.

## Existing architecture

- `src/pose/pose-tracker.js` owns the single MediaPipe PoseLandmarker and
  supplies normalized pose landmarks to the workout controller.
- Exercise-specific stateful analyzers live in `src/exercises/`. They expose
  `update`, `reset`, and `invalidatePhase`, and return counts, form state,
  feedback IDs, and metrics.
- `src/ui/app.js` owns exercise selection, analyzer dispatch, camera lifecycle,
  target progress, completion, and the single speech queue.
- `src/ui/exercise-content.js` is the exercise catalog and uses `new URL(...)`
  to reference root-level exercise illustrations.
- `api/src/shared/coaching-messages.js` owns coaching phrases and
  `EXERCISE_INSTRUCTION_IDS`.

## Design

### Exercise catalog and illustrations

Add six catalog entries with a description, target-muscle list, benefits,
exercise instructions, camera-position instructions, and an accurate image
alternative text. Reference the supplied files by their existing filenames:

- `High Knees.png`
- `Mountain Climbers.png`
- `Donkey Kicks.png`
- `Bicycle Crunches.png`
- `Standing Side Leg Raises.png`
- `Bird Dogs.png`

Display the new content through the existing exercise cards and workout setup
view, matching the current visual system. Keep exercise targets in repetitions,
with each completed side movement counting as one repetition. New exercises
start with a target of 10 reps and use the existing repetition target and
completion flow.

### Exercise analysis

Add one analyzer module per exercise. Each module will validate the landmarks it
needs with the existing geometry helpers, use exercise-specific thresholds and
hysteresis, and count only a complete movement cycle. A tracking gap invalidates
an unfinished cycle; it does not erase earned repetitions or create a count.
Side-based movements alternate sides as described below.

| Exercise | Required cycle and side rule |
|---|---|
| High Knees | One knee lifts to a hip-relative height and returns to neutral; alternate knees. |
| Mountain Climbers | From high plank, one knee drives toward the chest and returns to plank; alternate knees. |
| Donkey Kicks | One bent leg lifts behind the body and returns to tabletop; alternate when possible and expose side metrics. |
| Bicycle Crunches | One opposite elbow-to-knee curl returns to the start; alternate cross-body sides. Contact is not required. |
| Standing Side Leg Raises | One ankle moves laterally relative to its hip and returns while the torso stays steady; alternate legs. |
| Bird Dogs | One opposite arm and leg both extend and return; alternate sides. An arm-only or leg-only movement is invalid. |

Use the existing analyzer interface and add a separate `checkReady(landmarks,
timestamp)` capability. Readiness checks must not increment reps or plank time.
Keep existing analyzers' current counting rules and introduce no replacement
detector or common movement threshold.

### Camera readiness and workout lifecycle

Apply the pre-start readiness gate to all 12 exercises. Start acquires the
camera and tracker, then remains in the existing positioning/loading state
until the selected analyzer confirms its required landmarks and starting pose
across a stable 400 ms interval, matching the existing plank stability window.
Use the existing positioning UI state where possible. Only then begin the
countdown, mark the workout active, and allow rep/time progress. A missing or
unsuitable pose shows an exercise-specific correction. The initial gate does
not change existing movement thresholds.

Required landmarks are exercise-specific; generic full-body visibility is not
a substitute for them. Resume continues to discard an incomplete phase through
the existing invalidation path. Do not accrue repetitions or duration during
initial positioning.

The camera and pose estimator cannot reliably prove that physical floor space
is clear or that a camera is exactly at a specified angle. Detect visible
required landmarks and approximate orientation; retain clear-space, distance,
and angle directions as user-facing guidance rather than claiming automatic
verification.

### Coaching and completion

Add exercise-specific English starting instructions and essential form cues
to the existing coaching catalog and instruction-ID map. Continue to route
announcements through the current controller and single speech queue. Keep the
existing automatic rep announcements and completion message, with no manual
speaking-mode selection and no second queue. Keep other language catalogs and
language-selection behavior unchanged; English remains the supported selectable
language.

### Verification

- Add focused analyzer tests for each exercise: required starting pose,
  complete cycle, incomplete movement, repeated frames, side alternation,
  missing/low-confidence landmarks, and tracking-gap invalidation.
- Add controller tests proving that all 12 workouts remain in positioning
  until the selected analyzer is ready, and that no count or timer progress is
  recorded before that point.
- Verify target completion, voice instruction mapping, image-path matching,
  and existing exercise behavior.
- Run the full Node test suite, JavaScript syntax checks, production build, and
  `git diff --check`.
- Report synthetic landmark test results separately from real-camera results.
  Synthetic tests alone do not establish real-world detection accuracy.

## Non-goals

- Replacing or restructuring MediaPipe, the pose tracker, or the speech queue.
- Changing the existing six exercises' repetition thresholds or cycle rules.
- Claiming automatic verification of room clearance, exact camera placement, or
  real-world accuracy without representative live-camera testing.
