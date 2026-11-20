# Six New MediaPipe Exercises Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six illustrated exercises with exercise-specific MediaPipe counting, positioning guidance, automatic English coaching, targets, and completion.

**Architecture:** Follow the current exercise catalog and per-exercise analyzer pattern. Add one stateful analyzer per movement, reuse the MediaPipe tracker and readiness gate, wire all results through the current workout controller, and use the single existing speech queue.

**Tech Stack:** JavaScript ES modules, MediaPipe Tasks Vision normalized landmarks, Node.js built-in test runner, Vite.

**Spec:** [../specs/2026-11-14-six-mediapipe-exercises-design.md](../specs/2026-11-14-six-mediapipe-exercises-design.md)

**Prerequisite:** Complete [Workout Readiness Gate](2026-11-14-workout-readiness-gate.md) first. Its `src/exercises/readiness.js` exports `createStartPoseGate(measureStartPose, { stableMs, gapMs })`, returning `{ check, reset }`; every analyzer exposes `checkReady(landmarks, timestamp)`.

## Global Constraints

- Keep the existing MediaPipe PoseLandmarker; do not add another vision library.
- Keep each new movement in its own analyzer module.
- Count only complete threshold-and-return cycles; discard pending cycles after tracking loss.
- Each completed side movement is one repetition; Bird Dog requires the opposite arm and leg together.
- Use a stable 400 ms start pose before countdown for all 12 exercises.
- New exercises start with a 10-repetition target.
- Use the six provided PNGs by their exact filenames.
- Reuse automatic coaching and the single speech queue.
- Do not claim real-camera accuracy from synthetic fixtures.

---

## File map

- Modify `src/ui/exercise-content.js` for 12 exercise records, details, and exact image URLs.
- Modify `src/ui/app.js` for six analyzer imports/instances, explicit 10-rep defaults, goal presets, and rendering description/muscles.
- Create `src/exercises/high-knees.js`, `mountain-climbers.js`, `donkey-kicks.js`, `bicycle-crunches.js`, `standing-side-leg-raises.js`, and `bird-dogs.js`.
- Create one focused test file for each new analyzer under `test/`.
- Modify `api/src/shared/coaching-messages.js` and `test/feedback.test.js` for exercise-specific English cues.
- Modify `test/exercise-content.test.js` and `test/app.test.js` for 12-entry image/content/start/target/voice/completion coverage.
- Add the provided root-level files `High Knees.png`, `Mountain Climbers.png`, `Donkey Kicks.png`, `Bicycle Crunches.png`, `Standing Side Leg Raises.png`, and `Bird Dogs.png` to version control unchanged.

## Task 1: Add catalog metadata and exercise images

**Files:**
- Modify: `src/ui/exercise-content.js`
- Modify: `src/ui/app.js`
- Modify: `src/styles.css`
- Modify: `test/exercise-content.test.js`
- Modify: `test/app.test.js`
- Add: the six named root-level PNG assets

**Interfaces:**
- Produces six entries with `name`, `description`, `targetMuscles`, `benefits`, `instruction`, `instructions`, `cameraInstruction`, `progressLabel`, and `media`.
- Use `new URL('../../High Knees.png', import.meta.url).href` from `src/ui/exercise-content.js`, substituting each exact filename.

- [ ] **Step 1: Extend the catalog test before production code**

Update `expectedExercises` in `test/exercise-content.test.js` to include the six IDs (`high-knees`, `mountain-climbers`, `donkey-kicks`, `bicycle-crunches`, `standing-side-leg-raises`, `bird-dogs`), exact filenames, user-provided benefits, and non-empty descriptions/muscle arrays/instructions.

