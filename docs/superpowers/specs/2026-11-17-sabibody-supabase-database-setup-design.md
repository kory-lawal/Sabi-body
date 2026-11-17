# SabiBody Supabase Database Foundation

**Status:** Design approved in chat; implementation has not started.

## Goal

Prepare a repeatable, data-preserving Supabase schema setup for the existing
SabiBody account features. Keep the current Vite frontend, FastAPI backend,
auth flow, workout behavior, and query interfaces. Do not claim or perform
remote database changes without verified project access.

## Existing application and schema evidence

The application is a Vite/vanilla-JavaScript frontend with a FastAPI backend.
The Supabase JavaScript client is configured in the frontend. The backend
contains token verification and speech-related functionality, but no database
routes or Supabase database client.

The frontend services reference:

- `profiles`: select the authenticated profile and update `full_name`.
- `workout_sessions`: list sessions by `started_at` and upsert by
  `(user_id, client_session_id)`.
- `reminder_preferences`: read and upsert by `user_id`.
- `get_workout_summary()`: return totals for the authenticated user.

The existing migration
`supabase/migrations/20261117020000_create_sabibody_account_data.sql`
defines these three tables, profile creation/email-sync triggers, user-owned
RLS policies, workout indexes, and the summary function. Its DDL is not
repeatable as written, and there is no evidence that it has been applied to
the live project. The app already renders safe reminder defaults when no
preference row exists.

No admin dashboard, admin API, or admin-table query was found. The requested
live schema inspection could not be completed: this environment has no
Supabase CLI, database credential, or Supabase schema tool, and the Supabase
project hostname could not be resolved. Existing live tables and migration
history therefore remain unknown.

## Database design

### User profiles

`profiles.id` is both the primary key and a cascading foreign key to
`auth.users.id`. The table stores `full_name`, `email`, `created_at`, and
`updated_at`. A trigger creates one profile on auth-user insertion using
signup metadata and synchronizes email changes. Users can read their own
profile and update only their name; email changes continue through Supabase
Auth.

### Workout sessions

Preserve the application’s existing shape: UUID `id`, `user_id`,
`client_session_id`, exercise name/type, repetition and duration targets,
measured duration, completion state, start/end/completion timestamps, and
`created_at`. Ownership defaults to `auth.uid()` and the client does not send
a user ID as proof of identity.

Keep the supported exercise constraint for Squats, Jumping Jacks, Plank,
Push-ups, Sit-ups, Lunges, and High Knees. Preserve checks for nonnegative
quantities, exercise/measurement compatibility, timestamp order, completion
state, and target attainment. A unique constraint on
`(user_id, client_session_id)` keeps retries idempotent. Indexes support
per-user date and completion queries.

### Reminder preferences

Keep one row per user, with global, morning, and evening switches; morning and
evening local times; timezone; and creation/update timestamps. Defaults are
disabled, 07:00, and 19:00. If no row exists, the current UI continues to
render disabled preferences and uses the browser timezone until the user
saves settings.

### Admin registry

Add a private `admin_users` table keyed by `auth.users.id`, with a constrained
admin role and grant timestamp. It starts empty. RLS is enabled, and
`anon`/`authenticated` receive no table grants or policies. No user can grant
themselves a role, and no admin is seeded by the migration. Role assignment
is a trusted project-owner operation through the Supabase SQL Editor.

This is only secure role-storage groundwork. An admin dashboard, admin
statistics, and privileged access to other users’ records are not part of
this change.

## Security

Enable RLS on all user-related tables. Profile policies use
`profiles.id = auth.uid()`. Workout and reminder policies use
`user_id = auth.uid()`. Preserve the existing own-row operations required by
the frontend while preventing normal users from reading or modifying another
user’s records.

`get_workout_summary()` remains `SECURITY INVOKER`, accepts no user ID, and
aggregates only completed rows for `auth.uid()`. No service-role key or
elevated credential is introduced into the browser.

## Migration and compatibility strategy

Make the existing migration a repeatable setup script suitable for the
unknown live schema state. It will:

- Create missing tables, indexes, functions, triggers, and policies without
  dropping tables or deleting/replacing user data.
- Inspect existing columns, types, foreign keys, and constraints before
  relying on them; report incompatible or incomplete existing table shapes
  with an actionable error instead of silently assuming compatibility.
- Avoid duplicate indexes, triggers, and policies, and enforce the intended
  definitions for the migration’s named policies/triggers.
- Preserve the columns and RPC signature used by the current application.

The script will not be executed against Supabase in this environment. Because
the project’s migration history is also unavailable, the instructions will
explain how to run and verify the SQL in Supabase SQL Editor; editing a
migration already marked applied does not cause the Supabase CLI to rerun it.

## Application changes and validation

The current service query shapes match the existing migration, so no
application query changes are planned unless focused tests reveal a concrete
mismatch. Add or update tests to check required query columns, ownership/RLS
definitions, schema constraints, and repeatable DDL. Keep existing account
empty states and reminder defaults.

Local validation will run the Node test suite and production build. These
checks cannot establish live table existence, signup profile-trigger
behavior, or cross-account RLS isolation. Those require applying the SQL and
testing with separate authenticated accounts in the configured Supabase
project.

## Manual Supabase steps and limitations

The project owner must review and run the complete migration in Supabase SQL
Editor, then inspect the resulting tables, constraints, triggers, grants, and
RLS policies. Live schema state is unverified until then. No table creation
or remote modification is claimed by this design.
