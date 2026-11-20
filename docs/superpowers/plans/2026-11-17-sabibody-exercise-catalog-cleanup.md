# SabiBody Exercise Catalogue Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Mountain Climbers, Donkey Kicks, Bicycle Crunches, Standing Side Leg Raises, and Bird Dogs while retaining the original six exercises and High Knees.

**Architecture:** Keep the existing Vite app, exercise-card catalogue, workout controller, camera, and coaching system. Remove only the five unsupported exercise entries, analyzer registrations, feedback references, their dedicated assets/tests, and stale current documentation.

**Tech Stack:** Vite 7, vanilla JavaScript ES modules, Node.js built-in test runner.

**Spec:** [docs/superpowers/specs/2026-11-17-sabibody-account-and-reminders-design.md](../specs/2026-11-17-sabibody-account-and-reminders-design.md)

## Global Constraints

- Retain Squats, Jumping Jacks, Plank, Push-ups, Sit-ups, Lunges, and High Knees.
- Do not alter the original six analyzers' detection, counting, camera, or voice coaching behavior.
- Keep the High Knees analyzer and its existing behavior.
- Do not remove shared geometry, readiness, camera, tracking, or coaching code used by retained exercises.
- Preserve pre-existing worktree changes; delete only the five exercise-specific files and assets explicitly listed below.

---

### Task 1: Lock the supported exercise list in tests

**Files:**
- Modify: `test/exercise-content.test.js`
- Modify: `test/app.test.js`

**Interfaces:**
- Consumes: `EXERCISES` from `src/ui/exercise-content.js`.
- Produces: An exact seven-ID catalogue assertion and selection/start coverage for the supported IDs.

- [ ] **Step 1: Change the exercise-content expectation to the seven retained IDs**

Update the expected content map in `test/exercise-content.test.js` to include only:

```js
const expectedIds = [
  'squats',
  'jumping-jacks',
  'plank',
  'push-ups',
  'sit-ups',
  'lunges',
  'high-knees',
];
```

Keep the existing per-exercise image, instruction, target-muscle, and benefit checks for those seven.

- [ ] **Step 2: Add selection and start coverage**

Update the existing all-exercise workout-flow test in `test/app.test.js` to iterate over the seven retained IDs. Verify every ID can be selected and started through the existing camera/tracker test doubles. Add a negative assertion that `selectExercise('unsupported-exercise')` returns `false` and leaves the selected exercise unchanged; the exact seven-ID assertion ensures removed IDs cannot be registered.

- [ ] **Step 3: Run the focused tests and confirm the new assertions fail**

Run: `node --test test/exercise-content.test.js test/app.test.js`

Expected: FAIL because the catalogue still has twelve exercises and the removed IDs remain selectable.

### Task 2: Remove the five exercise registrations and dedicated implementation files

**Files:**
- Modify: `src/ui/exercise-content.js`
- Modify: `src/ui/app.js`
- Modify: `src/feedback/personality.js`
- Modify: `api/src/shared/coaching-messages.js`
- Delete: `src/exercises/mountain-climbers.js`
- Delete: `src/exercises/donkey-kicks.js`
- Delete: `src/exercises/bicycle-crunches.js`
- Delete: `src/exercises/standing-side-leg-raises.js`
- Delete: `src/exercises/bird-dogs.js`
- Delete: `test/mountain-climbers.test.js`
- Delete: `test/donkey-kicks.test.js`
- Delete: `test/bicycle-crunches.test.js`
- Delete: `test/standing-side-leg-raises.test.js`
- Delete: `test/bird-dogs.test.js`
- Delete: `Mountain Climbers.png`
- Delete: `Donkey Kicks.png`
- Delete: `Bicycle Crunches.png`
- Delete: `Standing Side Leg Raises.png`
- Delete: `Bird Dogs.png`

**Interfaces:**
- Consumes: The failing exact-catalogue and negative-selection tests from Task 1.
- Produces: Exactly seven selectable exercises with no import or runtime registration for the removed analyzers.

- [ ] **Step 1: Remove the five content objects**

Delete only the five matching entries from `EXERCISES` in `src/ui/exercise-content.js`. Keep High Knees immediately available as before.

- [ ] **Step 2: Remove analyzer imports, goals, and registration**

In `src/ui/app.js`, remove only the five analyzer imports, their `GOAL_PRESETS` and `DEFAULT_TARGETS` entries, and their entries in `createAnalyzers()`. Preserve the existing six and High Knees entries exactly.

- [ ] **Step 3: Remove exercise-only feedback references**

Remove feedback IDs used exclusively by the five deleted analyzers from the relevant exported phrase catalog in `api/src/shared/coaching-messages.js` and from the essential/quiet/friendly sets in `src/ui/app.js` and `src/feedback/personality.js`. Keep shared IDs such as `body-not-visible`, `return-to-start`, and all IDs used by the retained exercises.

- [ ] **Step 4: Delete only dedicated analyzers, tests, and images**

Delete the ten exercise-specific source/test files and five image files listed above. Do not delete `geometry.js`, `readiness.js`, shared camera/pose code, or any retained exercise assets.

- [ ] **Step 5: Run the exercise-content and controller tests**

Run: `node --test test/exercise-content.test.js test/app.test.js test/high-knees.test.js test/exercises.test.js`

Expected: PASS. The exact catalogue contains seven items; each can be selected and started; removed IDs cannot be selected; High Knees and retained analyzer/controller tests pass.

### Task 3: Update current documentation and validate the full catalogue

**Files:**
- Modify: `README.md`
- Test: `test/exercise-content.test.js`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: The seven-exercise catalogue and analyzer registry from Task 2.
- Produces: User documentation and automated checks that no longer describe the five removed exercises as available.

- [ ] **Step 1: Remove the five exercises from current README content**

Update exercise counts, the supported-analyzer descriptions, camera guidance, and any exercise list so the README describes the retained six and High Knees only. Preserve unrelated camera, privacy, and coaching instructions. Historical planning records remain historical and are not runtime references.

- [ ] **Step 2: Check source, tests, and current documentation for stale runtime references**

Run:

```powershell
rg -n "mountain-climbers|donkey-kicks|bicycle-crunches|standing-side-leg-raises|bird-dogs|Mountain Climbers|Donkey Kicks|Bicycle Crunches|Standing Side Leg Raises|Bird Dogs" src test api README.md
```

Expected: no matches. Do not search-and-delete historical plan/spec text; it records prior project work.

- [ ] **Step 3: Run the full automated suite and build**

Run: `npm test`

Expected: all tests pass, including the retained original exercise and High Knees tests.

Run: `npm run build`

Expected: Vite builds successfully and the output no longer contains any of the five removed image assets.

- [ ] **Step 4: Review the scoped diff**

Run: `git diff --check; git status --short`

Expected: no whitespace errors. Keep unrelated pre-existing changes untouched and unstaged.

