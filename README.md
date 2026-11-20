# Sabi Body

Sabi Body is a browser-based movement coach for squats, jumping jacks, planks,
push-ups, sit-ups, lunges, and high knees. It provides simple on-screen cues
and movement tracking; it is not a medical, diagnostic, or rehabilitation
tool. Move at a pace that feels comfortable to you.

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
preview on a Canvas. The MediaPipe WASM runtime and pose model are served by
the app itself from `public/mediapipe/wasm/` and `public/models/`, and are
fetched from the site when tracking initializes.

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

High Knees uses alternating leg movements and a complete-cycle check:

- **High Knees:** Alternately lift each knee to hip height and return to a
  neutral stance. The app requires a stable exercise-specific starting pose
  before the countdown.
Automated tests use synthetic landmarks; they do not establish real-camera
accuracy or validate form for every body and camera setup.

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

The browser requests the MediaPipe WASM/model assets and web fonts. English
coaching text is read from the local phrase catalog, and spoken English uses
the browser's speech synthesis; coaching text is not sent to ChatGPT or
YarnGPT. The app may load the existing YarnGPT voice catalogue, but English
speech does not depend on that service being available. Camera frames, pose
landmarks, and microphone audio are not sent to YarnGPT.

When a signed-in user finishes or leaves a workout, only the workout summary is
saved (exercise, reps or plank seconds, target, duration, timestamps). Camera
frames and pose landmarks are never sent to the server.

## Accounts, workout history and reminders

Anyone can open SabiBody and exercise as a guest. Creating a free account adds
a dashboard, workout history, profile, settings and email reminders. The
database is **Neon PostgreSQL**, reached only by the FastAPI backend through
SQLAlchemy; the browser never sees the connection string. There is no Supabase.

Pages (hash routes, so Vercel needs no rewrites): `#/` home, `#/exercises`,
`#/register`, `#/login`, `#/forgot-password`, `#/reset-password`,
`#/verify-email`, and signed-in `#/dashboard`, `#/history`, `#/profile`,
`#/settings`, `#/admin` (administrators only).

### How sign-in works

- Passwords are hashed with Argon2id. Email-verification, password-reset and
  session tokens are random 256-bit values; only their SHA-256 hashes are stored.
- Login returns a 15-minute access token that the page keeps **in memory only**
  (never localStorage). A 30-day refresh token is set as an `HttpOnly`,
  `SameSite=Lax` cookie scoped to `/api/auth` (`Secure` in production).
- On every page load the app exchanges the cookie for a new access token, so
  users stay signed in across refreshes and browser restarts. Unticking
  "Keep me logged in" uses a browser-session cookie (12-hour server limit).
- Every refresh rotates the token. Replaying an old token outside a 30-second
  multi-tab grace window revokes all of that user's sessions.
- Logout revokes the session in the database. Password changes and resets sign
  out other devices. Sensitive endpoints are rate-limited per IP and per account
  (in process memory: adequate for one Render instance; per-IP limits can be
  bypassed by calling Render directly, per-account limits cannot).
- Protected endpoints derive the user from the verified token only; workout,
  profile and reminder queries are always scoped to that user. Workouts are
  validated server-side (an exercise is "completed" only if its target was
  reached) and de-duplicated by a per-user idempotency key.
- Administrators are rows in `admin_roles`, granted only server-side:
  `python -m app.cli grant-admin you@example.com`, or by listing your email in
  `ADMIN_BOOTSTRAP_EMAILS` (applied after that address is verified). Admin
  views are recorded in `admin_audit_logs`.

### Database migrations (Alembic)

From `backend/`, with `DATABASE_URL` set:

```powershell
py -3.10 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m alembic upgrade head      # create/upgrade tables
.venv\Scripts\python -m app.cli check-db           # list tables and revision
```

Tables: `users`, `workout_sessions`, `reminder_preferences`,
`email_verification_tokens`, `password_reset_tokens`, `refresh_sessions`,
`reminder_delivery_logs`, `admin_roles`, `admin_audit_logs`. The migration
only creates tables; it never deletes data.

### Backend tests against a real PostgreSQL

`requirements-dev.txt` includes `pgserver`, which bundles a local PostgreSQL:

```powershell
.venv\Scripts\python -c "import pgserver; s = pgserver.get_server('pgdata', cleanup_mode=None); s.psql('create database sabibody_test;'); print(s.get_uri())"
$env:TEST_DATABASE_URL = "<printed URI with /sabibody_test instead of /postgres>"
.venv\Scripts\python -m unittest discover -s tests
```

