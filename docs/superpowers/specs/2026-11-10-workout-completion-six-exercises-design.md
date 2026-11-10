# Six-Exercise Workout Completion Experience

## Status and scope

This design extends SabiBody's existing MediaPipe workout flow to six
exercises and adds a dedicated, goal-earned workout completion experience.
It preserves the existing browser camera and MediaPipe integration, coach
preferences, language selection, voice coaching, and explicit Start action.

The existing supported exercises remain Squats, Jumping Jacks, and Plank.
Push-ups, Sit-ups, and Lunges are added with exercise-specific MediaPipe
analyzers. This is intentionally incremental: each analyzer owns its movement
phases and validation rules; no generic exercise-recognition framework or
replacement pose engine is introduced.

Synthetic landmark tests establish deterministic branch behavior only. The
proposed thresholds are starting values for implementation and must not be
presented as universal biomechanical guidance or real-world accuracy claims.
Camera testing with people and varied devices remains necessary before tuning
or making accuracy claims.

## User-approved decisions

- Keep MediaPipe and the existing camera/tracker pipeline.
- Support all six exercises: Squats, Jumping Jacks, Plank, Push-ups, Sit-ups,
  and Lunges.
- Push-ups and Sit-ups use a side-on camera view. Lunges use a three-quarter
  view to balance leg identification with visibility of forward knee bend.
- Push-ups count a complete top → sufficiently lowered → top cycle and reject
  incomplete lowering or poor body alignment.
- Sit-ups count a complete lowered-start → upright → lowered cycle.
- Lunges count each completed leg movement as one repetition, require
  alternating legs, and reject incomplete or insufficiently bent movements.
- Default goals are Squats 10 reps, Jumping Jacks 10 reps, Plank 30 seconds,
  Push-ups 5 reps, Sit-ups 6 reps, and Lunges 10 total alternating reps.
  Existing preset and custom-goal selection remains available before Start.
- The completion layout is a centered, stacked celebration (visual option A).
- When no sequence is defined, “Next Workout” opens the home exercise chooser
  directly. “Back to Home” returns to the landing top. Neither action starts
  the camera.
- Successfully completed results remain in in-memory session state only.
  There is no persistent history or server storage.
- The completion screen contains no advertisements or commercial content.

## Existing implementation and integration points

- `src/ui/app.js` owns the exercise catalog, goal selection, workout controller,
  readiness gate integration, completion boundary, route/view rendering, and
  camera/tracker cleanup.
- `src/exercises/squat.js`, `jumping-jacks.js`, and `plank.js` contain separate
  stateful analyzers. Repetition analyzers emit counts only after a completed
  movement cycle. Plank emits accumulated time only while valid form is stable.
- `src/exercises/readiness.js` classifies exercise-specific starting poses and
  gates analysis until the pose is stable.
- `src/pose/pose-tracker.js` owns the existing MediaPipe tracker and frame
  callback. The camera remains local to the browser.
- `src/feedback/messages.js` and the shared coaching catalog provide the
  existing localized feedback path. New exercise feedback must use stable
  event/message identifiers and the current language/personality/voice path.
- `src/styles.css` contains the responsive workout styles and a basic
  `.completion-card`; the completion view should reuse SabiBody's palette,
  type, spacing, and button conventions.
- `test/exercises.test.js`, `test/exercise-readiness.test.js`,
  `test/app.test.js`, and `test/goal-session.test.js` contain the focused Node
  test seams.

The working tree currently contains uncommitted user changes, including changes
to the controller, analyzers, readiness, styles, and tests. Implementation
must preserve these changes, inspect before editing, and avoid staging or
committing unrelated work.

## Exercise setup and analyzer behavior

All six exercises use the existing readiness gate and per-exercise analyzer
pattern. A workout is not counted until the required landmarks and start pose
are reliably detected. Use the existing confidence threshold of `0.60`,
three stable frames for transitions, and short landmark smoothing where
appropriate. Tracking loss must not advance a phase, count a repetition, or
accrue valid Plank time.