- [ ] **Step 2: Run `node --test test/exercise-content.test.js`; confirm it fails because the six catalog entries are missing**
- [ ] **Step 3: Add the six catalog entries using the descriptions, targeted muscles, benefits, instructions, and camera directions in the approved spec**
- [ ] **Step 4: Render description and target muscles on home cards; render description, target muscles, benefits, instructions, and camera directions in the existing workout setup view. Add only a compact muscle-list style under existing exercise-card/setup selectors**
- [ ] **Step 5: Add matching exercise image alt text; keep the two supplied cartoon demonstrators and do not replace or transform the user files**
- [ ] **Step 6: Run `node --test test/exercise-content.test.js test/app.test.js`; verify all 12 image URLs resolve to distinct files and the new UI content is present**
- [ ] **Step 7: Commit the catalog, UI, tests, and six images with `feat: add six illustrated exercise entries` and the required Copilot co-author trailer**

## Task 2: Add High Knees analyzer

**Files:**
- Create: `src/exercises/high-knees.js`
- Create: `test/high-knees.test.js`

**Interfaces:**
- Export `createHighKneesAnalyzer()`, returning `{ update, reset, invalidatePhase, checkReady }`.
- Use MediaPipe hips 23/24, knees 25/26, and ankles 27/28 with `isVisible`.

- [ ] **Step 1: Write tests for stable neutral stance, left lift/return, right lift/return, incomplete lift, duplicate frames, and missing landmarks**
- [ ] **Step 2: Run `node --test test/high-knees.test.js`; confirm failure because the analyzer module is missing**
- [ ] **Step 3: Implement a neutral-stance baseline and a per-side pending phase. A knee must rise to at least hip height relative to its baseline and return below the hip before count increments. Alternate sides; reject a second lift on the same side until the opposite side completes. Expose active side and knee-to-hip measurements in `metrics`**
- [ ] **Step 4: Use `createStartPoseGate` for an upright stance with both leg chains visible; reset its timer on invalidation**
- [ ] **Step 5: Run `node --test test/high-knees.test.js`; verify only complete alternating cycles count once**
- [ ] **Step 6: Commit with `feat: add high knees movement analysis` and the required trailer**

## Task 3: Add Mountain Climbers analyzer

**Files:**
- Create: `src/exercises/mountain-climbers.js`
- Create: `test/mountain-climbers.test.js`

**Interfaces:**
- Export `createMountainClimbersAnalyzer()` with the same four-method analyzer interface.
- Use visible shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24, knees 25/26, and ankles 27/28.

- [ ] **Step 1: Test ready high plank, knee-drive/return on each side, an unreturned drive, hip sag, repeated frames, and a visibility gap**
- [ ] **Step 2: Run `node --test test/mountain-climbers.test.js`; confirm failure because the analyzer is missing**
- [ ] **Step 3: Measure plank alignment and knee-to-shoulder distance relative to torso length. Count a knee drive only after the knee passes its movement threshold and returns to the extended-plank baseline; alternate sides**
- [ ] **Step 4: Require visible wrist/shoulder support and a stable high-plank starting pose in `checkReady`; return a form correction when the hip line is outside the analyzer's tolerance**
- [ ] **Step 5: Run the focused test and verify partial drives or sagging hips never increment**
- [ ] **Step 6: Commit with `feat: add mountain climber movement analysis` and the required trailer**

## Task 4: Add Donkey Kicks analyzer

**Files:**
- Create: `src/exercises/donkey-kicks.js`
- Create: `test/donkey-kicks.test.js`

**Interfaces:**
- Export `createDonkeyKicksAnalyzer()` with the same four-method analyzer interface.
- Use visible shoulders, wrists, hips, knees, and ankles on each measurable side.

- [ ] **Step 1: Test a stable tabletop start, a bent-leg lift and return, an incomplete lift, a straight-leg movement, repeated frames, and alternating sides**
- [ ] **Step 2: Run `node --test test/donkey-kicks.test.js`; confirm failure because the analyzer is missing**
- [ ] **Step 3: Measure knee flexion and ankle height/hip extension relative to the hip-to-knee segment. Count only when the bent knee crosses the lift threshold and returns to tabletop; retain `workingSide` in metrics and prefer alternating sides when both are measurable**
- [ ] **Step 4: Require visible hands-and-knees landmarks for readiness; use the existing tracking-gap reset behavior for an unfinished kick**
- [ ] **Step 5: Run the focused test and verify knee-only noise and small ankle motion do not count**
- [ ] **Step 6: Commit with `feat: add donkey kick movement analysis` and the required trailer**