### Emails and reminders

Emails go through [Resend](https://resend.com) when `RESEND_API_KEY` and
`EMAIL_FROM` are set (the sender domain must be verified in Resend). Without
them, emails are **not delivered**; they are written to the backend log, which
is useful locally. Settings tells users when delivery is not switched on.

Reminders run when a scheduler calls `POST /api/internal/reminders/run` with
`Authorization: Bearer $CRON_SECRET`. The included GitHub Actions workflow
(`.github/workflows/workout-reminders.yml`) does this every 15 minutes once the
`SABIBODY_API_URL` and `CRON_SECRET` repository secrets are set. A reminder is
sent only if reminders are on, the user's local time has reached the chosen
time (and is within 3 hours of it), and they have not completed a workout that
local day. Each (user, morning/evening, date) is recorded once, so duplicates
are impossible even if two runs overlap.

### Deployment settings

**Render (backend)** — root directory `backend`:

- Build command: `pip install -r requirements.txt`
- Pre-deploy command (or prefix the start command):
  `python -m alembic upgrade head`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Environment: `PYTHON_ENV=production`, `DATABASE_URL`, `AUTH_SECRET_KEY`,
  `FRONTEND_URL=https://<your-vercel-domain>`,
  `SABI_ALLOWED_ORIGINS=https://<your-vercel-domain>`, `YARNGPT_API_KEY`,
  `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, optionally
  `ADMIN_BOOTSTRAP_EMAILS`. Remove any old `SUPABASE_*` variables.

**Vercel (frontend)** — no environment variables are required. `vercel.json`
rewrites `/api/*` to Render, so the refresh cookie is first-party to the Vercel
domain. Remove any old `VITE_SUPABASE_*` variables.

**Neon** — copy the **pooled** connection string (Connect → Pooled connection)
into Render's `DATABASE_URL`. It must include `sslmode=require`.

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
hip, and ankle visible. High Knees need both legs in view. Follow the
exercise-specific prompts for the required framing of push-ups, sit-ups, and
lunges. Camera access can be blocked by browser/site settings, another app
using the camera, missing hardware, or a non-secure origin. Use
`localhost` while developing or serve the app over HTTPS, grant access in the
browser prompt, and use the displayed retry guidance if startup fails. Spoken
feedback uses browser speech synthesis when available and starts enabled; the
Voice coaching setting can mute it.

First-time users should check real-camera behavior on their own supported
browser and device. The app requests camera permission only after **Start**;
automated tests use test doubles and do not replace this real-camera check.

## Languages and speech

This release exposes **English** as the only selectable coaching language.
The other translations, language metadata, and YarnGPT backend support remain
in the codebase for possible future reactivation. English messages and exercise
instructions come from the local phrase catalog, and automatic English speech
uses the browser's speech synthesis; neither ChatGPT nor a working YarnGPT
connection is required. The app may still load the existing YarnGPT voice
catalogue, but English coaching text is not sent for YarnGPT synthesis.

Spoken coaching starts automatically when a workout begins. It gives the
exercise instructions, announces each analyzer-confirmed repetition, and
celebrates completion with the achieved total and a suggested rest. Planks use
time-based holding guidance and completion instead of repetition counts. The
single **Voice coaching** setting is an optional mute override; written
feedback remains available when muted or when browser speech is unavailable.
English speech uses the browser and does not depend on ChatGPT or YarnGPT.

## Adding an exercise

The current exercise analyzers are in `src/exercises/`. To add another:

1. Create an analyzer module in `src/exercises/` with a small stateful API
   (normally `update(landmarks, timestamp)` and `reset()`), using the existing
   geometry and visibility helpers where useful.
2. Add focused analyzer tests in `test/exercises.test.js` for valid cycles,
   incomplete movements, missing/low-confidence landmarks, and reset behavior.
3. Register the analyzer in `createAnalyzers()` in `src/ui/app.js`.
4. Add the exercise's name, description, starting instruction, camera framing
   guidance, and progress label to `EXERCISES` in
   `src/ui/exercise-content.js`.
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

Starter translations live in the categorized phrase catalog in
`api/src/shared/coaching-messages.js`. Non-English phrases and synthesized
audio have not received native-speaker verification. Update that shared catalog
and its tests when correcting a phrase. A provider voice's language declaration
is not pronunciation verification; test each language and obtain human review
before claiming it works.
