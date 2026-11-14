# Task 1: Categorized Multilingual Coaching Phrase Catalog

## Status

Implemented and committed as `760581d` (`feat: add categorized multilingual coaching phrases`).

## Implementation

- Added the shared `COACHING_PHRASES` catalog with six categories and 77 unique fixed phrase IDs. Each phrase has non-empty `en`, `yo`, `ig`, `ha`, and `pcm` templates.
- Added `EXERCISE_INSTRUCTION_IDS` for `squats`, `jumping-jacks`, `plank`, `push-ups`, `sit-ups`, and `lunges`; all six point to distinct localized workout instructions.
- Re-exported the catalog and mapping through `src/feedback/messages.js`.
- Preserved existing controller/analyzer message identifiers, including camera corrections, `great-job`, `keep-going`, `repetition-count`, milestones, exercise-specific feedback, and completion messages. Existing voice-test prompt IDs remain until their callers are removed in Task 4.
- Preserved safe unknown-ID handling, unsupported-language English fallback, approved `{count}`, `{remaining}`, and `{target}` interpolation, and return fields `text`, `isFallback`, and `translationStatus`.
- English phrases retain `verified` status; all non-English phrases return `unverified`.

## TDD and Verification

1. **RED:** Added catalog shape, locale completeness, exercise mapping, and interpolation tests first. The focused run failed because `COACHING_PHRASES` was not exported yet.
2. **GREEN:** Implemented the catalog and exports. `node --test test\feedback.test.js` passed: 32 tests, 0 failures.
3. **Full verification:** `npm run build` passed. A first `npm test` run had one timing-sensitive plank pause test fail; it passed in isolation, then the full rerun passed: 213 tests, 0 failures.
4. `git diff --check` passed. Only the three Task 1 files were staged and committed.

## Self-Review and Concerns

- Checked that all six categories are present, phrase IDs are unique, all locale maps are complete, exercise instructions are unique, and existing analyzer/controller IDs resolve for all five supported languages.
- No changes were made to the protected mobile redesign files.
- Non-English phrase text has **not** been reviewed by native speakers. All non-English translations remain marked unverified and should receive fluent-speaker review before being represented as verified.

## Fix Round 1

- Corrected the interpolation regression test to verify an actual unsupported `{unexpected}` placeholder remains unchanged.
- Added and exported the pure `interpolateCoachingTemplate` helper. It substitutes only approved keys (`count`, `remaining`, `target`) with finite numeric values; nonnumeric and non-finite values remain as placeholders. `translateCoachingMessage` continues to use this helper without changing its lookup result contract.
- **RED:** `node --test test\feedback.test.js` failed because the new helper export was missing.
- **GREEN:** Ran `node --test test\feedback.test.js` after the implementation.

Command output:

```text
# tests 33
# suites 0
# pass 33
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Exit code: `0`.