## Task 5: Add Bicycle Crunches analyzer

**Files:**
- Create: `src/exercises/bicycle-crunches.js`
- Create: `test/bicycle-crunches.test.js`

**Interfaces:**
- Export `createBicycleCrunchesAnalyzer()` with the same four-method analyzer interface.
- Use shoulders 11/12, elbows 13/14, hips 23/24, and knees 25/26; require confidence for both endpoints of the active cross-body pair.

- [ ] **Step 1: Test lying start, right-elbow/left-knee curl/return, left-elbow/right-knee curl/return, no-contact completion, elbow-only movement, knee-only movement, and repeated frames**
- [ ] **Step 2: Run `node --test test/bicycle-crunches.test.js`; confirm failure because the analyzer is missing**
- [ ] **Step 3: Compare opposite elbow-to-knee distance against torso length. Require a clear distance reduction followed by return toward baseline; count once per side without requiring physical contact**
- [ ] **Step 4: Require a visible lying start pose and both shoulders, elbows, hips, and knees for the active pair; discard the pending curl if either endpoint is lost**
- [ ] **Step 5: Run the focused test and verify single-limb motion does not count**
- [ ] **Step 6: Commit with `feat: add bicycle crunch movement analysis` and the required trailer**

## Task 6: Add Standing Side Leg Raises analyzer

**Files:**
- Create: `src/exercises/standing-side-leg-raises.js`
- Create: `test/standing-side-leg-raises.test.js`

**Interfaces:**
- Export `createStandingSideLegRaiseAnalyzer()` with the same four-method analyzer interface.
- Use shoulders 11/12, hips 23/24, knees 25/26, and ankles 27/28.

- [ ] **Step 1: Test stable upright stance, left raise/return, right raise/return, incomplete raise, torso lean, and duplicate frames**
- [ ] **Step 2: Run `node --test test/standing-side-leg-raises.test.js`; confirm failure because the analyzer is missing**
- [ ] **Step 3: Measure ankle displacement outward from the same-side hip relative to hip width. Count only after crossing the lateral threshold and returning near the baseline while shoulder/hip alignment remains within tolerance; alternate sides**
- [ ] **Step 4: Require both leg chains and shoulders for the stable standing readiness pose**
- [ ] **Step 5: Run the focused test and verify torso lean alone cannot produce a count**
- [ ] **Step 6: Commit with `feat: add standing side leg raise analysis` and the required trailer**

## Task 7: Add Bird Dogs analyzer

**Files:**
- Create: `src/exercises/bird-dogs.js`
- Create: `test/bird-dogs.test.js`

**Interfaces:**
- Export `createBirdDogAnalyzer()` with the same four-method analyzer interface.
- Use shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24, knees 25/26, and ankles 27/28.

- [ ] **Step 1: Test stable tabletop, right-arm/left-leg extension and return, left-arm/right-leg extension and return, arm-only, leg-only, and repeated frames**
- [ ] **Step 2: Run `node --test test/bird-dogs.test.js`; confirm failure because the analyzer is missing**
- [ ] **Step 3: Compare wrist travel along the torso axis relative to its shoulder and opposite-ankle travel along the torso axis relative to its hip, normalized by each limb segment. Arm and opposite leg must both cross extension thresholds before the pending phase is accepted**
- [ ] **Step 4: Count only after both limbs return to tabletop; alternate pairings and expose the completed side in metrics**
- [ ] **Step 5: Use visible wrist, shoulder, hip, knee, and ankle landmarks for stable readiness; reset an incomplete pair after visibility loss**
- [ ] **Step 6: Run the focused test and verify either single-limb extension never counts**
- [ ] **Step 7: Commit with `feat: add bird dog movement analysis` and the required trailer**