The following values are conservative initial computer-vision thresholds, not
medical recommendations. Keep them named in exercise configuration and
exercise-testable; they may be changed only with corresponding tests and
evidence.

### Squats

Preserve the existing side-on starting pose and analyzer. A repetition counts
only after standing → valid depth → return to standing. Shallow movement,
invalid hip position, unreliable landmarks, or an incomplete cycle does not
count.

### Jumping Jacks

Preserve the existing front-facing starting pose and analyzer. A repetition
counts only after a complete closed → open → closed cycle with required arm
elevation, foot separation, framing, and reliable landmarks. A partial jack
or missing return does not count.

### Plank

Preserve the existing side-on starting pose and analyzer. Accrue only valid,
stable alignment time. Pause accrual during invalid alignment, missing
landmarks, or tracking loss; retain previously earned valid time. Completion
uses accumulated valid milliseconds, not wall-clock duration.

### Push-ups

- Start in a stable, side-on top position with the shoulder, elbow, wrist,
  hip, and ankle landmarks required by the selected reliable side.
- Top position: shoulder-elbow-wrist angle is at least `155` degrees.
- Valid lowered position: that elbow angle is at most `95` degrees.
- Maintain body alignment: normalized hip distance from the shoulder-to-ankle
  line is at most `0.10` of shoulder-to-ankle length.
- Count only top → valid lowered position → top. Half push-ups, poor body
  alignment, tracking loss, or failing to return to top do not count.

### Sit-ups

- Use a side-on view and the shoulder/hip landmarks, plus reliable hip/knee
  landmarks for a stable seated/lowered body reference.
- Measure the shoulder-to-hip trunk axis relative to horizontal.
- Lowered start: trunk angle is within `25` degrees of horizontal.
- Upright position: trunk angle is at least `60` degrees from horizontal.
- Count only lowered start → upright → lowered start. A partial sit-up or
  failure to return to the lowered position does not count.

### Lunges

- Use a three-quarter view and track both hip/knee/ankle sides.
- Starting and completed-return position: both knee angles are at least
  `155` degrees.
- A valid lunge requires one identifiable working-leg knee angle at or below
  `110` degrees, while the opposite leg's knee angle is at least `140`
  degrees to distinguish the working side.
- Count only after returning to the upright position. The next valid
  repetition must use the opposite leg; the working side alternates on each
  completed repetition.
- Ambiguous side tracking, insufficient knee bend, a same-side repeat, missing
  landmarks, or failure to return upright does not count.

## Goal completion and session result

Repetition goals apply to Squats, Jumping Jacks, Push-ups, Sit-ups, and
Lunges. The Plank goal is measured in valid seconds.

The controller completes a workout only after valid analyzer output reaches
the selected target:

- Repetition exercises: analyzer count reaches the selected rep target.
- Plank: accumulated valid milliseconds reach `targetSeconds * 1000`.

The displayed completion result is capped at the selected goal so later frames
cannot inflate the achieved goal. Completion is idempotent: the first successful
goal transition captures the result, marks completion handled, invalidates the
current run generation, stops the tracker and camera, cancels active voice
playback, and prevents later frames from changing progress or triggering
another completion announcement. Existing tracker/timer loops must not remain
active after completion.

Manual “End workout” is not a success event. It performs the existing cleanup
and navigation behavior without adding a completed result. Pause, reset,
readiness transitions, and camera errors likewise do not qualify as completion.

Store successful results in a controller-owned in-memory session list. A result
contains the exercise ID/name, selected goal and unit, achieved valid reps or
seconds, and completion time. Do not persist the list to local storage, send it
to the backend, or add a server API. Keep prior results when a user selects the
next exercise or returns Home.

## Completion screen and navigation

When `workoutStatus` becomes `completed`, render a dedicated completion view
instead of the active workout/camera view. The centered, stacked SabiBody card
contains:

