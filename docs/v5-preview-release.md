# V5 Preview release

V5 adds Loop Station Preview alongside Beatbox Playground, Rhythm Studio and Gamelan Preview. Indonesian remains the default, with English routes and UI. The release uses the existing repository/main and Cloudflare Pages integration; GitHub Actions is not required.

The reviewed source is `730158148eafeb3dde82cbf5bd9d79cc666833ae9b0be8d7ae583f61f3819df7`, local build `21f0a607-51a7-4edb-a243-8f1afe1c5f7e`. Independent review closed the eight-track export memory and upper-master live/WAV protection findings. The owner accepted loudness parity with Beatbox as the reference and authorized this V5 Preview deployment on 18 October 2026. Production verification is recorded separately after deployment.

- Eight tracks, instrument and explicit local mic recording, take recovery, waveform/state feedback, mixer/EQ, pattern/loop tools, undo/redo and audio-bearing `.perkusi` projects.
- Four/eight-bar WAV export includes natural tails. Score exports use bounded source windows and sequential WAV chunks within the existing 64 MiB combined ownership budget. The same smooth final output protection applies to live and exported audio; it is not a certified true-peak limiter.
- Optional local device profiles remain explicitly uncalibrated. No measured hardware-latency claim is made. Monitoring is opt-in and initially off; mic activation requires a deliberate user action.
- Existing stored PCM is not rewritten. New Saron/Slenthem input and takes are approximately 5.5 dB louder than the earlier input calibration. Captured/mixed projects retain unity programme gain, while high-level output receives the shared final guard. Existing saved masters remain intact.
- Microphone permission is allowed only for the six exact ID/EN Loop Station document paths. Camera/geolocation and other pages retain denial. No cross-origin mic delegation or broader CSP allowance is added.

Owner acceptance does not establish acoustic safety, measured device latency, Safari/mobile/Bluetooth qualification or Central Javanese cultural classification. Those limitations remain visible and unverified where evidence is absent. Suling is deferred from V5. No login, upload service, database, paid API, new analytics property or nameserver change is included.

The V4 rollback baseline is commit `9a7f4a38e720639b8a6a70276bada0f127156f25`, existing Pages deployment `79854fd8-5065-4932-a3a1-9c12ff9eb657`. A separately authorized rollback can restore that deployment or use a normal reviewed revert; never force-push or clear browser storage. Preserve audio-bearing project/WAV backups and the V5 IndexedDB/draft/profile keys; V4 cannot edit V5 audio projects.
