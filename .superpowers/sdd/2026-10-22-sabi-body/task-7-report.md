# Task 7 Report: Document Use, Privacy, and Validate End-to-End

## Files changed

- `README.md` — added user, developer, privacy, accessibility, extension, and
  integration-boundary documentation.
- `.superpowers/sdd/2026-10-22-sabi-body/task-7-report.md` — this validation
  report.

No implementation files required a fix during validation.

## README coverage

- Node.js/npm prerequisite and the exact `npm install`, `npm run dev`,
  `npm test`, `npm run build`, and `npm run preview` package scripts.
- Vite's printed local URL, secure-context requirement (`localhost` or HTTPS),
  and browser-granted camera permission after pressing Start.
- MediaPipe Tasks Vision VIDEO-mode inference, one pose, local browser-frame
  processing, Canvas skeleton overlay, and external WASM/model asset downloads.
- Squat knee-angle cycle, jumping-jack open/return cycle, plank alignment and
  timing, visibility/framing limitations, and non-medical scope.
- Camera privacy and cleanup, microphone not requested, no application account
  or workout-history storage, and network metadata for model/runtime/fonts.
- Accessibility controls/status, camera positioning/setup, and retry guidance.
- All five language options; English text and English browser speech are
  implemented, while other translations are unavailable and fall back to
  English.
- How to add an analyzer, test, UI registration, instructions, progress label,
  and feedback message IDs.
- YarnGPT is future-only; any later integration must use a same-origin
  server-side endpoint, keep credentials off the frontend, and not transmit
  camera frames or pose landmarks.

## Automated validation

### `npm test`

Exit code: `0`.

Exact test summary:

```text
1..51
# tests 51
# suites 0
# pass 51
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 531.1743
```

### `npm run build`

Exit code: `0`. Exact output:

```text
> sabi-body-implementation@1.0.0 build
> vite build

vite v7.3.7 building client environment for production...
transforming...
✓ 15 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.63 kB │ gzip:  0.38 kB
dist/assets/index-l4Sq1Wpp.css   11.28 kB │ gzip:  3.30 kB
dist/assets/index-Ci4AJPuT.js   171.28 kB │ gzip: 52.65 kB
✓ built in 2.99s
```

## Local browser checks

Started the project with `npm run dev`; Vite reported
`http://localhost:5173/`. The browser loaded the Sabi Body Home screen.

- Home showed its exercise choices and language selector. No camera prompt
  appeared; Start was not pressed.
- Selected Squats, Jumping Jacks, and Plank in turn. Each opened the matching
  exercise heading and instructions. In all three, the camera badge remained
  “Camera off” and the preview placeholder remained visible.
- Selected Yoruba and observed the explicit “English text shown; translation
  unavailable.” fallback. Toggled Spoken coaching on and observed its checked
  state; no workout was started and no audio was exercised.
- Checked the workout view at a 390 × 844 CSS-pixel viewport. The document did
  not overflow horizontally (375 px document/client width within the 390 px
  viewport). Workout buttons measured 46 px high; Start and End spanned 351 px,
  and Pause/Resume/Reset each measured 171 px.

## Limitations and unverified behavior

The browser session deliberately did not press Start, to avoid triggering a
camera permission request as instructed. Therefore it did not exercise camera
permission grant/denial, a device without a camera, live video, actual model
download/inference, skeleton overlay from real detections, full-body/progress
updates from a person, audible speech, or live Pause/Resume/Reset/End cleanup.
Those hardware/model/browser behaviors are not claimed as manually verified.
The automated tests exercise the relevant analyzer, camera, tracker, and
workout-controller paths with test doubles; they do not replace a real-device
camera check.

No directly related implementation defect was exposed by the checks.
