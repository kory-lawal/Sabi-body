# SabiBody Mobile Experience Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a compact phone homepage and setup flow plus a camera-first, near-full-screen mobile workout without changing desktop/tablet layouts or workout behavior.

**Architecture:** Adapt the existing rendered screens and controller state rather than adding a second mobile UI. Add a small mobile settings-menu interaction, use existing workout status to activate the camera-first layout, and keep fullscreen as a non-blocking enhancement to the CSS fallback.

**Tech Stack:** JavaScript ES modules, Node.js built-in test runner, Vite, CSS media queries, browser Fullscreen API.

**Spec:** `docs/superpowers/specs/2026-11-14-mobile-experience-redesign-design.md`

## Global Constraints

- The redesign is limited to phone layouts at widths of 480px and below, plus short, coarse-pointer landscape phone viewports. Existing desktop and tablet layouts are not redesigned.
- Preserve existing exercises, goal values and calculations, camera permission behavior, MediaPipe pose detection, repetition counting, plank timing, translations, YarnGPT integration, and workout controls.
- Do not add zoom, alter camera capture constraints, or introduce a second mobile-only workout/data flow.

---

## File map

- `src/ui/app.js` owns the rendered home/setup/workout screens, delegated actions, and the workout-state-to-view updates. Reuse its controller and `state.target`; add only menu, fullscreen, and active-mode presentation wiring.
- `src/styles.css` owns the existing desktop, tablet, and phone layouts. Add the redesigned portrait rules at `max-width: 480px` and a separate short landscape phone query; do not alter existing rules above the phone scope.
- `index.html` owns the viewport meta tag. Enable safe-area viewport behavior for edge-to-edge phone layout.
- `test/app.test.js` uses `node:test` and lightweight fake roots/listeners. Extend those existing patterns; do not add a browser-test dependency.

The current worktree already contains goal synchronization and target-display edits in `src/ui/app.js` and `test/app.test.js`. Preserve and integrate those edits; do not reset or replace them.

## Task 1: Add the pre-workout mobile settings menu

**Files:**
- Modify: `src/ui/app.js` (`renderHome`, `renderWorkout`, `mountApp`)
- Modify: `test/app.test.js`
- Modify: `src/styles.css` (menu visibility and positioning only)

**Interfaces:**
- Consumes: `controller.setLanguage`, `controller.setPersonality`, existing `languageOptions` and `personalityOptions`.
- Produces: one `data-action="toggle-mobile-settings"` button and one `[data-mobile-settings]` panel per rendered header; the button exposes `aria-controls` and `aria-expanded`, while the panel exposes `data-open`.
- The existing language and coach-style selectors remain single instances per screen and keep their current `data-action` values.

- [ ] **Step 1: Add a failing menu interaction test**

Add a test named `mobile settings menu opens, closes on outside click and Escape, and applies selections`. Give the fake root an `ownerDocument` with listener registration and `dispatchEvent` behavior. Give the fake root `querySelector` access to a settings button and panel with `dataset.open` and `setAttribute` properties. Assert that the panel starts closed, the toggle opens it and changes `aria-expanded` to `"true"`, a language or coach-style change calls the existing controller and closes it, a document pointer event outside the settings wrapper closes it, and Escape closes it.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test --test-name-pattern="mobile settings menu" test/app.test.js`

Expected: FAIL because the mobile settings button, panel, and close behavior do not exist.

- [ ] **Step 3: Add reusable mobile settings markup and event wiring**

Keep the selectors' existing values and data actions. Render the hamburger and settings panel in the home and pre-workout headers. Add a closure-local `setMobileSettingsOpen(open)` helper in `mountApp` that updates the button's `aria-expanded` and the panel's `data-open` value without re-rendering the screen. Handle the toggle in the existing delegated click listener. Close the menu in the existing change handler after language or coach-style selection and when the rendered screen changes.

Register a document-level `pointerdown` handler through `root.ownerDocument`; close only when the target is outside `[data-mobile-settings-root]`. Register an Escape key handler on the same document. Do not attach handlers when `ownerDocument` is unavailable in the test fake. Hide the hamburger above 480px and render the same selector wrapper inline at tablet/desktop widths so the current controls remain in their existing positions.

Use the same selector wrapper in each header rather than duplicating selector elements:

```html
<div data-mobile-settings-root>
  <button
    type="button"
    data-action="toggle-mobile-settings"
    aria-controls="mobile-settings"
    aria-expanded="false"
  >Menu</button>
  <div id="mobile-settings" data-mobile-settings data-open="false">
    <!-- Existing coach-style and language labels/selects -->
  </div>
