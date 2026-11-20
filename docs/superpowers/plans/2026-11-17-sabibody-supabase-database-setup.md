# SabiBody Supabase Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SabiBody’s existing account-data migration safe to rerun, compatible with the current app queries, and include a private empty admin-role registry.

**Architecture:** Keep the existing Vite/Supabase browser services and FastAPI backend unchanged. Harden the existing SQL migration with catalog preflight checks, idempotent creation of missing objects, owner-scoped RLS, and a locked-down `admin_users` table. Update setup documentation and verify statically with the existing Node test suite; do not claim remote schema changes.

**Tech Stack:** PostgreSQL/Supabase SQL, Node.js built-in test runner, Vite.

**Spec:** [../specs/2026-11-17-sabibody-supabase-database-setup-design.md](../specs/2026-11-17-sabibody-supabase-database-setup-design.md)

## Global Constraints

- Keep the existing Vite/vanilla-JavaScript frontend, FastAPI backend, auth flow, workout behavior, and query interfaces.
- Never expose a Supabase service-role key or other elevated credential in browser code.
- Enable RLS on every user-owned table and scope user records to `auth.uid()`.
- Do not drop tables, delete user data, or silently rewrite existing records.
- `admin_users` starts empty and has no grants or policies for `anon` or `authenticated`.
- Live schema state and migration history are unknown; do not claim remote changes or live validation.
- Use the Supabase SQL Editor for the repeatable script if the existing migration is already marked applied by Supabase CLI.

---

## File map

- `supabase/migrations/20261117020000_create_sabibody_account_data.sql` — repeatable schema setup, compatibility checks, triggers, indexes, grants, RLS policies, summary RPC, and private admin registry.
- `test/supabase-schema.test.js` — static checks for required tables/columns, app-query compatibility, RLS, constraints, admin privacy, and rerun safety.
- `README.md` — operator instructions for applying and verifying the SQL without implying it was applied remotely.

## Task 1: Harden the account schema migration

**Files:**
- Modify: `test/supabase-schema.test.js`
- Modify: `supabase/migrations/20261117020000_create_sabibody_account_data.sql`

**Interfaces:**
- The migration continues to provide `profiles`, `workout_sessions`, `reminder_preferences`, and `get_workout_summary()` with the exact fields consumed by `src/services/profile.js`, `src/services/workout-history.js`, `src/services/workout-summary.js`, and `src/services/reminder-preferences.js`.
- The migration adds `admin_users(user_id, role, created_at)`; `user_id` is the primary key and a cascading foreign key to `auth.users(id)`, and `role` is constrained to `admin`.

- [ ] **Step 1: Write failing schema and service-compatibility assertions**

In `test/supabase-schema.test.js`, replace the three-table-only assertion with explicit expected columns for the existing query services:

```js
const expectedColumns = {
  profiles: ['id', 'full_name', 'email', 'created_at', 'updated_at'],
  workout_sessions: [
    'id', 'user_id', 'client_session_id', 'exercise_name', 'exercise_type',
    'completed_reps', 'target_reps', 'target_duration_seconds',
    'duration_seconds', 'completed', 'started_at', 'ended_at',
    'completed_at', 'created_at',
  ],
  reminder_preferences: [
    'id', 'user_id', 'email_reminders_enabled', 'morning_reminder_enabled',
    'morning_reminder_time', 'evening_reminder_enabled',
    'evening_reminder_time', 'timezone', 'created_at', 'updated_at',
  ],
};
```

Extract each table’s `CREATE TABLE` body and assert every expected column is declared. Read the four service files and assert each selects or writes only those declared fields; assert the summary RPC returns `total_workouts`, `total_reps`, and `total_duration_seconds`.

Add assertions that all four account/role tables enable RLS, the three user-data tables retain their `auth.uid()` ownership rules, the migration declares `admin_users` without grants or policies for `anon`/`authenticated`, the profile creation/email-sync triggers remain, and the workout uniqueness/check constraints and indexes remain. Assert the SQL contains no `DROP TABLE`, `TRUNCATE`, or `DELETE FROM` statement; `ON DELETE CASCADE` foreign keys remain allowed.

Assert table and index creation is guarded, the migration checks `information_schema.columns` and `pg_constraint` before relying on an existing table, and known trigger/policy creation is guarded or replaced by name. Keep the existing assertion that no service-role credential appears.

- [ ] **Step 2: Run the focused test and confirm it fails for missing migration behavior**

Run: `node --test test/supabase-schema.test.js`

Expected: FAIL because the current migration uses unguarded `CREATE TABLE`/`CREATE INDEX`, lacks existing-schema validation, and has no `admin_users` registry.

- [ ] **Step 3: Make missing-table creation idempotent**

