# SabiBody Accounts and Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional Supabase accounts, secure personal workout history, a responsive account dashboard/profile/settings experience, and persistent reminder preferences without blocking guest workouts.

**Architecture:** Keep the existing Vite app, camera controller, analyzers, and coaching intact. Add a browser Supabase client and focused auth/profile/workout/reminder services; PostgreSQL RLS is the security boundary. Guests retain Home and workouts, while signed-in users gain database-backed account screens.

**Tech Stack:** Vite 7, vanilla JavaScript ES modules, `@supabase/supabase-js`, PostgreSQL migrations, Node.js built-in test runner.

**Spec:** [docs/superpowers/specs/2026-11-17-sabibody-account-and-reminders-design.md](../specs/2026-11-17-sabibody-account-and-reminders-design.md)

## Global Constraints

- Home and workouts remain available to guests, including when Supabase configuration is absent.
- Supabase Auth owns passwords and persistent sessions; never store passwords manually.
- Use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in browser configuration; never expose or commit a service-role key.
- PostgreSQL RLS must enforce per-user ownership (`profiles.id = auth.uid()`; `user_id = auth.uid()` on workout/reminder tables); frontend route guards are not a security boundary.
- Do not upload camera frames, pose landmarks, or microphone audio.
- Workout completion and camera cleanup must not wait for Supabase; visible save errors must not discard workout results.
- Save interrupted attempts as `completed=false`; never represent manual exits or camera failures as completed.
- Use mocked Supabase calls in unit tests. Live Auth, RLS isolation, and email delivery require external configuration and must not be claimed as tested without it.
- Preserve all pre-existing worktree changes and stage only files belonging to this plan.

---

## File Structure

- `src/services/supabase-client.js` — detect public configuration and construct the SDK client.
- `src/services/supabase-auth.js` — session lookup/subscription, signup, login/logout, password reset/update.
- `src/services/profile.js` — read and update the signed-in user's profile.
- `src/services/workout-history.js` — list and idempotently save workout-session records.
- `src/services/workout-summary.js` — load all-time aggregates through an RLS-respecting SQL function.
- `src/services/reminder-preferences.js` — read and persist the signed-in user's reminder settings.
- `src/ui/auth.js` — accessible sign-in, signup, reset, and password-update markup.
- `src/ui/account.js` — render dashboard, weekly history, profile, and settings views from supplied real data.
- `src/ui/app.js` — integrate account navigation/auth state and workout-attempt callbacks without changing analyzer behavior.
- `src/main.js` — initialize optional Supabase services and mount the existing app.
- `src/styles.css` — responsive account/auth styles using existing brand tokens.
- `supabase/migrations/20261117020000_create_sabibody_account_data.sql` — profiles, workout sessions, reminder preferences, triggers, constraints, indexes, grants, and RLS.
- `test/supabase-client.test.js`, `test/supabase-auth.test.js`, `test/profile.test.js`, `test/workout-history.test.js`, `test/workout-summary.test.js`, `test/reminder-preferences.test.js`, `test/supabase-schema.test.js` — isolated service and schema tests.
- `test/auth-ui.test.js`, `test/account-ui.test.js` — accessible UI and real-data rendering tests.
- `test/app.test.js` — app integration tests for guest behavior, auth lifecycle, persistence, and account navigation.
- `.env.example` — placeholder-only public Supabase configuration.
- `README.md` — setup, Auth redirect, migration, privacy, and external reminder prerequisites.
- `package.json`, `package-lock.json` — Supabase SDK dependency.

### Task 1: Add the optional Supabase client

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Create: `src/services/supabase-client.js`
- Create: `test/supabase-client.test.js`
- Modify: `src/main.js`

**Interfaces:**
- `hasSupabaseConfig({ url, anonKey })` returns `true` only when both public settings are non-empty.
- `createSupabaseClient({ url, anonKey, createClient })` returns the SDK client configured with persistent sessions and token refresh, or throws a descriptive configuration error.
- `main.js` creates account services only when both public settings exist; otherwise it mounts guest workouts with account features marked unavailable.

- [ ] **Step 1: Write client factory tests**

Test that the injected factory receives the exact configured URL and key, that the returned client is preserved, and that missing URL or key produces an explicit error:

