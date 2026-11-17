# DSH Pet Realtime Agent — Implementation Plan

## Goal

Move session reasoning and Windows execution into the normal DeepSeek Harness Agent path. Keep the pet responsible only for wake/VAD/ASR, presentation, sentence TTS, interruption, and result reporting.

## Phase 1 — reliable realtime voice loop

- Read `voiceWakeActiveMs` instead of hard-coding 30 seconds.
- Use half-duplex capture: while TTS is active, feed only keyword spotting; do not run ordinary VAD/ASR.
- Allow a configured wake word to interrupt TTS, then start one fresh user turn.
- Wait 350 ms after TTS ends before ordinary VAD resumes, while keyword spotting remains available.
- Assign every final ASR utterance a unique `turnId`; suppress duplicate submissions.
- Add pure unit tests for timing, capture mode, and turn idempotency.

## Phase 2 — DSH Agent bridge

- Inject the official `sessionController` Host service.
- Create or resume a dedicated pet Session and submit text through `sessionController.prompt()` with `requestId = turnId`.
- Select GLM-5.3-Flash with `reasoningEffort: low` through the Session controller when available.
- Forward `agent/assistant-stream`, `session/event`, approval, tool, completion, and failure events to the pet event stream.
- Retire the pet-side Windows planner and direct action loop after parity tests pass.

## Phase 3 — streaming presentation

- Display assistant deltas immediately.
- Segment stable punctuation-delimited sentences into a cancellable TTS queue.
- Keep task cards driven by DSH tool/approval events rather than inferred local steps.
- Measure wake, endpoint, ASR, accept, first-text, first-audio, tool, and completion latency per `turnId`.

## Phase 4 — original animation migration

- Generate the first ten semantic actions with the private remote ComfyUI MiniMax H3 workflow.
- Remove background, repair loops, normalize foot anchor/direction/size/fps, and encode VP9-alpha WebM.
- Replace upstream actions only after identity, alpha-edge, foot-drift, loop-seam, and size checks pass.
- Keep server addresses, credentials, private prompts, and source media outside Git.

## Verification gate

- Unit tests and typecheck pass.
- A deterministic simulated voice test proves no ordinary ASR during TTS, wake-word interruption, cooldown, and duplicate suppression.
- A live DSH test proves one spoken request creates one Session turn, streams text, executes a harmless Windows action, reports verification, and produces one TTS response.
- Production configuration is updated only after the packaged build passes the live test.
