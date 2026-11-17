# Supabase Authentication and Workout History

**Status:** Approved design; implementation has not started.

## Goal

Connect Sabi Body to Supabase so people must sign in with email and password
before using the app, and completed workout summaries are saved to and loaded
from their own persistent history.

## Scope

- Add email/password sign-up, sign-in, session restoration, and sign-out.
- Require a valid authenticated session before showing workout controls.
- Persist completed workout summaries and show the signed-in user's history on
  the home page.
- Keep camera pose analysis in the browser and leave the existing Python speech
  API unchanged.

This initial change does not add guest mode, social login, profile editing,
history deletion, or camera/pose uploads.

## Architecture and data flow

The Vite application uses the Supabase JavaScript client with a project URL and
public anon/publishable key supplied through `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. The public key is safe to include in a browser bundle
only because table access is constrained by Row Level Security (RLS). A
service-role key must never be used by the frontend or committed to the
repository.

At startup, the application waits for Supabase to restore its auth session.
Until a session is available, it presents sign-in/sign-up instead of the
workout UI. After authentication, it loads the account's history. On workout
completion, it retains the existing in-memory result and inserts a compact
summary into Supabase. If the insert fails, it reports that the workout was
not saved without discarding the completion result.

The `workout_history` table contains:

- A generated UUID primary key.
- `user_id`, referencing `auth.users` and associated with the authenticated
  user.
- Exercise ID and display name.
- Target amount, unit (`reps` or `seconds`), and achieved amount.
- Completion timestamp.

Enable RLS. Authenticated users may select rows only when `auth.uid() =
user_id`, and may insert only rows satisfying the same ownership check. No
update or delete policy is included in this first version. History is displayed
newest first in the existing home-page "Completed workouts" section, with a
completion date/time.

## Authentication and interface behavior

Provide email/password sign-up and sign-in forms with loading, success, and
visible error states, along with a sign-out control. Wait for the initial
session check before rendering protected workout controls. When a session
expires, return the user to sign-in. Respect the Supabase project's email
confirmation configuration and redirect URL requirements.

Keep the existing workout completion screen and workout behavior. The
home-page history section replaces the current session-only summary with
account history. Do not persist camera frames, pose landmarks, or microphone
audio.

## Configuration and validation

Add the Supabase client dependency, a SQL migration for the table and RLS
policies, placeholder-only environment variable documentation, and setup
instructions for the Supabase project, email confirmation, and allowed
redirect URLs. Actual credentials remain in local/deployment environment
configuration and are never added to source control.

Add focused tests using a mocked Supabase client for auth gating and session
handling, plus history load/save/error behavior. Run the existing Node test
suite and production build. Document a manual smoke test for sign-up,
confirmation if enabled, sign-in, completing a workout, verifying history
persists after reload, and signing out. A live round trip cannot be validated
without project credentials.
