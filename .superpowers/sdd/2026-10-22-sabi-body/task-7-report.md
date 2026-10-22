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

The integrated browser loaded the Sabi Body Home screen and the Plank workout
view. On the Plank view, the camera preview remained off and Start was
available. No camera permission prompt appeared because Start was not pressed.

## Limitations and unverified behavior

Start was not pressed because no user-granted camera permission was available
or authorized for this check, and physical-camera access was not granted.
Consequently, camera permission grant or denial, unavailable-camera handling,
live video, model loading or inference, detections or skeleton overlay,
full-body/progress updates, speech playback, and camera cleanup were not
manually tested. Do not treat the browser check as evidence for those
behaviors. Automated tests use test doubles and do not substitute for a
real-camera check on a supported browser and device.

No directly related implementation defect was exposed by the checks.

## Task review fix pass

Corrected the manual-validation account above: removed the inaccurate
permission rationale and limited the browser-check claims to the observed Home
and Plank views, with preview off and Start available. Added a README note
advising first-time users to verify real-camera behavior on their own supported
browser/device and clarifying the Start permission boundary and test doubles.

### Validation

`npm test` and `npm run build` were rerun for this documentation-only fix.
Both commands exited with code `0`.

`npm test` exact summary:

```text
1..51
# tests 51
# suites 0
# pass 51
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 428.1928
```

`npm run build` exact output:

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
✓ built in 2.96s
```
