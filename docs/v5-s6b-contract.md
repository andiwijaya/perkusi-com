# V5 S6B bounded Gamelan event pattern contract

S6A independent ACCEPT is the starting point. This slice adds the instrument/note16step editor and a bounded single Gamelan event-score Repeat in opt-in mode `gamelan-v5-ux`. Default `npm run build` remains the V4 public-candidate mode. This is not full S6, V5 release, durable recording integration, or microphone authorization.

## Editable source and fidelity

The existing validated schema4 instrument document remains the working score. Studio and the new grid share the same InstrumentStudioBridge/history/session; exact bank/sample/tick/action keys identify cells. Source JSON/origin, consent, group mix, other banks and off-grid events remain retained. A bank switch never retunes old events. Grid edits use one atomic validated transaction, not appendInstrumentEvent's collision tick shift. Limits remain4096events,8banks,128bars and the existing1MiB schema limit. There is no replacement project schema.

16steps are one bar: PPQ960000, quarter-step240000ticks. Exact same cell/action toggles; explicit damp has velocity0. Pukul/Strike velocity remains(0,1]. Addbar extends the score one full bar, without rewriting legacy pattern chains or clearing banks. Legacy/Gamelan hybrid documents remain editable and one-shot playable; Repeat is deliberately unavailable for active legacy patterns/clips. The complete original score remains available to finite export.

## Current bounded clock contract and deviation from the S6B proposal

This spike uses a fixed stored integer period: round(score.lengthTicks *60*sampleRate/(BPM*PPQ)). Start of cycle n is one absolute origin + n*storedPeriod. It does not chain setTimeout restarts. At173BPM48k one bar is66590frames; two bars133179. The fixed-period choice is explicit, following the accepted S5 recorded-master model. It differs from the plan's ideal absolute-tick event-master proposal, which would alternate rounded periods. No recording is actually attached as master yet, so this spike does not claim to resolve that integration. Error versus ideal ticks is bounded by the measured five-minute gate; fixed rounding can accumulate over longer sessions. S6C must choose/serialize the canonical master-cycle contract and validate long sessions before full release.

Existing context/Transport, sample cache/leases and instrumentVoice DSP are reused. playbackRate stays1. Natural source tails may cross multiple periods; no loop-end cutoff is added. Only an explicit same-bank/sample damp may stop a tail. Same-tick damp precedes a new strike and thus affects that strike only at the following cycle. Damps are shifted into the next period where appropriate and retain the existing20ms envelope.

The25ms callback only wakes a750ms future scheduling window. Before starting, an exact periodic occupancy sweep counts pending, playing and delayed-ended owned nodes, including450ms release-delivery grace, and conservative peaks. Existing16owned and0.95headroom limits remain. Short loud/long-tail combinations may refuse safely; no stealing, cropping, source resample or cap increase. Current repeat is exclusive single-score playback; live pads/mix/export stop/edit paths are guarded. It is not yet a per-track owner adapter, and session-wide Stop must not be reused as individual track Stop in S6C.

Pause retains absolute frame offset and Repeat state; Resume rebuilds still-alive natural/damped tails using offsets and the same context. Stop cancels/fades existing voices, resets cursor/shared transport and retains the exact project. If a callback misses its scheduling horizon by more than10ms, playback stops with a recoverable localized error rather than bursting late hits. Loading/capture/export/navigation guards remain.

Repeat and grid view selection currently live in UI memory. They are not serialized into strict schema4. Schema5 clip.loop/lengthTicks, immutable original plus working source/origin-cap policy, eight desktop/four mobile tracks, count-in/overdub/history/EQ/limiter and microphoneP0 remain S6C; durable journal/portable bytes/hash/quota/WAV bundle adapters remain S7. The earlier S5 benchmark is not rerun or expanded as new integration evidence.

## Local checks and limits

Read the accompanying `qa-artifacts/v5-s6b-2026-10-15/REPORT.md` and machine receipts for final counts and SHA. The native QA adapter's paired global frame-label anomaly and independently validated sequential PCM method are documented in CAPTURE-CONTRACT.md; original failed receipts remain. Do not call that raw-label geometry PASS or claim all303seconds of PCM were compared when only the first30seconds were.

No physical listening, hardware microphone, onset calibration, Safari, Android/iOS, cultural classification or new asset quality approval was performed. Existing licensed samples are used unchanged. Guitar/suling and full V5 starter-demo/assets remain open. No source upload, permission/header/security/workflow change or release action is authorized by this slice. Owner feedback after live V4 testing goes into V5; it does not block continuing authorized V5 local development.