</div>
```

On desktop/tablet, style the wrapper and settings panel with `display: contents` and hide only the menu button. On phones, position the wrapper relative to the header, hide the panel until `[data-open="true"]`, and present it as the anchored popover.

The open-state helper is:

```js
function setMobileSettingsOpen(open) {
  const toggle = root.querySelector('[data-action="toggle-mobile-settings"]');
  const panel = root.querySelector('[data-mobile-settings]');
  if (!toggle || !panel) return;
  toggle.setAttribute('aria-expanded', String(open));
  panel.dataset.open = String(open);
}
```

- [ ] **Step 4: Run the focused test and the existing goal/settings checks**

Run: `node --test --test-name-pattern="mobile settings menu|goal presets|selected goal" test/app.test.js`

Expected: PASS for menu open/close, language/personality updates, and existing goal synchronization.

- [ ] **Step 5: Commit the menu change**

```text
feat: add mobile settings menu
```

## Task 2: Compact the phone homepage and implement the adaptive exercise grid

**Files:**
- Modify: `src/styles.css` (new portrait rules at `max-width: 480px`)
- Modify: `src/ui/app.js` only if a mobile-specific class or data hook is needed
- Modify: `test/app.test.js` only if a new semantic hook is added

**Interfaces:**
- Consumes: existing `.welcome`, `.welcome__stage`, `.exercise-grid`, `.exercise-card`, and exercise image markup.
- Produces: a compact copy-first hero and an adaptive grid: one column at widths up to 360px, two columns at 361–480px.

- [ ] **Step 1: Run the existing home-content regression test**

Run: `node --test --test-name-pattern="home exercise cards show the matching picture" test/app.test.js`

Expected: PASS on existing markup. CSS geometry is verified in the viewport check rather than by asserting CSS constants in JavaScript tests.

- [ ] **Step 2: Add the compact phone-home rules**

In a new `@media (max-width: 480px)` block, reduce header and hero vertical padding, keep the heading, privacy text, primary action, and hero artwork visible, and reduce the artwork stage height without changing its source image. Keep the existing visual tokens, typefaces, colors, and image containment.

Set `.exercise-grid` to one column through 360px and two equal `minmax(0, 1fr)` columns from 361px through 480px. Reduce card padding and spacing for two-column cards, preserve image aspect ratio with `object-fit: contain`, and keep each card action comfortably tappable. Do not use horizontal scrolling.

- [ ] **Step 3: Run the regression test and check the phone widths**

Run: `node --test --test-name-pattern="home exercise cards show the matching picture" test/app.test.js`

Open the Vite app and inspect the homepage at 320px, 360px, 375px, 390px, 430px, and 480px. Confirm the hero communicates the product and exposes its primary action without excessive empty space; confirm 320px/360px use one column, 375px–480px use two columns, images remain contained, and no horizontal overflow appears.

- [ ] **Step 4: Commit the homepage change**

```text
feat: compact the mobile homepage
```

## Task 3: Improve phone exercise and goal setup

**Files:**
- Modify: `src/styles.css` (phone setup rules only)
- Modify: `src/ui/app.js` only if an existing semantic hook is missing
- Verify: `test/app.test.js`

**Interfaces:**
- Consumes: the existing exercise heading, demonstration/instruction content, goal panel, `state.target`, custom goal input, and Start action.
- Produces: a readable compact setup layout with the chosen exercise and selected goal visible before Start; preset and custom controls keep using the existing target state.

- [ ] **Step 1: Run the existing goal/setup regression tests**

Run: `node --test --test-name-pattern="goal presets|selected 30-rep goal|each exercise opens its matching picture|plank goal completion" test/app.test.js`

Expected: PASS on the existing state flow. Do not add a test that merely repeats the current goal markup; use viewport inspection for the CSS-only layout.

- [ ] **Step 2: Add compact setup styles**

Within the phone portrait rules, reduce `.workout-heading` spacing, constrain the demonstration image to a readable contained size, and tighten instruction-card spacing without hiding instructional text. Keep the selected exercise heading and goal panel ahead of Start in the existing flow.

Make `.goal-picker` wrap cleanly; give `.goal-button` a minimum 44px hit area; let the custom field fit the viewport without overflow. Keep the goal summary and selected target visible while the user is choosing values. Preserve the existing `state.target` and preset/custom event handling.

Use the existing target state rather than a second mobile-only value:

```css
@media (max-width: 480px) {
  .goal-picker { display: flex; flex-wrap: wrap; }
  .goal-button { min-height: 44px; }
  .goal-custom { width: 100%; }
}
```

- [ ] **Step 3: Run goal/setup regression tests and inspect setup at phone widths**

Run: `node --test --test-name-pattern="goal presets|selected 30-rep goal|each exercise opens its matching picture|plank goal completion" test/app.test.js`

Inspect setup at 320px, 360px, 375px, 390px, 430px, and 480px. Confirm all goal buttons and custom fields are reachable, the selected exercise and target are obvious before Start, and controls do not force horizontal scrolling.

- [ ] **Step 4: Commit the setup change**

```text
feat: improve mobile exercise setup
```

## Task 4: Wire fullscreen requests and active-workout state

**Files:**
- Modify: `src/ui/app.js` (`mountApp`, `renderWorkout`, `updateWorkout`)
- Modify: `test/app.test.js`

**Interfaces:**
- Consumes: the existing Start/Pause/Resume/Reset/End actions and `workoutStatus`.
- Produces: a mobile active-state marker for `loading`, `running`, and `paused`; a non-blocking Fullscreen API request from Start; cleanup on end/completion; a live status for fullscreen fallback.

- [ ] **Step 1: Add failing fullscreen and state-lifecycle tests**

Add tests named:

```text
mobile Start requests fullscreen without waiting for it before starting
fullscreen rejection does not prevent camera startup
unsupported fullscreen keeps the CSS camera view usable
mobile active state locks scrolling and end releases fullscreen and scrolling
completion releases fullscreen and scrolling
reset preserves the active mobile workout state
```

Use the fake root's `ownerDocument` and a fake `.workout-page` element. For the success case, stub `matchMedia` with the phone/landscape query and assert `requestFullscreen` is called before the camera-start promise resolves. For the rejection case, reject the fullscreen promise, assert the workout still reaches `running`, and assert the live fallback status is populated. For lifecycle, assert the active class remains through reset and pause, then is removed and `exitFullscreen` is called on both End and completion paths.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `node --test --test-name-pattern="mobile Start requests fullscreen|fullscreen rejection|unsupported fullscreen|mobile active state|completion releases fullscreen|reset preserves the active mobile" test/app.test.js`

Expected: FAIL because the Start handler does not request fullscreen and active state does not manage scroll/fullscreen presentation.

- [ ] **Step 3: Add non-blocking fullscreen and active-state wiring**

Use the same mobile query in JavaScript and CSS:

```js
const MOBILE_WORKOUT_QUERY =
  '(max-width: 480px), (max-width: 900px) and (max-height: 430px) and (orientation: landscape) and (pointer: coarse)';
