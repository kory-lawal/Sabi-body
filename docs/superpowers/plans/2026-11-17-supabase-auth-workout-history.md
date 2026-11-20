# Supabase Authentication and Workout History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require Sabi Body users to sign in with email/password and save completed workout summaries to per-user Supabase history.

**Architecture:** The Vite browser app uses the Supabase JavaScript client with a public project URL/key, while PostgreSQL RLS enforces ownership of workout rows. A small auth service and workout-history service isolate Supabase calls from the existing UI; the existing Python speech API and browser-side camera/pose analysis remain unchanged.

**Tech Stack:** Vite 7, vanilla JavaScript ES modules, `@supabase/supabase-js`, PostgreSQL SQL migration, Node.js built-in test runner.

**Spec:** [docs/superpowers/specs/2026-11-17-supabase-auth-workout-history-design.md](../specs/2026-11-17-supabase-auth-workout-history-design.md)

## Global Constraints

- Require an authenticated Supabase session before rendering workout controls.
- Use `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; never expose or commit a service-role key.
- Enforce per-user reads and inserts with RLS policies using `auth.uid() = user_id`.
- Store only workout summaries; do not upload camera frames, pose landmarks, or microphone audio.
- Leave camera pose analysis and the existing Python speech API unchanged.
- Keep workout completion available in memory if a history insert fails, and make the failed save visible.
- Use mocked Supabase calls in automated tests; a live Supabase round trip requires separately configured project credentials.
- This checkout already contains unrelated user changes. Stage and commit only files listed for the Supabase task; do not revert or stage unrelated work.

---

## File Structure

- `src/services/supabase-client.js` — validate Vite configuration and construct a Supabase client.
- `src/services/supabase-auth.js` — wrap session lookup, auth-state subscription, sign-up, sign-in, and sign-out.
- `src/services/workout-history.js` — map completed workout objects to/from the `workout_history` table.
- `src/ui/auth.js` — render the sign-in/sign-up screen and its loading, confirmation, and error states.
- `src/ui/app.js` — gate existing screens on authentication, load/display account history, handle sign-out, and save completion records.
- `src/main.js` — initialize the configured Supabase client and pass its services to `mountApp`.
- `src/styles.css` — style the auth screen and persistent history date/status details using existing design tokens.
- `supabase/migrations/20261117010000_create_workout_history.sql` — create the per-user table and RLS policies.
- `test/supabase-client.test.js`, `test/supabase-auth.test.js`, `test/workout-history.test.js` — unit tests for isolated Supabase services.
- `test/app.test.js` — app-level tests for auth gating, auth form actions, persistent history, and completion behavior.
- `test/auth-ui.test.js` — accessible auth-screen markup and state tests.
- `.env.example` — placeholder local Supabase URL/key variables; `.gitignore` already excludes `.env`.
- `README.md` — setup, redirect/confirmation, deployment environment, and privacy instructions.
- `package.json`, `package-lock.json` — Supabase SDK dependency.

### Task 1: Add Supabase client, history service, and RLS schema

**Files:**
- Create: `src/services/supabase-client.js`
- Create: `src/services/workout-history.js`
- Create: `test/supabase-client.test.js`
- Create: `test/workout-history.test.js`
- Create: `supabase/migrations/20261117010000_create_workout_history.sql`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`

**Interfaces:**
- `createSupabaseClient({ url, anonKey, createClient })` returns the client created by `createClient(url, anonKey)` and throws a descriptive configuration error if either credential is missing.
- `createWorkoutHistoryService(client)` returns:
  - `listWorkoutHistory()` -> `Promise<WorkoutRecord[]>`, newest first.
  - `saveWorkout(workout)` -> `Promise<WorkoutRecord>`.
- A `WorkoutRecord` exposed to the UI has `id`, `exerciseId`, `exerciseName`, `target`, `unit`, `achieved`, and ISO-string `completedAt`. `unit` is `reps` or `seconds`. The service does not accept a client-supplied `user_id`; PostgreSQL supplies it from `auth.uid()`.

- [ ] **Step 1: Write failing client configuration tests**