Change table and index declarations to `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. Preserve the existing profiles/workout/reminder columns and constraints. Add:

```sql
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'admin' check (role = 'admin'),
  created_at timestamptz not null default now()
);
```

Enable RLS on `admin_users`; revoke table privileges from `public`, `anon`, and `authenticated`; do not add any policy or role seed.

- [ ] **Step 4: Add existing-schema preflight checks before dependent DDL**

After each table declaration, use a `DO` block to inspect `information_schema.columns` for required column names, data types, and nullability, and `pg_constraint` for the expected primary key, auth-user foreign key, unique keys, and named checks. Check equivalent constraint definitions and unique indexes as well as object names so a differently named but equivalent constraint is not duplicated. If an existing table is incomplete or incompatible, raise an exception naming the table and missing/conflicting object; do not change column types or rewrite rows.

For a compatible existing table, add only a missing constraint after verifying the required columns are present and confirming there is no equivalent constraint/index. Let PostgreSQL reject invalid existing data; do not bypass constraint validation. Keep indexes guarded with `IF NOT EXISTS`, then compare any existing same-name index definition with the expected definition and stop if it differs.

- [ ] **Step 5: Make triggers, policies, grants, and RPC safe to rerun**

Keep trigger functions `CREATE OR REPLACE`. For the migration’s named triggers, check or drop only that exact trigger name before recreating the definition. Recreate only the migration’s named RLS policies so reruns do not duplicate them. Before installing those policies, detect unexpected policies on the protected tables that could broaden access; stop with an actionable exception instead of deleting an unknown policy.

Keep the profile select/update policies on `id = auth.uid()` and the workout/reminder policies on `user_id = auth.uid()`. Preserve the profile update-column grant for `full_name`. Keep the summary RPC `SECURITY INVOKER`, with no caller-supplied user ID. Revoke normal-client privileges from `admin_users` and do not grant them back.

- [ ] **Step 6: Run the focused schema test**

Run: `node --test test/supabase-schema.test.js`

Expected: PASS with all schema/query compatibility, ownership, admin privacy, and rerun-safety assertions satisfied. This is a static test, not execution against PostgreSQL.

- [ ] **Step 7: Commit the migration and tests**

```powershell
git add -- test/supabase-schema.test.js supabase/migrations/20261117020000_create_sabibody_account_data.sql
git commit -m "fix: make SabiBody database migration repeatable"
```

## Task 2: Document safe application and verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- The documented setup path names the exact migration file and does not imply the migration was applied to the live project.
- Operators can tell how to proceed when Supabase CLI reports the migration as already applied.

- [ ] **Step 1: Update the database setup instructions**

In the Accounts and workout history section, document the three user-owned tables, the private empty `admin_users` table, profile triggers, RLS, and the summary RPC. State that the repository migration is only a local SQL file until the project owner applies it.

Tell the project owner to review and run the complete script in Supabase SQL Editor, then inspect table columns/constraints, triggers, grants, and policies. Explain that if CLI migration history already marks this file applied, editing the file does not make the CLI rerun it; use SQL Editor for this repeatable script. State that no admin is seeded and only a trusted project owner may assign one through SQL Editor.

- [ ] **Step 2: Review the documentation diff**

Run: `git diff --check -- README.md`

Expected: exit code 0 with no whitespace errors. Check that the README does not claim tables or policies were created in the remote project.

- [ ] **Step 3: Commit only the Supabase account documentation**

```powershell
git diff -- README.md
# Stage only the unified-diff hunk containing the Supabase Accounts/database setup.
# Do not stage unrelated exercise, camera, or other pre-existing README hunks.
git diff --cached -- README.md
git commit -m "docs: explain SabiBody database setup"
```

The current checkout already has unrelated README edits. Do not use `git add -- README.md` for the whole file. Build a temporary patch containing only the account/database hunk and apply it with `git apply --cached`; verify the staged README diff is limited to that section. If the intended documentation cannot be staged without unrelated content, leave it unstaged and report the blocker rather than committing mixed changes. Remove any temporary patch file after staging.

## Task 3: Run repository verification and report live limitations

**Files:**
- Verify: `test/supabase-schema.test.js`
- Verify: `supabase/migrations/20261117020000_create_sabibody_account_data.sql`
- Verify: `README.md`

**Interfaces:**
- No application query or workout behavior changes are expected. If verification finds a mismatch, change only the directly related service/test and update this plan’s implementation report.

- [ ] **Step 1: Run the complete Node test suite**

Run: `npm test`

Expected: all tests pass, including the updated Supabase schema tests.

- [ ] **Step 2: Build the Vite application**

Run: `npm run build`

Expected: exit code 0. Existing unrelated bundle-size warnings, if emitted, are reported rather than silently treated as failures.

- [ ] **Step 3: Check whitespace and working-tree scope**

Run: `git diff --check`

Expected: exit code 0. Review `git status --short` and leave unrelated pre-existing changes untouched.

- [ ] **Step 4: Report the deployment boundary**

Report the exact migration path and that the live Supabase schema, migration history, and cross-user RLS behavior remain unverified. Instruct the project owner to apply the SQL in Supabase SQL Editor and test access with two authenticated accounts. Do not say tables were created until that external step is confirmed.
