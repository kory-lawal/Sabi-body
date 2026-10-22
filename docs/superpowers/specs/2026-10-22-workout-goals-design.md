# Workout Goals, Progress, and Completion Design

## Status and scope

This design covers the first implementation stage of the Sabi Body
multilingual-coach upgrade. The user approved this stage before implementation.
It adds exercise goals, goal-aware progress and milestone feedback, and an
exactly-once completion experience to the existing Vite application.

The existing MediaPipe camera flow, three exercise analyzers, branding, and
coach-personality setting remain in place. This stage does not create a server,
YarnGPT integration, paid audio calls, a development voice-testing panel, or
workout-history storage. Browser speech remains English-only and opt-in; it is
not represented as YarnGPT voice support.

## User decisions

- Implement goals/progress/completion before the separate YarnGPT/backend stage.
- Remember the most recent target independently for each exercise.
- Default to 10 repetitions for squats and jumping jacks, and 30 seconds for
  planks.
- Use a single Start action. Camera and tracking begin immediately; a short
  spoken/text countdown occurs once required exercise landmarks are reliable,
  before countable exercise time begins.
- Automatically stop tracking and release the camera at goal completion.
- Accept custom repetition targets from 1 to 200.
- Accept custom plank durations from 1 to 3,600 seconds.
- Keep spoken coaching and individual spoken-repetition counting as separate
  opt-in controls, both off by default. The individual-count option is
  subordinate to spoken coaching.
- Keep supplied translations as unverified drafts and visibly disclose that
  status.

## Existing application and boundaries

The application is a Vite-hosted browser app. `src/ui/app.js` owns the current
workout controller and rendering lifecycle. Squat and jumping-jack analyzers
return completed repetition counts; the plank analyzer accumulates time only
while its visible-landmark alignment checks pass. The camera/tracker lifecycle
already supports start, pause, resume, reset, end, and cleanup. The feedback
catalog and personality policy are browser modules. `src/services/yarngpt.js`
is an unused same-origin client seam; no application server or YarnGPT
credential handling exists.

The goal feature must not replace analyzers or infer repetitions from arbitrary
frame changes. A small goal/session module will own target validation,
per-exercise persistence, remaining/progress calculations, milestone
thresholds, and an exactly-once completion transition. The existing controller
will coordinate that module with analyzer output and camera/tracker cleanup.
UI rendering remains in the current app rather than introducing a framework or
rebuilding the site.

## Goal selection and persistence

Place accessible, large-touch-target goal controls in the existing workout
setup. Repetition exercises offer presets 5, 10, 15, 20, 25, 30, and 50, plus
Custom. Custom values must be whole numbers from 1 through 200. Planks offer
15, 30, 45, 60, and 90 seconds, plus Custom. Custom values must be whole
numbers from 1 through 3,600 seconds.

Keep one target per exercise in browser local storage. A missing, malformed,
unsupported, or inaccessible stored target falls back to the default for that
exercise. Invalid user input is rejected with an associated visible message;
it must not silently replace the last valid target. If storage is unavailable,
the selected target remains usable for the current page session and the UI
reports the persistence failure.

The existing one-click Start behavior remains. It requests camera permission
and starts tracking as it does today. Repetition counting and plank duration
must not advance until the exercise has the landmarks it needs and the user
has completed the brief countdown. The implementation must preserve camera
permission timing: no camera request before Start.

## Progress, milestones, and completion

For repetition exercises, display completed/target, remaining repetitions, a
percentage, and a semantic progress bar with accessible value text. For planks,
display elapsed/target time and remaining seconds. Clamp percentage to 100%.
Only confirmed analyzer repetition increments count toward a repetition goal.
Plank time comes only from the existing aligned/active analyzer interval; time
must not accrue while tracking is paused, unreliable, or misaligned.

For a target of 20 repetitions, milestone cues occur at 5, 10, 15, and 19,
with completion at 20. For other targets, calculate distinct milestones at
`ceil(target * 0.25)`, `ceil(target * 0.5)`, and
`ceil(target * 0.75)`, omit thresholds that are not below the target, and
deduplicate equal thresholds. Also trigger the final-repetition cue at target
minus one unless that collapses onto an already-announced milestone. Never
announce a milestone more than once per workout. If the target is reached in
one analyzer update, completion takes precedence over intermediate milestones.