Test that the client factory receives the configured URL and public key, and that missing URL or key produces an explicit error. Inject a small `createClient` spy so the test does not need network access:

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
assert.deepEqual(calls, [['https://project.supabase.co', 'public-test-key']]);
```

- [ ] **Step 2: Run the focused client test and confirm it fails**

Run: `node --test test/supabase-client.test.js`
Expected: FAIL because the client module does not exist yet.

- [ ] **Step 3: Add the SDK and client factory**

Run: `npm install @supabase/supabase-js`

Implement `src/services/supabase-client.js`. Read default values from `import.meta.env?.VITE_SUPABASE_URL` and `import.meta.env?.VITE_SUPABASE_ANON_KEY`; allow explicit values and the client factory to be injected for tests. Do not silently substitute credentials or create a Supabase client with empty strings.

- [ ] **Step 4: Run client configuration tests**

Run: `node --test test/supabase-client.test.js`
Expected: PASS for valid configuration and both missing-value cases.

- [ ] **Step 5: Write failing workout-history service tests**

Use a fake Supabase query builder to verify that list requests select only summary columns, sort by `completed_at` descending, and map snake_case fields to the documented `WorkoutRecord`. Verify that saving maps the workout fields, returns the inserted row, and propagates database errors. Include a check that no caller-provided `user_id` is sent.

Use an injected query builder with this expected shape:

```js
const query = {
  select(columns) { calls.push(['select', columns]); return this; },
  order(column, options) { calls.push(['order', column, options]); return Promise.resolve({ data: rows, error: null }); },
  insert(values) { calls.push(['insert', values]); return this; },
  single() { return Promise.resolve({ data: insertedRow, error: null }); },
};
```

- [ ] **Step 6: Run the focused history test and confirm it fails**

Run: `node --test test/workout-history.test.js`
Expected: FAIL because the history service does not exist yet.

- [ ] **Step 7: Implement the history service and SQL migration**

Implement the two service methods and create `workout_history` with:

```sql
create table public.workout_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id text not null,
  exercise_name text not null,
  target integer not null check (target > 0),
  unit text not null check (unit in ('reps', 'seconds')),
  achieved integer not null check (achieved >= 0),
  completed_at timestamptz not null default now()
);

alter table public.workout_history enable row level security;

create policy "Users can read their own workout history"
  on public.workout_history for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own workout history"
  on public.workout_history for insert to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert on public.workout_history to authenticated;
revoke all on public.workout_history from anon;
```

The service must propagate Supabase errors instead of returning empty history or a success-shaped fallback. Map the existing numeric `completedAt` milliseconds to an ISO timestamp when inserting.

- [ ] **Step 8: Add placeholder environment values**

Append these placeholders to `.env.example` without adding or reading real values:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

- [ ] **Step 9: Run the focused service tests**

Run: `node --test test/supabase-client.test.js test/workout-history.test.js`
Expected: PASS; no request is made to a live Supabase project.

- [ ] **Step 10: Commit only Task 1 files**

```powershell
git add -- package.json package-lock.json .env.example src/services/supabase-client.js src/services/workout-history.js test/supabase-client.test.js test/workout-history.test.js supabase/migrations/20261117010000_create_workout_history.sql
git commit -m "feat: add Supabase workout history storage" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Add email/password auth and protect the app

**Files:**
- Create: `src/services/supabase-auth.js`
- Create: `src/ui/auth.js`
- Create: `test/supabase-auth.test.js`
- Create: `test/auth-ui.test.js`
- Modify: `src/main.js`
- Modify: `src/ui/app.js`
- Modify: `test/app.test.js`

**Interfaces:**
- `createSupabaseAuthService(client)` returns:
  - `getSession()` -> `Promise<Session | null>`.
  - `subscribe(callback)` -> unsubscribe function; callback receives `Session | null`.
  - `signUp(email, password)` -> `Promise<{ confirmationRequired: boolean }>`; provider errors reject.
  - `signIn(email, password)` -> `Promise<void>`; provider errors reject.
  - `signOut()` -> `Promise<void>`; provider errors reject.
- `renderAuthScreen({ mode, pending, message, error })` returns an HTML string with labeled email/password fields, a submit button, mode switch, and an accessible status/error region.
- `mountApp(root, { authService, workoutHistoryService, ...existingOptions })` keeps the workout UI hidden until `authService.getSession()` resolves with a session. A failed session lookup remains locked and shows an error. Subscribe before resolving the initial session and ignore a stale initial result if a newer auth event has already arrived.

- [ ] **Step 1: Write failing auth service tests**

Test successful session lookup, auth-state subscription/unsubscription, sign-up confirmation result, sign-in, and sign-out. For each Supabase error response, assert the public service rejects with that error rather than suppressing it.

- [ ] **Step 2: Run the focused auth service test and confirm it fails**

Run: `node --test test/supabase-auth.test.js`
Expected: FAIL because the auth service does not exist yet.

- [ ] **Step 3: Implement the auth service**

Wrap Supabase v2 auth methods. For each `{ data, error }` result, throw `error` when non-null. Return the initial session from `getSession`; return an unsubscribe function from `onAuthStateChange`; derive `confirmationRequired` from the sign-up response's session being null.

Use the provider methods directly and preserve error identity:

```js
async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function signOut() {
  const { error } = await client.auth.signOut();
  if (error) throw error;
}
```