## Task 8: Wire analyzers and targets into the workout controller

**Files:**
- Modify: `src/ui/app.js`
- Modify: `test/app.test.js`

**Interfaces:**
- Consumes: the six analyzer factories from Tasks 2-7 and their readiness helper.
- Produces: `createAnalyzers()` entries for all 12 IDs and explicit default targets of 10 reps for each new ID.

- [ ] **Step 1: Add failing tests that select each new exercise and verify its analyzer, target, progress unit, and selected exercise ID**
- [ ] **Step 2: Run `node --test test/app.test.js`; confirm the tests fail because the exercise IDs are not wired**
- [ ] **Step 3: Import and register each factory in `createAnalyzers`; add the six IDs to `DEFAULT_TARGETS` with value `10` and `GOAL_PRESETS` with `[5, 10, 15, 20, 25, 30, 50]`**
- [ ] **Step 4: Keep all new analyzers on the existing `processPose`, rep announcement, target completion, reset, pause, and end paths; do not add per-exercise speech queues**
- [ ] **Step 5: Run `node --test test/app.test.js`; verify a selected target stops count at the target, speaks completion once, and camera cleanup still occurs on End**
- [ ] **Step 6: Commit with `feat: wire new exercise analyzers and goals` and the required trailer**

## Task 9: Add automatic English exercise coaching

**Files:**
- Modify: `api/src/shared/coaching-messages.js`
- Modify: `test/feedback.test.js`
- Modify: `test/app.test.js`

**Interfaces:**
- Produces six `EXERCISE_INSTRUCTION_IDS` entries and exercise-specific English starting/form cues through the existing message lookup and `setFeedback`.
- Adds form-correction IDs to `ESSENTIAL_CORRECTIONS` in `src/ui/app.js` so the quiet coach still speaks safety/position corrections.

- [ ] **Step 1: Add failing tests that assert each new ID resolves to its English cue and maps to the correct exercise**
- [ ] **Step 2: Run `node --test test/feedback.test.js test/app.test.js`; confirm failures for the six missing IDs**
- [ ] **Step 3: Add concise English-only entries for the six new instructions and essential corrections. Keep the existing multilingual entries untouched; use the current English fallback behavior for unavailable languages**
- [ ] **Step 4: Add each form-correction ID to `ESSENTIAL_CORRECTIONS` and assert that the quiet coach speaks it once**
- [ ] **Step 5: Extend the automatic coaching test to assert one exercise instruction, each valid rep count, and one completion message pass through the existing queue in order**
- [ ] **Step 6: Run `node --test test/feedback.test.js test/app.test.js`; verify no overlapping or duplicate announcement**
- [ ] **Step 7: Commit with `feat: add automatic coaching for new exercises` and the required trailer**

## Task 10: Validate the complete 12-exercise feature

**Files:**
- Modify: `test/exercise-content.test.js`
- Modify: `test/exercises.test.js`
- Modify: `test/app.test.js`

- [ ] **Step 1: Update exact-six assumptions and test names to cover 12 catalog entries and all 12 workout target results**
- [ ] **Step 2: Run focused selectors for all six new analyzer files, `test/exercise-content.test.js`, and `test/app.test.js`**
- [ ] **Step 3: Run `npm test`, `npm run build`, and `git diff --check`**
- [ ] **Step 4: Verify the browser exercise-selection cards load all six exact PNGs and show descriptions/muscles; verify a camera session remains in positioning until the chosen starting pose is stable**
- [ ] **Step 5: Report only synthetic landmark results as automated evidence. Record any live-camera verification separately and do not claim real-world accuracy without representative movement testing**
- [ ] **Step 6: Commit the final integration with `test: validate all twelve workout exercises` and the required trailer**