```js
const calls = [];
const client = { auth: {} };
const result = createSupabaseClient({
  url: 'https://project.supabase.co',
  anonKey: 'public-test-key',
  createClient: (...args) => {
    calls.push(args);
    return client;
  },
});
assert.equal(result, client);
assert.deepEqual(calls, [[
  'https://project.supabase.co',
  'public-test-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
]]);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test test/supabase-client.test.js`

Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Add the SDK and client module**

Run: `npm install @supabase/supabase-js`

Implement `hasSupabaseConfig` and `createSupabaseClient`. Read Vite's `import.meta.env?.VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only in the browser integration. Configure `persistSession: true`, `autoRefreshToken: true`, and `detectSessionInUrl: true`. The factory throws when called without both values; it never substitutes empty or fake credentials.

- [ ] **Step 4: Keep guest startup independent from credentials**

In `src/main.js`, check both values before constructing the client. Pass `null` account services when absent and pass a clear account-configuration status to `mountApp`. Do not block or replace the Home/workout UI.

- [ ] **Step 5: Add placeholder-only environment values**

Append to `.env.example`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

Do not read, print, or commit `.env` values.

- [ ] **Step 6: Run client tests and build**

Run: `node --test test/supabase-client.test.js`

Expected: PASS for configured and missing-value cases.

Run: `npm run build`

Expected: PASS with no service-role value in the browser bundle.

### Task 2: Create the RLS schema and focused data services

**Files:**
- Create: `supabase/migrations/20261117020000_create_sabibody_account_data.sql`
- Create: `src/services/profile.js`
- Create: `src/services/workout-history.js`
- Create: `src/services/workout-summary.js`
- Create: `src/services/reminder-preferences.js`
- Create: `test/supabase-schema.test.js`
- Create: `test/profile.test.js`
- Create: `test/workout-history.test.js`
- Create: `test/workout-summary.test.js`
- Create: `test/reminder-preferences.test.js`

**Interfaces:**
- `createProfileService(client)` returns `getProfile()` and `updateFullName(fullName)`.
- `createWorkoutHistoryService(client)` returns `listSessions({ from, to })` and `saveSession(session)`.
- `createWorkoutSummaryService(client)` returns `getSummary()` with all-time totals for completed sessions.
- `createReminderPreferencesService(client)` returns `getPreferences()` and `savePreferences(preferences)`.
- Data services never accept or send a client-selected `user_id`; PostgreSQL supplies `auth.uid()`.
- All service errors reject and are surfaced by app/UI callers.

- [ ] **Step 1: Write a schema structure test**

Create `test/supabase-schema.test.js` to read the migration and assert it declares exactly the required user tables, enables RLS on each, checks `profiles.id = auth.uid()` and `user_id = auth.uid()` on the matching table policies, creates indexes for user/date and user/completion queries, and contains no service-role secret. The test documents the static guarantee only; it is not a substitute for live RLS testing.

- [ ] **Step 2: Write mocked profile, workout, and reminder service tests**

Use injected Supabase query-builder fakes. Verify profile reads/updates target only the authenticated row, workout reads filter by a bounded date range and order by start time, saves omit `user_id` and upsert on the unique session key, summary calls have no user-supplied ID, reminder preferences upsert without caller ownership fields, and each service propagates provider errors.

- [ ] **Step 3: Run the focused tests and confirm they fail**

Run: `node --test test/supabase-schema.test.js test/profile.test.js test/workout-history.test.js test/workout-summary.test.js test/reminder-preferences.test.js`

Expected: FAIL because the migration and services do not exist.

- [ ] **Step 4: Create the profiles table and triggers**

Create `profiles` with `id uuid primary key references auth.users(id) on delete cascade`, `full_name`, `email`, `created_at`, and `updated_at`. Add a narrowly scoped `SECURITY DEFINER` signup trigger function with a fixed `search_path` that inserts the metadata full name and auth email. Add an auth email-update trigger and a timestamp trigger. Enable RLS; policies must use and check `id = auth.uid()` for the authenticated user's own row. Grant users `SELECT` and only column-level `UPDATE (full_name)` so email remains owned by Supabase Auth.

- [ ] **Step 5: Create workout_sessions**

