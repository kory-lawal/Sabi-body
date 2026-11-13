# Sabi Body

Sabi Body is a browser-based movement coach for squats, jumping jacks, planks,
push-ups, sit-ups, and lunges. It provides simple on-screen cues and movement
tracking; it is not a medical, diagnostic, or rehabilitation tool. Move at a
pace that feels comfortable to you.

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

Open `http://localhost:5176/`.
The Home page does not request camera permission. Choose an exercise to see its
picture, benefits, and movement instructions before the camera workout. Press
**Start** when ready. The browser then asks for camera permission; allow it to
use the live preview and tracking. If
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

- **Squats:** Stand side-on to the camera with your hip, knee, and ankle
  hip-knee-ankle points. A repetition is counted after it observes a standing
  angle of at least 160°, a descent to 110° or less, and a return to at least
  160°. It uses both reliable sides when available, or the side with stronger
  visibility evidence when only one side is usable. A frontal view may hide
  knee flexion that occurs in depth, so it may not reach the counting
  thresholds.
- **Jumping jacks:** The analyzer first waits for a closed starting position.
  1.15 times hip width, then an open position (wrists above shoulders and feet
  at least 1.35 times hip width). It counts once when the movement returns from
  open to closed.
- **Plank:** The analyzer uses a visible shoulder-hip-ankle angle from either
  absolute horizontal displacement must exceed 1.5 times the absolute
  vertical displacement. It marks the position aligned within 20° of a
  straight line and adds elapsed time only while both checks pass. Missing,
  out-of-line, or non-horizontal frames break timing continuity; brief frame
  gaps are capped so a stalled frame does not add a large amount of time.

Before progress is accepted, the app requires three consecutive frames with
exercise-specific landmarks at confidence 0.60 or higher, inside a 2% frame
margin, with a valid start pose. A lost or invalid pose pauses plank timing
immediately; squat and jumping-jack phase changes require stable observations
and are invalidated after prolonged tracking loss. The readiness gate uses a
normalized body span of 0.35–0.90 of the image height for upright exercises and
of the image width for planks. Shoulder/hip width ratios provide a conservative
2D front-versus-side estimate (at least 0.35 of torso length for front, at most
0.25 for side); they are not a 3D orientation measurement.

- **Squats:** Start side-on and upright (hip-knee-ankle angle at least 160°).
  Count a repetition after a stable descent to 105° or less, a hip-position
  check relative to the knee, and a stable return to at least 160°. The analyzer
  uses the more reliable side when both sides are not available.
- **Jumping jacks:** Start facing the camera, with arms down and feet no wider
  than 0.8 times hip width. An open phase requires feet at least 1.5 times hip
  width apart and both wrists above the nose; a repetition completes on a
  stable return to closed.
- **Plank:** Start side-on with the supporting arm visible and body aligned at
  an angle of at least 155°, with hip deviation no greater than 0.10 of
  shoulder-to-ankle length. The shoulder-to-ankle horizontal span must exceed
  1.5 times its vertical span. Only valid alignment contributes time; tracking
  loss pauses the timer, and a single interval contributes at most 200 ms.

In development mode, the camera panel includes pose diagnostics for readiness,
form validity, movement phase, rejection reason, and measured values. The
skeleton is amber while positioning, green when the current form is accepted,
and coral when the exercise is ready to track but its current form is rejected.
These geometric thresholds may not fit every body, camera setup, or exercise
variation. Automated tests use synthetic poses; manually verify camera
placement, framing, and the exercise flow on each supported device before
relying on it. Stop if a movement feels uncomfortable and seek appropriate
professional guidance for individual health questions.

For a physical camera check, verify each exercise's starting-position prompt,
then try partial framing and a brief tracking interruption. Confirm that no
repetition is counted from an incomplete movement, plank time stops when
alignment is lost, pause/resume preserves earned progress, and Reset clears
progress. This manual check is still required; synthetic tests do not establish
real-world accuracy.

## Privacy

Camera access is requested only after you choose **Start**. The app uses camera
frames in the browser for local pose inference; it does not upload, record, or
store camera footage. It does not request microphone access. Ending the workout
stops the camera tracks, clears the preview, and stops the pose tracker.

The browser requests the MediaPipe WASM/model assets and web fonts. When
optional spoken coaching is enabled, it sends allowlisted coaching event IDs
and selected voice preferences to the same-origin backend. The backend resolves
the message and calls the configured YarnGPT TTS API with the actual coaching
text and selected voice. Camera frames, pose landmarks, and microphone audio
are not sent to YarnGPT. Synthesis may spend account credits. The app has no
account or workout-history storage.

## Accessibility and camera setup

The interface uses headings, labeled controls, keyboard-visible focus outlines,
and live status/feedback announcements. The camera preview has an accessible
label, and the decorative skeleton Canvas is hidden from assistive technology.
The layout reflows for narrower screens, and primary buttons have a generous
touch target. Written feedback remains available independently of spoken
feedback.

For tracking, place the device so the instructions' relevant landmarks remain
in view. Squats require standing side-on with hip, knee, and ankle visible;
the 2D image-plane angle can miss knee flexion in a frontal view. Jumping jacks
need hands and feet inside the frame; planks need a side view with shoulder,
hip, and ankle visible. Camera access can be blocked by browser/site settings,
another app using the camera, missing hardware, or a non-secure origin. Use
`localhost` while developing or serve the app over HTTPS, grant access in the
browser prompt, and use the displayed retry guidance if startup fails. Spoken
feedback uses the browser's speech-synthesis support when available and is
off by default.

First-time users should check real-camera behavior on their own supported
browser and device. The app requests camera permission only after **Start**;
automated tests use test doubles and do not replace this real-camera check.

## Languages and speech

The language menu offers **English**, **Yoruba**, **Igbo**, **Hausa**, and
**Nigerian Pidgin**. Non-English starter messages are unverified drafts and are
marked as such in the app. YarnGPT audio uses only voices discovered from the
provider catalogue and declared compatible with the selected language. Pidgin
uses authored text and is synthesized as written unless a separate translation
workflow is intentionally configured. English uses browser speech when selected.
Speech is optional and off by default.

The voice menu loads the catalogue returned by YarnGPT and filters it to
compatible voices for the selected language. Any returned voice with matching
language metadata remains selectable for the user after it is validated by the
provider catalogue.

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

## YarnGPT setup

The same-origin `/api/coach/voices` and `/api/coach/audio` routes are served by
the Python FastAPI backend on port 8000. Create a backend `.env` from the
placeholder template and add the API key there:

```powershell
Copy-Item backend\.env.example backend\.env
```

Keep `YARNGPT_API_KEY` only in the backend `.env` or a server-side secret store.
The backend uses `YARNGPT_BASE_URL=https://api.yarngpt.ai` and sends a
`Authorization: Bearer ...` header to YarnGPT. Start the backend and frontend in
separate terminals:

```powershell
cd backend
py -3.10 -m pip install -r requirements.txt
py -3.10 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

```powershell
npm run dev
```

Open `http://localhost:5176/`. The backend allows configured origins from
`SABI_ALLOWED_ORIGINS`. `.env` is Git-ignored; never put a key in frontend
variables, source files, `.env.example`, or chat. Revoke any key exposed on a
shared surface and replace it before use. Do not make live audio calls during
local development without approval.

## Translation review

Starter translations live in `api/src/shared/coaching-messages.js` and remain
unverified until reviewed by fluent speakers. Update that shared catalog and
its tests when correcting a phrase. A provider voice's language declaration
is not pronunciation verification; test each language and obtain human review
before claiming it works.