For planks, announce duration-specific quarter, halfway, and three-quarter
milestones based on validated elapsed seconds, deduplicating equal thresholds
for short goals. Completion takes precedence when the target duration is
reached.

Individual rep counting is optional and is spoken only when both spoken
coaching and the individual-count option are enabled. Milestone, essential
correction, and completion messages use the spoken-coaching option. Keep the
existing cooldown and cancel obsolete pending speech on pause, exercise change,
or completion. General feedback must not be scheduled on every video frame.
Do not add YarnGPT network calls in this stage.

On reaching the target, atomically freeze the completed result and transition
the session to completed before further pose callbacks can change it. Stop the
tracker and camera, clear the preview/overlay, and show a completion view with
the exercise, completed target, and celebratory text. Provide “Start Another
Workout” and “Back to Home” actions. Starting another workout returns to
exercise setup with the selected goal retained. Completion feedback is emitted
once even if further callbacks arrive during cleanup. Respect
`prefers-reduced-motion` for any celebratory treatment. Do not persist workout
history in this stage.

For plank completion, use duration-specific message identifiers and wording;
never describe the duration as repetitions. Pause and tracking loss must pause
validated hold-time accounting. Resume continues the same target and elapsed
time.

## Message catalog and language behavior

Use stable IDs for the supplied starter messages: welcome, camera positioning,
body not detected, ready/countdown, good repetition, keep going, form
adjustment, squat depth, return to start, repetition count, remaining
repetitions, halfway, almost finished, final repetition, repetition-workout
completion, workout paused, and workout resumed. Add duration-specific plank
completion and progress messages where needed.

Keep the supplied English, Yoruba, Igbo, Hausa, and Nigerian Pidgin text in
UTF-8 and interpolate only known placeholders such as `count`, `remaining`,
and `target`. All supplied non-English text is explicitly unverified until
review by fluent speakers. Missing catalog entries fall back to English with a
visible fallback status. Browser speech remains English-only; selecting a
non-English language changes written coaching but must not speak English text
as though it were that language.

## Accessibility and failure behavior

- Use native controls with visible labels, descriptions, keyboard operation,
  and focus indicators. Goal selection and workout controls must remain
  touch-friendly on narrow screens.
- Announce meaningful progress and completion changes through accessible
  status regions without flooding screen readers with frame-level state.
- Honor reduced-motion preferences.
- Preserve the selected goal and explain storage errors rather than silently
  reporting persistence success.
- Keep camera/model failures and retry behavior explicit. Inability to track
  reliable landmarks pauses countable progress and shows clear positioning
  guidance.
- Keep existing privacy guarantees: camera frames and pose landmarks remain
  local; no account, network speech request, or new telemetry is introduced.

## Validation

Add focused automated coverage for:

- Preset/custom target validation, limits, per-exercise defaults, persistence,
  malformed stored values, and unavailable/throwing storage.
- Completed/target display calculations, remaining amounts, clamped
  percentages, and accessible goal/progress semantics.
- Distinct milestone thresholds for small, ordinary, and large targets,
  including target-minus-one and completion precedence.
- No double counts beyond analyzer output and no repeated milestone or
  completion events.
- Countdown gating on required reliable landmarks.
- Pause/resume and tracking-loss accounting for repetitions and plank time.
- Goal completion freezes progress and releases tracker/camera exactly once.
- Rep-count voice option gating and cooldown/deduplication.
- Completion controls, exercise switching, and reduced-motion behavior.
- UTF-8 preservation and explicit unverified/fallback metadata for
  translations.

Then run the full `npm test` suite and `npm run build`. Use a browser check to
verify goal controls, progress presentation, completion actions, and responsive
layout. Automated checks do not replace real webcam testing.

## Later stage: YarnGPT service

YarnGPT is a separate follow-up design and implementation stage. It must use a
same-origin backend that keeps `YARNGPT_API_KEY` server-side, consults the
official API documentation for actual endpoints, voice IDs, idempotency,
polling, and rate-limit/credit errors, and never exposes secrets in frontend
code, URLs, logs, commits, or screenshots. Nigerian Pidgin must use
independently authored Pidgin text rather than an unsupported `pcm`
translation target. Any paid synthesis must be explicitly bounded, cached,
and tested with mocked API calls. This stage must be separately approved and
must not be inferred as included in the current goal feature.