Create `workout_sessions` with UUID ID; `user_id` referencing `auth.users`; exercise name/type; nullable `completed_reps` and `target_reps`; nullable `target_duration_seconds` for repetition workouts; nonnegative integer `duration_seconds`; `completed`; `started_at`; `ended_at`; nullable `completed_at`; `created_at`; and `client_session_id uuid not null`. Repetition fields are required for `exercise_type='reps'`; timed Planks use `exercise_type='duration'`, null repetition fields, and a positive `target_duration_seconds`. `ended_at` is set for every saved attempt; `completed_at` is set only when the target is reached. Constrain quantities to nonnegative values and make the duration/repetition fields mutually consistent with `exercise_type`. Add `unique (user_id, client_session_id)` and indexes on `(user_id, started_at desc)` and `(user_id, completed, started_at desc)`. Enable RLS and create owner-only select/insert/update/delete policies using and checking `auth.uid() = user_id`.

- [ ] **Step 6: Create the RLS-respecting dashboard totals function**

Add a SQL function `public.get_workout_summary()` returning `total_workouts bigint`, `total_reps bigint`, and `total_duration_seconds bigint`. Declare it `LANGUAGE sql STABLE SECURITY INVOKER`, set a fixed `search_path`, accept no user ID argument, filter `user_id = auth.uid()` and `completed = true`, and use `coalesce` so an account with no completed workouts receives zero totals. Grant execution only to `authenticated`. Extend the schema test to verify the function uses the caller's `auth.uid()` and is not `SECURITY DEFINER`.

- [ ] **Step 7: Create reminder_preferences**

Create one row per user with an ID, foreign-key user ID, `email_reminders_enabled`, independent morning/evening booleans, morning/evening local `time` values, IANA timezone text, and created/updated timestamps. Set reminders off by default, morning/evening times to `07:00` and `19:00`, and timezone from the account UI. Add a unique `user_id`, timestamp trigger, owner-only select/insert/update/delete policies, and authenticated grants.

- [ ] **Step 8: Implement the data services**

Map database snake_case rows to stable UI objects. `saveSession` upserts with `onConflict: 'user_id,client_session_id'` and selects the stored row. `listSessions({ from, to })` applies a half-open start-time range (`gte from`, `lt to`) and orders newest first. `getSummary()` calls `rpc('get_workout_summary')` without arguments. Profile update modifies only `full_name`; email changes remain an Auth operation. Preference upsert uses the unique user row and omits `user_id`.

- [ ] **Step 9: Run focused schema and service tests**

Run: `node --test test/supabase-schema.test.js test/profile.test.js test/workout-history.test.js test/workout-summary.test.js test/reminder-preferences.test.js`

Expected: PASS with mocked services. A live cross-user RLS test remains pending until project configuration is supplied.

### Task 3: Add auth operations and accessible auth views

**Files:**
- Create: `src/services/supabase-auth.js`
- Create: `src/ui/auth.js`
- Create: `test/supabase-auth.test.js`
- Create: `test/auth-ui.test.js`
- Modify: `src/styles.css`

**Interfaces:**
- `createSupabaseAuthService(client)` returns `getSession()`, `subscribe(callback)`, `signUp({ fullName, email, password })`, `signIn(email, password)`, `signOut()`, `requestPasswordReset(email, redirectTo)`, and `updatePassword(password)`.
- `renderAuthScreen({ mode, pending, message, error, configurationError })` returns accessible markup and escapes interpolated text.

- [ ] **Step 1: Write auth service tests**

Test session lookup, auth-state callback and unsubscribe, signup metadata and confirmation-required result, password login, logout, reset email, password update, and error identity propagation.

- [ ] **Step 2: Run the focused auth service test and confirm it fails**

Run: `node --test test/supabase-auth.test.js`

Expected: FAIL because the auth service does not exist.

- [ ] **Step 3: Implement the Auth service**

Wrap Supabase v2 Auth methods. For every `{ data, error }` result, throw a non-null `error`. Signup calls:

```js
client.auth.signUp({
  email,
  password,
  options: { data: { full_name: fullName } },
});
```

Return `confirmationRequired: data.session === null`. Use `onAuthStateChange` and return its subscription's `unsubscribe` function. The client factory explicitly enables `persistSession`, `autoRefreshToken`, and `detectSessionInUrl`.

- [ ] **Step 4: Write auth view tests**