`signUp` calls `client.auth.signUp({ email, password })`, throws a returned error, and returns `{ confirmationRequired: data.session === null }`. `getSession` returns `data.session ?? null`; `subscribe` adapts `onAuthStateChange((_event, session) => callback(session))` and returns `data.subscription.unsubscribe()`.

- [ ] **Step 4: Run the focused auth service tests**

Run: `node --test test/supabase-auth.test.js`
Expected: PASS, including error propagation and subscription cleanup.

- [ ] **Step 5: Write failing auth-screen tests**

Verify sign-in and sign-up modes have labels associated with email/password inputs, use password input semantics, show a pending state, and render errors/messages through an accessible live status region. Assert inserted user text is HTML-escaped.

- [ ] **Step 6: Run the auth-screen test and confirm it fails**

Run: `node --test test/auth-ui.test.js`
Expected: FAIL because the auth view does not exist yet.

- [ ] **Step 7: Implement the auth screen view**

Add a pure `renderAuthScreen` helper. Use `data-action` values for `auth-submit` and `auth-toggle-mode`, keep signup/sign-in copy explicit, and do not render any workout selection/camera markup in the auth state.

The form contract is:

```html
<form data-auth-form>
  <label for="auth-email">Email</label>
  <input id="auth-email" name="email" type="email" autocomplete="email" required>
  <label for="auth-password">Password</label>
  <input id="auth-password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit" data-action="auth-submit">Sign in</button>
  <button type="button" data-action="auth-toggle-mode">Create an account</button>
  <p role="status" aria-live="polite"></p>
</form>
```

Set password autocomplete to `new-password` in sign-up mode; escape all interpolated message/email text before placing it in `innerHTML`.

- [ ] **Step 8: Add auth-gating tests to the app test helper**

Update the `mountApp` helper in `test/app.test.js` to inject a deterministic fake auth service for existing workout UI tests. Add focused tests proving (a) initial loading and a null session render no workout controls, (b) a valid session unlocks the existing home screen, (c) sign-in/sign-up submit delegates the entered credentials, (d) a rejected session lookup stays locked and reports the error, and (e) auth-state sign-out returns to the auth screen.

- [ ] **Step 9: Run auth UI and app-gating tests and confirm the new app tests fail**

Run: `node --test test/auth-ui.test.js test/supabase-auth.test.js test/app.test.js`
Expected: new app-gating tests FAIL until `mountApp` is connected to the auth service; existing injected-auth workout tests remain runnable.

- [ ] **Step 10: Connect auth state to app startup**

In `src/main.js`, construct the configured client, create auth/history services, and pass them to `mountApp`. Display a clear configuration error if Supabase URL/key are absent; never fall back to an unauthenticated app.

In `src/ui/app.js`, maintain auth loading/authenticated/error state, restore the session before rendering the existing screens, and subscribe to auth changes. Handle delegated form submission and mode switching without changing workout controller behavior. Keep the existing app view completely gated until a session exists.

The session race rule is: register the auth listener before requesting the initial session; if a listener event arrives first, do not overwrite that newer state when `getSession()` resolves. Use the existing delegated listeners and handle `<form data-auth-form>` submit with `preventDefault()` before reading its named email/password fields.

- [ ] **Step 11: Run the focused auth/app tests**

Run: `node --test test/auth-ui.test.js test/supabase-auth.test.js test/app.test.js`
Expected: PASS for auth behavior and existing workout flows with injected fake auth.

- [ ] **Step 12: Commit only Task 2 files**