- A prominent success mark with a subtle optional animation; respect
  `prefers-reduced-motion`.
- The heading “Workout Completed!”
- A brief encouraging message, such as “Amazing work! You did it.”
- The completed exercise name.
- The achieved valid repetition count or valid Plank duration.
- A clear goal-achieved statement.
- No advertisement or commercial content.

Use semantic markup, an accessible polite announcement for the completed
result, and move keyboard focus to the completion heading on entry. Provide two
large touch targets with at least `44px` height:

1. **Next Workout** — navigate to the home exercise chooser, scroll to and
   focus the chooser heading. Selecting one of its six exercises opens that
   exercise's normal goal/setup screen with its default/persisted goal and
   custom-goal controls. The camera remains off until the user presses Start.
2. **Back to Home** — navigate to the landing page top without discarding the
   in-memory completed-session summary.

Show a compact “Completed this session” summary on Home when one or more
successful results exist. It is session-only and does not replace a future
persistent workout-history feature.

Keep the screen responsive on mobile, tablet, and desktop. On narrow screens,
stack content and action buttons, keep text within the viewport, and avoid
horizontal scrolling. Preserve the existing desktop style outside the
completion view except for the required responsive additions.

## Coaching and localization

Use the existing event-based feedback, personality, localization, and voice
playback/YarnGPT paths. Do not add frame-by-frame speech or duplicate
completion events. Add only the stable exercise feedback identifiers needed
for actionable form corrections and integrate their catalog entries through
the existing languages and visible unverified-translation behavior. Keep the
completion message singular and ensure it is not replayed after completion.

Do not change YarnGPT endpoints, payloads, credential handling, or browser
camera behavior. Do not add network calls for completed workout results.

## Testing and verification

### Analyzer tests

Test the actual analyzer implementations for all six exercises:

- One complete valid repetition cycle counts exactly once.
- Insufficient depth, half movement, missing return, unreliable landmarks,
  and tracking loss do not count.
- Push-ups reject poor body alignment.
- Sit-ups require both the upright phase and return to the lowered start.
- Lunges reject insufficient bend and same-side repeated reps and accept
  alternating left/right (and right/left) cycles.
- Plank accrues only bounded valid time and does not count invalid or paused
  time toward the goal.

### Controller and UI tests

- Drive all six exercise types through readiness and successful goal
  completion; verify the dedicated completion state and correct achieved goal.
- Verify completion stops the camera/tracker and freezes the result, ignores
  later pose callbacks, and announces completion only once.
- Verify manual End, pause, reset, invalid form, and camera loss do not create a
  successful result.
- Verify session results remain available through Next Workout and Back to
  Home.
- Verify Next Workout opens/focuses the exercise chooser and selecting another
  exercise shows its goal controls without starting the camera.
- Verify Back to Home returns to the landing top and camera resources remain
  released.
- Exercise both navigation actions after completion for each of the six
  exercises.
- Verify all six exercises retain custom target selection and their approved
  defaults.
- Verify no ads are rendered and completion actions are keyboard/touch
  accessible.

### Browser/build verification

Run focused analyzer/controller tests, the full `npm test` suite, and
`npm run build`. Inspect the actual rendered completion screen at widths
`320`, `360`, `375`, `390`, `430`, and `480` pixels and at a desktop viewport.
Confirm no horizontal overflow, clipped content, duplicate completion UI, or
active camera indicator after completion. Use a mocked/synthetic camera flow
for automated UI checks; do not make real-world accuracy claims from synthetic
inputs. Do not make paid YarnGPT requests.

## Non-goals

- Replacing or migrating away from MediaPipe or changing camera ownership.
- Building a general-purpose exercise framework.
- Medical assessment, injury diagnosis, or universal form claims.
- Persistent or server-side workout history.
- Advertisements, subscription prompts, or unrelated commercial UI.
- Automatic camera startup or workout start after selecting Next Workout.
- Live paid speech tests or new YarnGPT API behavior.