Verify sign-in, signup, forgot-password, and password-update modes have associated labels, correct autocomplete values, required input semantics, password confirmation, pending submit state, and accessible live status/error regions. Verify rendered error/message strings are escaped.

- [ ] **Step 5: Run the UI test and confirm it fails**

Run: `node --test test/auth-ui.test.js`

Expected: FAIL because the auth view does not exist.

- [ ] **Step 6: Implement accessible auth views**

Add forms with full name/email/password/confirm password in signup mode, email/password in login mode, a reset-email mode, and a new-password mode. Use client-side required/email/password-confirmation checks and require at least eight characters; document that project settings may enforce a stronger minimum. Do not store or log passwords. Render email confirmation and reset-success messages without claiming that the user is authenticated until a session exists.

- [ ] **Step 7: Style auth views and run the focused tests**

Use existing CSS variables and responsive form patterns. Run:

```powershell
node --test test/supabase-auth.test.js test/auth-ui.test.js
```

Expected: PASS.

### Task 4: Integrate optional session state and protect account views

**Files:**
- Modify: `src/main.js`
- Modify: `src/ui/app.js`
- Create: `src/ui/account.js`
- Create: `test/account-ui.test.js`
- Modify: `test/app.test.js`
- Modify: `src/styles.css`

**Interfaces:**
- Extend `mountApp(root, { authService, profileService, workoutHistoryService, reminderPreferencesService, accountConfigurationError, ...existingOptions })`.
- `authService === null` leaves the guest Home/workout flow available and displays an explicit unavailable message only on account entry.
- `renderAccountPage({ page, profile, sessions, summary, preferences, errors })` returns escaped, accessible account markup.

- [ ] **Step 1: Inject a fake optional auth service into existing app tests**

Update the existing app test helper to default to an explicit guest/no-auth configuration so pre-existing workout tests continue to exercise the existing home and workout behavior.

- [ ] **Step 2: Add failing account-gating tests**

Verify guest users can choose and start workouts, account-page entry without a session renders login rather than private data, an initial loading session does not expose private rows, a valid restored session enables account views, and an auth-state logout immediately clears private UI state.

- [ ] **Step 3: Run app tests and confirm the new account tests fail**

Run: `node --test test/app.test.js`

Expected: new account-gating tests fail; existing guest workout tests remain runnable.

- [ ] **Step 4: Subscribe before restoring the initial session**

In `mountApp`, subscribe to auth changes before calling `getSession()`. Track whether a newer auth event has arrived and ignore a stale initial session result. Keep Home available while the asynchronous lookup runs. Keep account content locked until a valid session is known. A rejected `getSession()` shows an explicit account error without disabling guest workouts.

- [ ] **Step 5: Add delegated signup, login, reset, and logout actions**

Use the existing delegated event handling. Validate signup name, email, password, and confirmation before calling Auth. Route `PASSWORD_RECOVERY` events to the password-update form. Display confirmation-required states, provider errors, and successful logout accurately. If logout fails, preserve the current session and report the error.

- [ ] **Step 6: Add responsive account navigation and page rendering**

Create account page renderers for Dashboard, Workout History, Profile, and Settings. Home/Exercises remain usable without authentication. Account navigation is available only outside the camera workout screen; active workout rendering and camera elements remain owned by the current controller. Profile shows the authenticated email, permits full-name updates, supports password recovery/update, and includes logout.

- [ ] **Step 7: Run focused app/auth/account tests**

Run:

```powershell
node --test test/app.test.js test/account-ui.test.js test/auth-ui.test.js test/supabase-auth.test.js
```

Expected: PASS for guest availability, account protection, restoration, signup/login/reset delegation, and logout.

### Task 5: Persist workout attempts without blocking camera cleanup

**Files:**
- Modify: `src/ui/app.js`
- Modify: `src/services/workout-history.js`
- Modify: `test/app.test.js`
- Modify: `test/workout-history.test.js`

**Interfaces:**
- Add `onWorkoutAttemptEnded(session)` to `createWorkoutController` options; call exactly once with `{ clientSessionId, exerciseId, exerciseName, exerciseType, completedReps, targetReps, targetDurationSeconds, durationSeconds, completed, startedAt, endedAt, completedAt }`.
- `completedAt` is an ISO timestamp only for successful target completion; it is `null` for incomplete attempts.
- `endedAt` is an ISO timestamp for either successful or incomplete attempts; `durationSeconds` is tracked exercise time for Planks and elapsed attempt time for repetition exercises.
- `saveSession(session)` upserts by `(user_id, client_session_id)` and never receives `user_id` from the client.

