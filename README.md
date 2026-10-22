# Sabi Body

Sabi Body is a browser-based movement coach for squats, jumping jacks, and
planks. It provides simple on-screen cues and movement tracking; it is not a
medical, diagnostic, or rehabilitation tool. Move at a pace that feels
comfortable to you.

## Requirements

- Node.js 20.19+ or 22.12+ (Vite 7 requirement)
- npm (installed with Node.js)
- A modern browser. Camera tracking requires camera access and a secure browser
  context: `localhost` during development or HTTPS when hosted.

## Install, run, test, and build

From the project directory:

```powershell
npm install
npm run dev
```

Open the local URL Vite prints in the terminal (usually `http://localhost:5173/`).
The Home page does not request camera permission. Choose an exercise, read its
positioning instructions, and press **Start** when ready. The browser then asks
for camera permission; allow it to use the live preview and tracking. If
permission is denied, no camera is available, or the camera cannot start, follow
the on-screen retry guidance. Do not use an insecure remote HTTP origin; use
HTTPS for a deployed site.

Run the automated checks and create a production bundle with the scripts
defined in `package.json`:

```powershell
npm test
npm run build
```

`npm test` runs the Node.js built-in test runner. `npm run build` invokes Vite's
production build and writes its assets to `dist/`. To preview that build
locally, run `npm run preview` after building and open the URL Vite prints.

## Camera, pose tracking, and movement analysis

When a workout starts, the browser requests a user-facing video stream with no
audio. MediaPipe Tasks Vision loads its WASM runtime and the Pose Landmarker Lite
model, then infers one pose at a time from new camera frames in `VIDEO` mode.
The app draws visible pose points and connecting lines over the mirrored camera
preview on a Canvas. Model/WASM assets are downloaded from their configured
CDN/model hosts when tracking initializes; this requires network access.

The counters are landmark-based movement cues, not a guarantee of correct form
or a medical assessment. They require sufficiently visible landmarks, so
framing, camera angle, lighting, clothing, movement, and model estimates can
affect detection. Follow the on-screen prompts to fit the relevant body parts
in frame. “Full body visible” is a visibility check, not a judgment that a
movement is safe or correctly performed.

- **Squats:** The analyzer measures the visible knee angle at the hip-knee-ankle
  points. A repetition is counted after it observes a standing angle of at
  least 160°, a descent to 110° or less, and a return to at least 160°. It uses
  both reliable sides when available, or the side with stronger visibility
  evidence when only one side is usable.
- **Jumping jacks:** The analyzer first waits for a closed starting position.
  It recognizes closed arms (wrists below shoulders) and feet no wider than
  1.15 times hip width, then an open position (wrists above shoulders and feet
  at least 1.35 times hip width). It counts once when the movement returns from
  open to closed.
- **Plank:** The analyzer uses a visible shoulder-hip-ankle angle from either
  side. It marks the position aligned within 20° of a straight line and adds
  elapsed time only while alignment remains visible. Missing or out-of-line
  frames break timing continuity; brief frame gaps are capped so a stalled
  frame does not add a large amount of time.

These simple geometric thresholds may not fit every body, camera setup, or
variation of an exercise. Stop if a movement feels uncomfortable and seek
appropriate professional guidance for individual health questions.

## Privacy

Camera access is requested only after you choose **Start**. The app uses camera
frames in the browser for local pose inference; it does not upload, record, or
store camera footage. It does not request microphone access. Ending the workout
stops the camera tracks, clears the preview, and stops the pose tracker.

The browser does make network requests to download the MediaPipe WASM/model
assets and the web fonts referenced by the app. Those asset hosts receive the
usual connection/request metadata, but the app does not send them camera
frames. The current app has no account, application server, or workout-history
storage.

## Accessibility and camera setup

The interface uses headings, labeled controls, keyboard-visible focus outlines,
and live status/feedback announcements. The camera preview has an accessible
label, and the decorative skeleton Canvas is hidden from assistive technology.
The layout reflows for narrower screens, and primary buttons have a generous
touch target. Written feedback remains available independently of spoken
feedback.

For tracking, place the device so the instructions' relevant landmarks remain
in view. Squats need visible hips, knees, and ankles; jumping jacks need hands
and feet inside the frame; planks need a side view with shoulder, hip, and
ankle visible. Camera access can be blocked by browser/site settings, another
app using the camera, missing hardware, or a non-secure origin. Use
`localhost` while developing or serve the app over HTTPS, grant access in the
browser prompt, and use the displayed retry guidance if startup fails. Spoken
feedback uses the browser's speech-synthesis support when available and is
off by default.

First-time users should check real-camera behavior on their own supported
browser and device. The app requests camera permission only after **Start**;
automated tests use test doubles and do not replace this real-camera check.

## Languages and speech

The language menu offers **English**, **Yoruba**, **Igbo**, **Hausa**, and
**Nigerian Pidgin**. English feedback text is implemented. Translations for the
other four choices are not available yet, so the app shows English text and
marks it as a fallback. Browser speech synthesis is implemented for English
only; non-English fallback text is not spoken. Speech depends on browser
support and remains optional.

## Adding an exercise

The current exercise analyzers are in `src/exercises/`. To add another:

1. Create an analyzer module in `src/exercises/` with a small stateful API
   (normally `update(landmarks, timestamp)` and `reset()`), using the existing
   geometry and visibility helpers where useful.
2. Add focused analyzer tests in `test/exercises.test.js` for valid cycles,
   incomplete movements, missing/low-confidence landmarks, and reset behavior.
3. Register the analyzer in `createAnalyzers()` in `src/ui/app.js`.
4. Add the exercise's name, description, starting instruction, camera framing
   guidance, and progress label to the `EXERCISES` map in that file.
5. Add any new feedback message IDs with English text in
   `src/feedback/messages.js`, and use those IDs from the analyzer. If a
   translation is later supplied, add it to the matching language dictionary
   and test the non-fallback result.
6. Run `npm test` and `npm run build`.

Keep movement feedback descriptive and non-medical. Do not claim the analyzer
provides a clinical assessment, universal form validation, or a safety
guarantee.

## Future YarnGPT boundary

YarnGPT-generated or translated speech is **not implemented in the current
app**. `src/services/yarngpt.js` is a future integration seam, not an active
workout feature; there is no YarnGPT server or request from the current UI. Any
future integration must send only the minimum message identifier and selected
language to a same-origin server-side endpoint. Keep provider credentials and
API keys on the server, never in frontend code, and do not send camera frames
or pose landmarks to that service.
