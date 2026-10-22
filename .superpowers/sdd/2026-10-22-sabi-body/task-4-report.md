# Task 4 Report: Feedback, Localization Fallback, and Speech

## Status

Implemented and committed on `feature/sabi-body`.

## Changed files

- `src/feedback/messages.js` — supported language list, complete English catalog for analyzer IDs, empty untranslated dictionaries, explicit safe unknown-ID fallback, and `translateMessage`.
- `src/feedback/speech.js` — injected browser speech dependencies, English-only best-effort speaking, cooldown, cancellation controls, and surfaced speech API errors.
- `src/services/yarngpt.js` — isolated future client for a validated same-origin endpoint; POSTs only `messageId` and `language`, and reports network/HTTP failures.
- `test/feedback.test.js` — tests for the language catalog, translations/fallbacks, speech behavior/errors, and YarnGPT request contract/errors.

No package manifest, UI, backend, YarnGPT key, or YarnGPT integration was added. Non-English messages intentionally remain untranslated.

## RED/GREEN evidence

- Initial `node --test test/feedback.test.js` failed as expected because `src/feedback/messages.js` did not exist (`ERR_MODULE_NOT_FOUND`).
- During self-review, added a regression test for an unknown ID equal to an inherited property (`toString`). It failed as expected because it returned a function instead of an explicit string fallback.
- Changed catalog lookups to require own dictionary properties. The focused suite then passed, including the regression.

## Validation

- `node --test test/feedback.test.js` — **14 passed, 0 failed**.
- `npm test` — **33 passed, 0 failed**.
- `npm run build` — **passed**; Vite 7.3.7 built successfully.
- `git diff --check` — **passed**.

## Commit

- `047f68a feat: add centralized feedback and speech services`
- Includes the requested `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.
- Worktree clean after commit.

## Concerns / limitations

- Yoruba, Igbo, Hausa, and Nigerian Pidgin return English fallback by design until translations are verified.
- Speech was validated with injected test doubles; browser/OS speech availability and behavior still vary and were not manually exercised.
- The YarnGPT module is only a client contract. A same-origin server endpoint must be supplied for any future use; no UI currently invokes it.

## Task 4 review fix: asynchronous speech errors

Addressed the review finding that `try/catch` does not observe Web Speech API errors dispatched later through `SpeechSynthesisUtterance.onerror`. `createSpeechCoach` now accepts an additive optional `onError` callback (defaulting to a no-op to preserve existing callers) and invokes it with a descriptive `Error` whose `cause` is the browser error event. Existing `speak` return values and synchronous exception handling are unchanged. Callers that need to observe asynchronous failures can pass `onError`.

Added a focused regression test that speaks, triggers the utterance's `onerror` event, and verifies that the callback receives the error.

### Verification

- RED: `node --test test/feedback.test.js` — **14 passed, 1 failed** as expected; the regression failed because `utterance.onerror` was not installed (`TypeError: ...onerror is not a function`).
- `node --test test/feedback.test.js` — **15 passed, 0 failed**.
- `npm test` — **34 passed, 0 failed**.
- `git diff --check` — **passed**.

### Fix commit

- `fix: surface asynchronous speech errors`
- Includes `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