- [ ] **Step 1: Add failing workout lifecycle tests**

Test that reaching the target emits one completed payload; manual End emits one incomplete payload; camera/start failure after Start emits an incomplete payload; a selected workout that never starts emits none; and duplicate completion frames/events do not invoke the callback twice. Include `endedAt`, Plank's `targetDurationSeconds` and tracked-duration mapping, and repetition exercises' elapsed-duration/target/achieved mapping.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `node --test test/app.test.js`

Expected: new lifecycle callback assertions fail because the controller does not yet expose the callback.

- [ ] **Step 3: Track one attempt key and start time per workout**

Generate one `crypto.randomUUID()` session key when Start begins and capture the ISO start time. Preserve it through pause/resume. Set `endedAt` when completion, explicit End, or terminal camera/start failure occurs. Clear attempt state on reset/reselection. Use the existing `completionHandled` guard and add an attempt-ended guard so one attempt is saved once.

- [ ] **Step 4: Emit successful and incomplete events at the existing lifecycle boundaries**

Emit `completed=true` only from the existing guarded target-completion path. Emit `completed=false` before state is cleared on explicit End and after a camera/start failure that ends the attempt. A temporarily disconnected camera that is still resumable remains paused and is not saved until it completes or is explicitly ended. A callback throw must not interrupt camera/resource cleanup.

- [ ] **Step 5: Save asynchronously for authenticated users only**

In the app callback, call `workoutHistoryService.saveSession(session)` only when an authenticated session exists. Do not await it from camera/controller code. On success, update account records; on failure, keep the workout result visible and show an accessible error. Guest workouts do not call the service.

- [ ] **Step 6: Verify service idempotence and error propagation**

Use a mocked query builder to assert one upsert payload omits `user_id`, specifies `onConflict: 'user_id,client_session_id'`, preserves incomplete state, maps time/repetition fields correctly, and rejects Supabase errors.

- [ ] **Step 7: Run focused lifecycle and persistence tests**

Run: `node --test test/app.test.js test/workout-history.test.js`

Expected: PASS for one save per attempt, true completion only at goal, incomplete exit/failure rows, guest behavior, and visible save failures.

### Task 6: Build real-data dashboard and weekly history

**Files:**
- Modify: `src/services/workout-history.js`
- Modify: `src/services/workout-summary.js`
- Modify: `src/ui/account.js`
- Modify: `src/ui/app.js`
- Modify: `test/workout-history.test.js`
- Modify: `test/workout-summary.test.js`
- Modify: `test/account-ui.test.js`
- Modify: `src/styles.css`

**Interfaces:**
- Workout history query accepts a start/end range and returns only the authenticated user's rows.
- `createWorkoutSummaryService(client).getSummary()` returns `{ totalWorkouts, totalReps, totalDurationSeconds }` for completed rows under RLS.
- Weekly activity and recent history are derived from returned database records; no sample records are rendered.

- [ ] **Step 1: Add failing dashboard aggregation tests**

Test that the totals service maps the RPC's returned completed-only totals, weekly date boundaries use the selected IANA timezone, weekly daily counts and recent sessions use database rows, and zero totals produce an empty state. Test an incomplete session appears with incomplete status in history but is excluded from completed-workout totals.

- [ ] **Step 2: Add failing weekly history tests**

Use actual-shaped fake database records to verify each day shows exercise, reps or duration, and status; previous/next week controls request the correct range; and database errors render an error rather than an empty success state.

- [ ] **Step 3: Query the selected week and recent rows**

Request a half-open weekly date range using the selected IANA timezone converted to UTC boundaries. Fetch recent rows in a separate bounded query and call the secure totals RPC for all-time totals. Propagate read errors and retain the signed-in session.

- [ ] **Step 4: Derive dashboard summaries from database rows**

Map the all-time totals RPC for completed workout count, repetition sum, and duration sum. Build seven daily completion counts from the bounded weekly query. Never add mock/default workout values.

