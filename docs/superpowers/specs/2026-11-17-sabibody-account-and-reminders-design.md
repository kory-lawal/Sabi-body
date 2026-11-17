# SabiBody Accounts, Workout History, and Reminders

**Status:** Approved design; implementation has not started.

## Goal

Remove the five unsupported exercise options while preserving the original six
exercises and High Knees. Add optional Supabase accounts, protected personal
workout history, a responsive account experience, and persistent reminder
preferences without changing the existing camera, pose-analysis, or voice
coaching behavior.

## Existing application

SabiBody is a Vite application using vanilla JavaScript modules. Exercise
content is listed in `src/ui/exercise-content.js`; `src/ui/app.js` registers
the analyzers and owns the workout controller and screen rendering. Camera
tracking and coaching are already client-side. The existing backend serves
speech and pose endpoints and has no email delivery or scheduling facility.

The current checkout has no Supabase project URL/key, Supabase migration, or
email provider configuration. An existing account/history design document
requires authentication before workouts; this design supersedes that behavior
because guests must remain able to work out.

## Exercise catalogue change

Retain Squats, Jumping Jacks, Plank, Push-ups, Sit-ups, Lunges, and High Knees.
Remove Mountain Climbers, Donkey Kicks, Bicycle Crunches, Standing Side Leg
Raises, and Bird Dogs from exercise content and card generation, analyzer
registration, goal defaults/presets, feedback/personality references, and
current documentation. Remove only the five exercise-specific analyzer,
test, and image assets; retain shared geometry, readiness, camera, tracking,
and coaching code used by retained exercises.

Do not alter the existing six analyzers' detection, counting, camera, or voice
coaching behavior. Keep the High Knees analyzer and its existing behavior.

## Authentication and guest behavior

Use `@supabase/supabase-js` in the browser with `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. The public key is not a secret; a service-role key
must never be added to client code or a `VITE_` variable. The SDK's persistent
session storage and token refresh remain enabled.

Provide email/password sign-up (full name, email, password, confirmation),
login, password recovery/update, and logout. Validate required fields, email
format, password confirmation, and the project's password minimum; display
provider confirmation, success, and error states. Signup metadata supplies
the full name for profile creation.

Home and workout routes remain available to guests, including when Supabase
is not configured. Account routes require an authenticated session. If the
client configuration is missing, show an explicit account-configuration
message without disabling guest workouts. Protect private data twice: route
guards in the UI and PostgreSQL Row Level Security (RLS).

## Database and security

Create a SQL migration for:

- `profiles`: auth-user UUID primary/foreign key, full name, email, and created
  and updated timestamps. An `auth.users` trigger creates the profile from
  signup metadata and keeps its email synchronized. Users may update their
  own name; email changes go through Supabase Auth.
- `workout_sessions`: UUID primary key, user ID, exercise name/type,
  completed and target repetitions, actual and target duration in seconds,
  completion state, start/end/completion timestamps, and a client-generated
  workout session key unique per user. Repetition-specific values are null for
  timed Planks, which store their goal in `target_duration_seconds`. The unique
  session key makes retries idempotent.
- `reminder_preferences`: UUID primary key, user ID, global email reminder
  switch, independent morning/evening switches and local times, selected IANA
  timezone, and created/updated timestamps.

Use foreign keys with user deletion cascading, checks for supported exercise
types, nonnegative quantities, valid times, and indexes for per-user date and
completion queries. Enable RLS on every user-related table. Profile policies
scope ownership with `profiles.id = auth.uid()`; workout and reminder policies
scope ownership with `user_id = auth.uid()`. No browser-supplied user ID may
establish ownership. Profile creation and timestamp maintenance happen in
database triggers. Do not expose service-role credentials.

## Workout persistence and history

Create a stable unique key when each workout attempt starts. On target
completion, store the authenticated user's exercise, target and achieved
quantity, actual duration, timestamps, and `completed=true`. On explicit
manual exit or camera/start failure after an attempt begins, save the attempt
with its measured progress and `completed=false`; incomplete attempts must
never be presented as completed. Guest workouts stay in memory only. Do not
upload camera frames, pose landmarks, or microphone audio.

Workout completion and camera cleanup must not wait on a network save. Show an
accessible save error while retaining the workout result. Treat duplicate
completion callbacks as one database record using the per-attempt key. Do not
record an attempt that never began.

The dashboard derives counts, total repetitions, workout duration, current
week activity, and recent sessions from actual RLS-protected database records.
The history page shows each day's sessions, quantities/duration, and status;
users can navigate to previous weeks. New accounts see a clear empty state,
not placeholder workout data. Profile displays the authenticated email and
allows name updates and password recovery/change.

## Account navigation and layout

Add Home, Exercises, Dashboard, Workout History, and Settings navigation to
the existing branded application, using its current color tokens, typography,
and visual direction. The account screens adapt to mobile, tablet, and desktop.
Keep the camera workout screen independent from dashboard rendering and
navigation so account UI changes do not replace or obscure the live workout.

## Reminder preferences and delivery boundary

Settings include a Workout Reminders section. Users can turn email reminders
globally on or off, independently enable morning and evening reminders,
choose each local time, and select an IANA timezone. Default the timezone to
the browser's detected zone and persist the selected zone and preferences in
Supabase. Morning-only, evening-only, both, and neither are supported.

No email provider or scheduler is currently configured. Implement and verify
preference persistence only; do not send client-side email or claim delivery
is active. Live delivery requires a verified email provider and server-side
scheduling/credentials. Once configured, the server-side job must evaluate
each user's local date/time, skip users who completed a workout that day, and
use an atomic per-user/day/slot delivery ledger to prevent duplicate email.
Provider credentials remain server-side.

## Errors and privacy

Provider and database errors remain visible; failed reads are not rendered as
successful empty data, failed saves do not discard completed workouts, and
failed logout does not claim success. Escape user-visible text in HTML and use
text content for asynchronous status updates. Never store passwords outside
Supabase Auth or expose service-role keys.

## Validation

Automated tests cover the exact seven-exercise catalogue, removed registration
and references, retained High Knees and original analyzer behavior, auth form
validation and session restoration, guest workout availability, RLS-scoped
service usage, idempotent completed/incomplete workout saves, real-data
dashboard/history mapping, and reminder preference persistence/timezone.
Run the existing Node test suite and production build. Exercise selection and
start behavior should be checked for all seven options without changing their
analyzers.

Without a configured Supabase project and applied migration, tests cannot
prove live signup, email confirmation, refresh/restart session restoration,
or cross-account RLS isolation. Those checks require a configured test
project and separate test accounts. Reminder delivery cannot be tested until
an email provider and scheduler are configured.

## External setup required

To exercise live account behavior, configure the Supabase project URL and
public anon key, enable email/password auth, set allowed redirect URLs, and
apply the SQL migration. Do not send project credentials in chat or commit
them. To deliver reminders, additionally configure an email provider with a
verified sender and server-side secret, plus a scheduled server-side runtime
and its secure access to the project.