```powershell
git add -- src/services/supabase-auth.js src/ui/auth.js test/supabase-auth.test.js test/auth-ui.test.js src/main.js src/ui/app.js test/app.test.js
git commit -m "feat: require Supabase email authentication" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Persist completed workouts and display account history

**Files:**
- Modify: `src/ui/app.js`
- Modify: `src/services/workout-history.js`
- Modify: `test/app.test.js`
- Modify: `test/workout-history.test.js`
- Modify: `src/styles.css`

**Interfaces:**
- Add `onWorkoutCompleted(workout)` to `createWorkoutController` options. It is called once with the already-created completion object, after the in-memory completion state is updated.
- The app invokes `workoutHistoryService.saveWorkout(workout)` without blocking completion. On success it adds the returned record to the account history; on failure it retains the current workout and shows a visible save error.
- The account history loader calls `workoutHistoryService.listWorkoutHistory()` after authentication. The list is ordered newest first by the service/query. A load failure leaves the account signed in and shows an explicit history-load error.

- [ ] **Step 1: Add failing history integration tests**

With injected fake services, verify successful authentication loads the user's history, the home page shows records and completion date/time, a new completed workout is saved exactly once, and a failed save leaves the completion screen/result visible while exposing an error. Also verify a failed history read is visible without unlocking an unauthenticated screen or discarding a valid session.

- [ ] **Step 2: Run the focused history integration tests and confirm they fail**

Run: `node --test test/app.test.js`
Expected: the new persistence/history tests FAIL because app state is not connected to the history service.

- [ ] **Step 3: Add the completion callback without blocking workout completion**

In `createWorkoutController`, add an `onWorkoutCompleted` option defaulting to a no-op. Call it once from the guarded completion path after `update()` has stored the result. Keep the controller independent of Supabase and do not await the callback:

```js
onWorkoutCompleted(completedWorkout);
```

Wrap a synchronous callback throw so it cannot interrupt completion cleanup. The app-provided callback handles its own rejected promise.

- [ ] **Step 4: Load authenticated history and persist completion records**

In `mountApp`, load history after the auth session is established. Keep `accountHistory` separate from transient `completedWorkouts`; render the loaded account records in the existing home summary. Supply this callback when creating the workout controller:

```js
onWorkoutCompleted: (workout) => {
  void workoutHistoryService.saveWorkout(workout)
    .then((record) => {
      accountHistory = [record, ...accountHistory];
      historySaveError = '';
      const status = root.querySelector('[data-history-save-error]');
      if (status) {
        status.textContent = '';
        status.hidden = true;
      }
    })
    .catch((error) => {
      historySaveError = `Workout completed, but history could not be saved: ${error.message}`;
      const status = root.querySelector('[data-history-save-error]');
      if (status) {
        status.textContent = historySaveError;
        status.hidden = false;
      }
    });
}
```

Use `textContent` for asynchronous error updates. Include the save-error status placeholder in both the home and completion views so failure is visible without replacing the completion screen. On the next full screen render, populate the placeholder from `historySaveError`. If history loading fails, keep the user authenticated and show an accessible load error rather than rendering an empty history as though the request succeeded.

- [ ] **Step 5: Show account identity and sign-out**

Add the signed-in email and a sign-out control to the authenticated app header. A successful sign-out clears account history from UI state before rendering the auth screen; a failed sign-out remains visible and does not falsely claim success.

- [ ] **Step 6: Update history markup and styles**

Change the session-only label to persistent account history, include a readable localized date/time using `completedAt`, preserve escaping of user-visible strings, add a `role="status"` placeholder with `data-history-save-error` to the home and completion views, and add responsive styles for auth controls, account/sign-out controls, and history status/errors using existing color/spacing conventions.

- [ ] **Step 7: Run focused history and completion tests**

Run: `node --test test/app.test.js test/workout-history.test.js`
Expected: PASS for auth-scoped load, newest-first records, one save per completion, visible save/load failures, and sign-out clearing private UI state.

- [ ] **Step 8: Commit only Task 3 files**

```powershell
git add -- src/ui/app.js src/services/workout-history.js test/app.test.js test/workout-history.test.js src/styles.css
git commit -m "feat: persist and display workout history" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Document Supabase setup, privacy, and verify the full app

**Files:**
- Modify: `README.md`
- Modify: `src/ui/app.js` (only if verification exposes a directly related defect)
- Modify: related Supabase tests (only if verification exposes a directly related defect)

- [ ] **Step 1: Update setup and privacy documentation**

Document `npm install`, copying `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell), supplying the Supabase project URL/public key, applying the migration in Supabase SQL Editor, enabling email/password auth, choosing email confirmation behavior, and configuring local/Vercel redirect URLs and Vite environment variables. Explicitly state that `VITE_SUPABASE_ANON_KEY` is public and the service-role key must never be placed in frontend environment variables. Replace the README claim that the app has no account/history storage; clarify that only completed workout summaries are stored per account and camera/pose/audio data remain local/not uploaded.

- [ ] **Step 2: Run the full automated suite**

Run: `npm test`
Expected: PASS across the existing and new tests; no test makes a network request.

- [ ] **Step 3: Build the production bundle**

Run: `npm run build`
Expected: Vite completes successfully. Only the configured project URL and public anon key may be exposed to the browser; no service-role key may use a `VITE_` variable or appear in application code.

- [ ] **Step 4: Review only the Supabase task diff**

Run: `git diff --check` and `git status --short`.
Expected: no whitespace errors; existing user changes remain untouched and unstaged.

- [ ] **Step 5: Commit only the documentation/verification changes**

```powershell
git add -- README.md
git commit -m "docs: explain Supabase setup and privacy" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 6: Perform the credentialed manual smoke test when configured**

After the user supplies local/deployment environment values and applies the SQL migration: sign up with a test email, confirm the email if enabled, sign in, complete one short workout, reload and verify the record remains in history, sign out, then verify workout controls are inaccessible until sign-in. Also attempt to read that row from a different test account and verify RLS prevents access. Do not ask for or commit credentials.