- [ ] **Step 5: Render dashboard, chart, history, and empty states**

Add a simple accessible seven-day activity chart with text labels and values. Show recent history, weekly rows, complete/incomplete status, and previous-week navigation. Use selected timezone formatting and escaped exercise names. A genuinely empty response displays a friendly empty state and a clear Start Workout action.

- [ ] **Step 6: Run account and service tests**

Run:

```powershell
node --test test/workout-history.test.js test/workout-summary.test.js test/account-ui.test.js test/app.test.js
```

Expected: PASS for date boundaries, aggregation, actual-record rendering, empty/error states, and week navigation.

### Task 7: Persist reminder settings and document delivery prerequisites

**Files:**
- Modify: `src/ui/account.js`
- Modify: `src/ui/app.js`
- Modify: `src/services/reminder-preferences.js`
- Modify: `test/reminder-preferences.test.js`
- Modify: `test/account-ui.test.js`
- Modify: `src/styles.css`
- Modify: `README.md`

**Interfaces:**
- Settings render `emailRemindersEnabled`, `morningEnabled`, `morningTime`, `eveningEnabled`, `eveningTime`, and `timezone`.
- Browser timezone initializes to `Intl.DateTimeFormat().resolvedOptions().timeZone`; an explicit IANA timezone picker selection is persisted.
- Preference updates reject database errors and do not claim success until the Supabase write succeeds.

- [ ] **Step 1: Add failing preference form tests**

Test global off/on, morning-only, evening-only, both, neither, default times `07:00` and `19:00`, detected timezone, explicit timezone selection, save success, and visible save failure.

- [ ] **Step 2: Render the Workout Reminders settings**

Add a global email-reminder switch, independent morning/evening switches, time inputs, and a timezone selector using supported IANA zones. Disable slot-specific inputs when the global switch is off, but retain their selected values.

- [ ] **Step 3: Load and save preferences**

Load the signed-in user's row. If none exists, present unsaved defaults using the detected timezone and save on user action. Upsert only the current user's preference fields; show a success message only after the write succeeds and an explicit error when it fails.

- [ ] **Step 4: Document that delivery is not configured**

Update `README.md` to document Supabase environment setup, Auth email/redirect settings, applying the migration, and privacy boundaries. State plainly that preferences persist but reminder emails are not delivered until a verified email provider, server-side secret, scheduled server-side runtime, and secure project access are configured. Do not add a client-side email sender or fake scheduled process.

- [ ] **Step 5: Run focused reminder and account tests**

Run:

```powershell
node --test test/reminder-preferences.test.js test/account-ui.test.js test/app.test.js
```

Expected: PASS for preference persistence, independent switches, selected timezone, and visible errors.

### Task 8: Verify integration, responsive behavior, and documentation

**Files:**
- Modify: `README.md`
- Test: all existing and added tests.

**Interfaces:**
- Consumes: All account, data, UI, and settings services from Tasks 1–7.
- Produces: A passing local suite/build and a clear list of checks that still require external Supabase/email configuration.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all existing workout/camera/coaching tests and all new account tests pass without network access.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: Vite builds successfully. Inspect the generated bundle and confirm it contains no service-role key or private provider secret.

- [ ] **Step 3: Check whitespace and scoped worktree changes**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors. Do not stage or revert pre-existing changes.

- [ ] **Step 4: Perform browser and camera checks when a local app is available**

Verify guest Home and all seven workouts remain available, mobile/tablet/desktop account navigation reflows, account pages require a session, camera workout layout is independent of dashboard layout, and status/error/empty states are readable. On an available camera device, start each retained exercise and confirm camera tracking and voice coaching still operate; if no camera/device is available, report this check as unverified. Do not infer real Auth or RLS behavior from mocked tests.

- [ ] **Step 5: Perform live Supabase checks when configured**

With a configured local environment and applied migration, create a test account, verify email when enabled, sign in, complete and interrupt test workouts, refresh and reopen the browser to check session restoration, verify settings persist, then log out. Use a second controlled account to verify the first account's workout rows are not readable or writable. Never request that credentials be pasted into chat or put credentials in tests. Without project configuration, report signup, email verification, login, refresh/restart restoration, logout, and cross-account RLS as unverified. Without a verified email sender and scheduled server-side runtime, report reminder delivery as unavailable.