```

On the delegated Start action, call `requestFullscreen()` synchronously on the workout page if the query matches and the method exists; then call `controller.start()` without awaiting fullscreen. Handle both synchronous throws and promise rejection, show a concise live fallback status, and leave the existing camera/error flow untouched.

Use a narrowly scoped helper so unsupported fullscreen does not block the camera:

```js
function requestMobileFullscreen(workoutPage, ownerDocument, isWorkoutActive) {
  const status = workoutPage?.querySelector('[data-fullscreen-status]');
  const showFallback = () => {
    if (status) {
      status.hidden = false;
      status.textContent = 'Fullscreen unavailable; the camera view remains active.';
    }
  };
  if (!workoutPage?.requestFullscreen) {
    showFallback();
    return;
  }
  try {
    const request = workoutPage.requestFullscreen();
    void Promise.resolve(request)
      .then(() => {
        if (!isWorkoutActive() && ownerDocument.fullscreenElement === workoutPage) {
          return ownerDocument.exitFullscreen?.();
        }
      })
      .catch(showFallback);
  } catch {
    showFallback();
  }
}
```

Invoke this helper only when `matchMedia(MOBILE_WORKOUT_QUERY).matches`, passing `() => ['loading', 'running', 'paused'].includes(controller.getState().workoutStatus)` as `isWorkoutActive`; call `controller.start()` immediately afterward.

Synchronize active presentation on every `render(state)`, including the transition to the completion screen:

```js
const active = ['loading', 'running', 'paused'].includes(state.workoutStatus);
workoutPage?.classList.toggle('is-active', active);
root.ownerDocument?.body?.classList.toggle('workout-active', active);
```

Add a `<p data-fullscreen-status role="status" aria-live="polite" hidden>` in the workout markup. Show it if fullscreen is unsupported or the request throws/rejects; keep camera startup independent of this status. Keep the active marker during Reset, Pause, and Resume. Remove it when the screen leaves the active workout. Before replacing the workout markup with home or completion markup, call `exitFullscreen()` only if the current workout page owns fullscreen; do not await it before screen cleanup. If a pending fullscreen request resolves after the user has left the session, exit it immediately. Do not reset progress when the browser exits fullscreen.

- [ ] **Step 4: Run focused lifecycle and existing workout tests**

Run: `node --test --test-name-pattern="mobile Start requests fullscreen|fullscreen rejection|unsupported fullscreen|mobile active state|completion releases fullscreen|reset preserves the active mobile|repeated Start|pause and resume|reset|completion" test/app.test.js`

Expected: PASS; fullscreen failure remains non-fatal and existing controller lifecycle behavior is unchanged.

- [ ] **Step 5: Commit the state/fullscreen change**

```text
feat: add mobile workout fullscreen handling
```

## Task 5: Build the camera-first workout layout and safe-area behavior

**Files:**
- Modify: `src/styles.css`
- Modify: `index.html`
- Modify: `src/ui/app.js` only for overlay hooks or a compact voice-settings disclosure
- Modify: `test/app.test.js` if those hooks need semantic coverage

**Interfaces:**
- Consumes: Task 4's active-state marker, the existing camera stage, progress/feedback, readiness labels, controls, and voice options.
- Produces: a fixed viewport camera stage with a top status overlay and bottom dock; matched contained video/canvas framing; an active voice-options disclosure.

- [ ] **Step 1: Add a failing active-layout markup test**

Add a test named `active workout exposes compact status, dock controls and voice options`. Assert the workout markup retains exercise/target progress, readiness status, feedback, Pause/Resume/Reset/End actions, and all current voice controls. Assert the voice-options toggle has `aria-expanded` and `aria-controls`; click it and verify the existing voice controls are reachable without replacing them. Assert the active marker is set. The header remains in the DOM but is hidden from the active camera by CSS; verify that visibility in the responsive browser check rather than asserting that the markup is removed.

- [ ] **Step 2: Run the focused test**

Run: `node --test --test-name-pattern="active workout exposes compact status" test/app.test.js`

Expected: FAIL until the active voice disclosure and any missing overlay hooks are present.

- [ ] **Step 3: Add the active overlay structure without duplicating workout state**

Keep the current video and canvas in `.camera-stage`. Position existing progress, feedback, readiness, and workout-control nodes as overlays using active-state selectors. Keep the existing action `data-action` names so controller behavior is unchanged. Add a mobile-only `data-action="toggle-mobile-voice-settings"` button with `aria-controls`, `aria-expanded`, and a `[data-mobile-voice-settings]` panel containing the existing voice toggle, volume, voice selector, and count-each-rep controls. The button and panel appear only during an active phone workout; the panel starts closed and the delegated click handler toggles its `data-open` attribute. Keep the existing controls visible in their current pre-start and desktop/tablet layouts; do not duplicate controls or event handlers. In the active mobile dock, hide Start and whichever of Pause/Resume is disabled; keep Reset and End available.

- [ ] **Step 4: Add camera-first CSS and safe-area viewport support**

For portrait phones, position the active `.workout-page` over the full viewport using `100vh` followed by `100dvh`, safe-area padding, a dark camera background, and `overflow: hidden`. Remove its max-width, outer margins, page padding, camera border, and rounded corners while active. Hide setup-only header/instruction/goal content while active. Keep the top exercise/target/readiness strip and bottom progress/feedback/control dock inside the safe area; make controls at least 44px tall.

In both the `max-width: 480px` portrait query and the short landscape query, let the camera stage fill the viewport and set video and canvas to the same `inset`, width, height, `object-fit: contain`, and `scaleX(-1)` transform. Keep the canvas non-interactive. For landscape phones, reduce dock height and use a compact horizontal arrangement; do not apply this rule to ordinary tablet viewports.

Change the viewport meta content in `index.html` to:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

Apply scroll locking only inside the phone and short-landscape media queries:

```css
@media
  (max-width: 480px),
  (max-width: 900px) and (max-height: 430px) and (orientation: landscape) and (pointer: coarse) {
  body.workout-active { overflow: hidden; overscroll-behavior: none; }
  .workout-page.is-active {
    position: fixed;
    inset: 0;
    width: 100%;
    max-width: none;
    margin: 0;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }
  .workout-page.is-active [data-action="start"],
  .workout-page.is-active [data-action="pause"][disabled],
  .workout-page.is-active [data-action="resume"][disabled] { display: none; }
}
```

Ensure Task 4's body class is removed on exit. Do not use `object-fit: cover`, alter `getUserMedia` constraints, or change MediaPipe inputs.

- [ ] **Step 5: Run active-layout tests and build**

Run:

```text
node --test --test-name-pattern="active workout exposes compact status|mobile active state|fullscreen rejection|completion releases fullscreen" test/app.test.js
npm run build
```

Expected: PASS and a successful production build.

- [ ] **Step 6: Commit the camera-first layout**

```text
feat: add camera-first mobile workout layout
```

## Task 6: Verify the full mobile flow and preserve desktop/tablet behavior

**Files:**
- Verify: `src/ui/app.js`
- Verify: `src/styles.css`
- Verify: `index.html`
- Verify: `test/app.test.js`

**Interfaces:**
- Consumes: all mobile menu, setup, fullscreen, and overlay behavior from Tasks 1–5.
- Produces: tested mobile flow and evidence that existing desktop/tablet and workout behaviors remain unchanged.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`

