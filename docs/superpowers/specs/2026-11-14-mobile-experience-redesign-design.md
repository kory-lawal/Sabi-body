# SabiBody Mobile Experience Redesign

## Goal

Make SabiBody feel compact and easy to use on phones from the homepage through
exercise setup and the active workout. The active workout becomes camera-first
and near-full-screen, while the existing workout flow, goal semantics,
MediaPipe tracking, and coaching remain intact.

The redesign is limited to phone layouts at widths of 480px and below, plus
short, coarse-pointer landscape phone viewports. Existing desktop and tablet
layouts are not redesigned.

## Current behavior

- The home and workout headers place language and coach-style selectors in
  their visible layout. At phone widths, the current 680px media query stacks
  these controls and the tagline vertically.
- The mobile homepage uses a tall copy-then-art hero and a single-column
  exercise grid.
- Choosing an exercise opens the existing exercise information, goal, camera,
  progress, coaching, and control view. The camera starts only when Start is
  pressed.
- The camera stage uses a fixed aspect ratio and `object-fit: cover` for both
  the video and the overlaid pose canvas. MediaPipe analyzes the video element;
  pose landmarks are drawn on the canvas.
- There is no native fullscreen handling or active-workout scroll lock.

## Design

### Homepage and settings

At phone widths, keep the SabiBody logo and a compact hamburger button in one
header row. The button opens an anchored settings panel containing the
existing language and coach-style selectors. The panel closes after a setting
is selected, when a pointer lands outside it, or on Escape. It exposes the
same language and coach-style options and uses the existing preference update
flow.

The mobile settings panel is available on the home and pre-workout setup
screens. It is not shown over the active camera; language and coach style are
selected before Start. Desktop and tablet keep their current visible selectors.

Reduce the mobile hero's top/bottom spacing and illustration height while
retaining its existing heading, privacy message, primary action, and artwork.
The first viewport should communicate the product and expose the workout
action without making the page feel crowded.

Use the selected adaptive exercise grid: one column at widths up to 360px and
two columns from 361px through 480px. Preserve the existing exercise images
with contained proportions, visible names and descriptions, and comfortable
card actions. Do not add horizontal scrolling.

### Exercise and goal setup

Keep the current flow and controller state; do not add a separate goal step.
The selected exercise remains the setup screen heading. On phones, make the
existing demonstration and instructions compact but readable, then keep the
current goal summary and target choices clearly visible before Start.

Preset repetition and duration buttons wrap into touch-friendly rows. The
custom input remains available. Presets, custom values, displayed target,
progress, and completion continue to use the existing `state.target` data
flow. The camera placeholder remains on the pre-start screen, and camera
access still begins only after Start.

### Active workout

On phone layouts, the loading, running, and paused workout states use a
viewport-filling camera stage. The Start click initiates a Fullscreen API
request synchronously during the user gesture, then starts the existing
asynchronous workout flow without waiting for that request to resolve. If the
API is unsupported or the request is rejected, the same camera-first layout
remains active as a CSS fixed-viewport fallback. Fullscreen failure does not
prevent camera startup or reset workout progress.
If the user exits browser fullscreen, the CSS layout and active session remain
intact.

Lock page scrolling only while the mobile workout is active. Size the stage
with viewport-height fallbacks and safe-area insets, and adapt its overlays to
short landscape phone screens without changing ordinary tablet layouts.
Rotation changes layout only; it does not recreate the controller, restart
MediaPipe, or clear progress.

Keep the video and pose canvas in the same stage, with the same dimensions,
contained aspect ratio, and horizontal mirror transform. Use `object-fit:
contain` on both so the source frame is not cropped or distorted. Any
letterboxing is preferable to cropping the user's body. MediaPipe continues
to analyze the original video element; detection, landmarks, and counting
algorithms are unchanged.

A compact top overlay shows the exercise name, current reps or plank timer,
selected target, and body-position/readiness status. The selected compact
bottom dock shows progress and form/coach feedback with touch-friendly
Pause/Resume, Reset, and End controls. Existing voice coaching remains
available; voice-specific controls move into a compact disclosure in the dock
so they do not crowd the camera. The dock must not obscure the central body
area more than necessary.

On end, completion, or return to setup, restore normal page scrolling and exit
native fullscreen when possible. Pause and resume preserve the current
camera-first layout and workout state.

### Scope and boundaries

- Apply new portrait rules only through 480px. Keep the existing desktop and
  tablet styling unchanged.
- Support phone landscape through a coarse-pointer, landscape rule limited to
  viewport heights of 430px or less and widths of 900px or less; do not apply
  the camera-first layout to ordinary tablet viewports.
- Preserve existing exercises, goal values and calculations, camera permission
  behavior, MediaPipe pose detection, repetition counting, plank timing,
  translations, YarnGPT integration, and workout controls.
- Do not add zoom, alter camera capture constraints, or introduce a second
  mobile-only workout/data flow.

## Interfaces and data flow

- `src/ui/app.js` continues to own the current screen and workout state. The
  hamburger's open/closed state is presentation-only; language, coach style,
  selected exercise, goal, voice settings, and workout progress remain in
  their existing state paths.
- Existing delegated actions remain the source of truth for exercise selection,
  goals, and workout controls. Mobile styling follows the current view and
  workout status rather than duplicating the workout controller.
- The Start action initiates the fullscreen request from the user gesture and
  invokes the existing workout start path without awaiting fullscreen.
  Fullscreen is an enhancement, not a prerequisite for camera startup.
- `src/pose/pose-tracker.js` and `src/pose/draw-pose.js` keep their current
  responsibilities. The shared stage and matching video/canvas fit and mirror
  preserve their coordinate relationship.

## Error behavior

- Unsupported or denied fullscreen falls back to the fixed CSS layout. Keep
  the workout running and surface a concise non-blocking status if the request
  fails.
- Camera and MediaPipe errors continue through their existing error/status
  paths; a layout or orientation change must not hide them or present a
  successful camera state prematurely.
- Closing the settings panel or leaving native fullscreen does not discard
  selected preferences or workout progress.

## Validation

Add focused UI tests for:

- Opening and closing the mobile settings panel, including selection, outside
  click, and Escape; all existing language and coach-style choices remain
  available.
- The adaptive card layout hooks and the setup screen retaining the selected
  exercise and target, including preset/custom goal behavior.
- Fullscreen request on Start, unsupported and rejected request fallback,
  continued workout startup, and fullscreen/scroll cleanup on session exit.
- Pausing, resuming, resetting, ending, and completing a workout without
  losing the selected target or changing rep/plank behavior.

Validate homepage, setup, and active workout at 320px, 360px, 375px, 390px,
430px, and 480px, plus phone landscape. Check for horizontal overflow and
unwanted page scrolling. Where a camera is available, verify the full source
frame remains visible and the pose canvas stays aligned with the video in
portrait, landscape, and after rotation. Run the existing focused tests, the
full test suite, and the production build.

## Files expected to change

- `src/ui/app.js` — mobile menu interactions and active-workout/fullscreen
  state wiring, while preserving the existing controller and goal flow.
- `src/styles.css` — phone-only compact layouts, menu, camera-first screen,
  safe-area, aspect-fit, and orientation rules.
- `index.html` — enable safe-area viewport behavior for edge-to-edge mobile
  presentation.
- `test/app.test.js` — focused coverage for new menu and fullscreen behavior
  and preservation of existing workout state.
