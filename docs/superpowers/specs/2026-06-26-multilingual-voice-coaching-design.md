# SabiBody Multilingual Voice Coaching Design

## Goal

Improve coaching consistency and speech delivery across English, Yoruba, Igbo,
Hausa, and Nigerian Pidgin. Keep the existing language and voice preferences,
YarnGPT integration, coach personalities, and workout behavior. Remove the
voice-testing interface and the translation disclaimer from the application UI.

## Current State

- `api/src/shared/coaching-messages.js` is shared by the frontend and Node
  coaching service. It has English and localized maps, controlled interpolation,
  and explicit unverified status for non-English translations, but it does not
  cover every requested coaching event or exercise-specific instruction.
- The frontend selects browser speech for English and YarnGPT audio for other
  languages. Both existing voice selection and language preferences must remain.
- `src/feedback/speech-queue.js` and its tests already implement priority,
  deduplication, pacing, cancellation, and recovery, but the workout controller
  does not use it.
- The browser speech adapter returns before an utterance ends. The audio adapter
  can replace current playback and resolves before audio ends. Both must honor
  the queue's completion contract before the queue can guarantee serialization.
- A developer-only voice-test panel and test actions exist. The production
  language and voice controls are separate and will remain.

## Design

### 1. One categorized phrase source

Expand `api/src/shared/coaching-messages.js` as the sole source of coaching
phrases. Preserve `translateCoachingMessage` and existing message identifiers
where practical so the frontend and Node service continue to share the same
lookup contract. Group entries into:

1. Camera positioning and body alignment.
2. General and exercise-specific workout instructions.
3. Motivation and encouragement.
4. Repetition and workout progress.
5. Plank coaching.
6. Workout completion.

Each phrase ID has a fixed template for all five language codes (`en`, `yo`,
`ig`, `ha`, `pcm`). Required catalog entries must not fall back to English.
Dynamic values remain limited to approved numeric parameters such as `count`,
`remaining`, and `target`; sentences are not generated or translated at
runtime.

Map the six existing exercise IDs to distinct instruction phrase IDs and use
the selected exercise when announcing the workout start. Keep this mapping
separate from exercise analysis; do not modify detection, repetition counting,
or plank timing. Include a prepared next-exercise phrase in the catalog without
adding multi-exercise progression to the existing single-exercise flow.

Provide several predefined motivation variants and select them in a
deterministic rotation rather than randomly. Existing coach-personality
eligibility remains in force. Non-English entries remain marked unverified
until reviewed by fluent speakers; orthographic checks and automated tests do
not constitute translation or pronunciation verification.

### 2. One speech queue and completion-aware adapters

Instantiate or accept one existing `createSpeechQueue` for each workout
controller and route every coaching announcement through it. The controller
continues to choose the localized phrase, voice, event key, and priority; it
does not call speech or audio output directly.

The browser speech adapter resolves only on utterance completion and rejects
on speech failure. It remains English-only and uses rate `0.92`. YarnGPT audio
playback resolves only on its `ended` event, reports playback errors, uses rate
`0.92` with pitch preservation where supported, and no longer owns independent
priority or duplicate policies. The existing queue remains the only owner of
ordering, deduplication, and the 350 ms inter-announcement pause.

Use the existing queue's priority/FIFO behavior for waiting messages. A higher
priority announcement never interrupts active output. Existing controller
eligibility and personality rules remain. The queue's per-event duplicate
window replaces the controller-wide cooldown that currently drops different
events. Include actual dynamic values in event keys so different repetition
counts are not collapsed.

Explicit voice-off or language changes may cancel active output and discard
stale waiting work. Ordinary new feedback and workout completion do not cancel
active output. Reset/end may clear pending items so outdated feedback is not
played later. Retain generation checks so synthesis results from an explicitly
cancelled language/session cannot begin playback. Queue and adapter failures
continue to surface through existing voice status/error reporting.

English continues through browser speech. Yoruba, Igbo, Hausa, and Nigerian
Pidgin continue through the existing YarnGPT client and selected compatible
voice. The displayed coaching text and speech request use the same selected
language and phrase. No provider, endpoint, or backend service replacement is
part of this change.

### 3. Voice settings cleanup

Remove the developer-only voice-test panel and its controller/UI actions,
including browser audio, YarnGPT connection, sample generation/playback, and
prompt test actions. Remove the translation-draft disclaimer and
pronunciation-review notices from the application interface. Keep language
selection, the “Select Voice” control, saved language/voice preferences, and
operational voice-catalogue/status feedback. Preserve the YarnGPT service and
voice catalogue integration.

Keep the README's translation-review guidance, updating it to describe the
categorized catalog and its unverified non-English content. This documentation
is distinct from the removed application disclaimer.

## Error Handling and Compatibility

- Missing required phrase translations are a test failure, not an English
  fallback.
- Speech synthesis, YarnGPT request, and audio playback failures remain
  visible through the existing status path; the queue must continue after a
  failed item.
- Language changes and voice-off are explicit cancellation points. A normal
  higher-priority announcement is not.
- Preserve existing supported language codes, voice preferences, YarnGPT
  requests, workout controls, analyzer IDs, detection logic, counters, and
  plank timer behavior.
- Do not change the mobile, tablet, or desktop layout beyond removing the
  specified voice-testing and disclaimer UI.

## Validation

Add focused automated tests that verify:

- Every requested category has required entries in all five languages, with
  no missing-translation fallback.
- Each of the six selected exercise IDs resolves to its own instruction.
- Dynamic repetition/progress values match the controller's actual count and
  target; plank cues use the current timer state.
- Yoruba strings retain required orthographic characters. This is a character
  check only, not a claim of linguistic correctness.
- Language changes update visible text and the language passed to speech;
  language and voice selections continue to persist.
- Browser speech and YarnGPT output share the same queue, do not overlap, wait
  for actual completion, honor pacing and duplicate suppression, and recover
  after errors or cancellation.
- The removed disclaimer and voice-test UI are absent while the language and
  voice controls remain.

Run the relevant tests, full `npm test`, `npm run build`, and
`git diff --check`. Inspect the settings interface at representative mobile
widths. Automated tests cannot establish native-speaker translation quality or
provider audio pronunciation; no live YarnGPT audio verification should be
claimed without actually testing it.