Expected: all tests pass, including the existing goal, rep-counting, plank, voice, camera, and workout-control tests.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: Vite completes without syntax or asset errors.

- [ ] **Step 3: Inspect the responsive screens**

Start the app with `npm run dev` and inspect homepage, setup, and active workout at widths 320px, 360px, 375px, 390px, 430px, and 480px. Also inspect a short coarse-pointer landscape viewport with width at or below 900px and height at or below 430px. Confirm the menu opens/closes correctly, the adaptive grid switches at 360px, controls remain reachable, and no page or horizontal overflow occurs.

Compare desktop and tablet layouts with the pre-change baseline; the existing visible selectors, exercise layout, and standard tablet behavior must remain unchanged.

- [ ] **Step 4: Verify camera and tracking alignment**

Where a camera is available, start a workout and inspect portrait, landscape, and one rotation during a session. Confirm the source frame is not cropped or distorted, the full body remains visible when framed by the camera, landmarks overlay the same visible image content, and rotation preserves rep/timer progress. Confirm denied or unsupported fullscreen still starts the camera-first CSS view. If no camera is available in the test environment, record that limitation and verify the video/canvas fit and alignment with fixed-aspect-ratio media elements; do not report a real-camera check as passed.

- [ ] **Step 5: Review the final diff**

Run `git diff --check` and inspect `git diff -- src/ui/app.js src/styles.css index.html test/app.test.js`. Confirm there are no edits to exercise analyzers, pose tracking, voice integration, translations, or tablet/desktop rules outside the requested scope. Do not stage unrelated worktree files. If validation requires a correction, add the corresponding focused test and commit only the related source/test changes; otherwise finish without an extra commit.
