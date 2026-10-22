# Sabi Body — Design Spec

**Tagline:** The sabi-sabi fitness coach

## Goal

Build a responsive, accessible, browser-based fitness coach for home workouts.
The first version supports squats, jumping jacks, and planks, using a camera and
MediaPipe Pose Landmarker to derive movement feedback and progress. Camera frames
stay in the browser and are not recorded, uploaded, or stored.

## Scope

- A Vite application using HTML, CSS, and vanilla JavaScript ES modules.
- Home and Workout views with navigation and three exercise cards.
- Camera preview and skeleton overlay using the official
  `@mediapipe/tasks-vision` package.
- Real landmark-based exercise analysis, repetition counting, and plank timing.
- English coaching text and optional browser speech synthesis.
- Language selection for English, Yoruba, Igbo, Hausa, and Nigerian Pidgin.
  Unverified translations remain unavailable and visibly fall back to English.
- A documented seam for future YarnGPT integration through a secure server-side
  endpoint; no API key or YarnGPT credential is included in frontend code.
- README setup, operation, privacy, exercise logic, and extension instructions.

Out of scope: accounts, databases, video upload/recording, a server/API, medical
advice, verified non-English translations, and remote YarnGPT speech generation.

## App Structure

The application remains a single-page Vite app with focused modules:

- `src/main.js`: application startup and event wiring.
- `src/ui/`: navigation, exercise selection, workout dashboard, and accessible
  status updates.
- `src/camera/`: deferred camera permission, stream lifecycle, and cleanup.
- `src/pose/`: MediaPipe initialization, VIDEO-mode inference, and canvas
  landmark/skeleton rendering.
- `src/exercises/`: per-exercise analysis and state machines.
- `src/feedback/`: message identifiers, English messages, language fallback,
  and speech cooldown/control.
- `src/services/yarngpt.js`: isolated future integration seam, with no browser
  secrets or direct API credentials.

The UI starts a workout by requesting camera access and initializing the model.
The pose loop processes the current video frame locally, renders its landmarks,
and passes reliable pose data to the selected exercise analyzer. The analyzer
returns state, progress, and a feedback message identifier; the UI formats the
result using the selected language and optionally speaks English feedback.

## Camera and Pose Lifecycle

- Do not request camera access on page load.
- On Start, request a user-facing video stream and initialize one
  `PoseLandmarker` in `VIDEO` mode with `numPoses: 1`.
- Run `detectForVideo()` from one `requestAnimationFrame` loop. Guard against
  duplicate loops and avoid processing the same video frame repeatedly.
- Size the canvas to the displayed preview and transform landmark coordinates
  consistently with the video so the skeleton remains aligned.
- Use landmark visibility/presence checks before exercise analysis. Show a
  prominent full-body positioning instruction when required landmarks are
  missing or unreliable.
- Pause suspends movement analysis and elapsed plank time without creating a
  second loop. Reset clears exercise state and progress. End cancels animation,
  stops every media track, clears the preview, and resets session state.
- Handle permission denial, missing/occupied cameras, unsupported browser APIs,
  model download/initialization failure, and camera stream interruption with
  actionable text. A failed start must not leave a stream or animation loop
  running.

MediaPipe model and WASM assets may be downloaded by the browser. This does not
send camera frames to those asset hosts; inference uses the local video element.

## Exercise Analysis

Analysis uses the selected view's visible landmarks only. It provides basic
observable movement cues, not a medical assessment or a guarantee of correct
form. If required landmarks are not sufficiently visible, the analyzer must not
advance a state, count a repetition, or accrue plank time.

### Squats

- Require the user to stand side-on to the camera with hip, knee, and ankle
  visible. Compute left/right hip-knee-ankle interior angles from normalized
  image-plane coordinates; use the reliable side, preferring a stable average
  when both sides are visible. Because this measurement uses only the 2D
  projection, a frontal view may hide knee flexion occurring in depth.
- Use a state machine: `waiting-for-standing` → `standing` → `lowering` →
  `bottom` → `returning` → `standing`. Count once only on a complete return to
  standing after a squat-depth threshold was reached.
- Initial thresholds: standing at approximately 160° or more; squat depth at
  approximately 110° or less. Keep thresholds centralized for tuning.
- Provide cues such as “Move a little lower” only when the user has started a
  lowering phase but has not reached the depth threshold. Use neutral
  positioning and visibility messages for unreliable views.

### Jumping Jacks

- Derive an open pose from both wrists above their respective shoulders and
  ankles wider than a normalized stance threshold.
- Derive a closed pose from arms lowered and ankles near hip/shoulder width.
- Count once only after a detected open pose returns to a closed pose; do not
  count repeated frames in either state.
- Use visible upper- and lower-body landmarks to decide whether a pose is
  reliable. Offer simple cues based on the detected open/return phases.

### Plank

- Require visible shoulder, hip, and ankle points from a side-on view.
- Estimate shoulder–hip–ankle alignment using the angle at the hip. Also
  require the absolute shoulder-to-ankle horizontal displacement to exceed
  1.5 times its absolute vertical displacement, distinguishing the instructed
  horizontal plank axis from a straight standing pose. Start or resume elapsed
  time only when the landmarks are reliable and both checks pass.
- Pause accrual when the pose is lost or outside the alignment range. Provide a
  simple adjustment reminder for either failed alignment check; do not claim
  safety, medical correctness, or diagnose posture.
- Format time as minutes and seconds. Pausing the workout also pauses elapsed
  time; resetting sets elapsed time to zero.

## UI and Accessibility

- The Home view includes Sabi Body branding, exact tagline, a concise
  explanation, a prominent Start Workout action, exercise cards, and a
  language selector.
- The Workout view includes selected exercise and instructions, live preview
  with overlay, body-visibility status, repetition count or plank timer,
  exercise state, prominent feedback, camera-positioning guidance, language and
  voice controls, and Start/Pause/Reset/End actions.
- Use large type, high-contrast text, visible focus states, descriptive control
  labels, semantic headings, and touch-friendly buttons.
- Voice feedback is optional. Speak only English messages when English is
  selected, when the browser supports speech synthesis, and when the cooldown
  allows it. Keep text coaching available regardless of speech support.

## Feedback and Localization

Feedback is represented by stable identifiers rather than inline strings.
English is the complete initial dictionary. The other supported languages have
no invented entries; lookup returns the English text and indicates that it is
a fallback so the UI can communicate this to the user.

Speech is best-effort and must not block workout analysis. Apply a cooldown to
prevent repeated speech for the same ongoing state. Provide a direct voice
enable/disable control.

The YarnGPT service module documents the future boundary: a same-origin,
server-side endpoint accepts a message identifier and language and returns
audio or text. Browser code must never contain API keys.

## Validation

- Run the production Vite build after implementation.
- Add focused checks for geometry and exercise state transitions: incomplete
  squat/jack cycles do not count, a complete cycle counts once, unreliable
  landmarks do not advance progress, and plank time accrues only for a
  recognizable pose.
- Manually verify responsive Home/Workout navigation, deferred permission,
  camera start/pause/reset/end cleanup, visible skeleton alignment, user-facing
  failure states, English fallback, and speech controls in a camera-capable
  browser.
- Do not claim camera/model behavior was tested on hardware unless it was
  actually exercised.

## Key Risks and Limits

- Camera angle, clothing, lighting, device performance, and landmark confidence
  affect estimates. Clear positioning guidance and reliable-landmark gates
  reduce false counts but cannot make a single camera view universally precise.
  Squat analysis uses projected 2D coordinates, so it requires a side-on view;
  frontal knee motion in depth may not reach its projected-angle thresholds.
- Synchronous inference may be costly on some devices. Keep inference to one
  animation loop and one pose.
- Browser speech voices vary by operating system and browser; written feedback
  remains the source of truth.
- Translation quality requires validation by fluent speakers before adding
  non-English dictionary entries.
