# V4 production-delivery candidate: lossless FLAC24

Adopt **FLAC24 for the opt-in delivery candidate**, retaining the canonical PCM preview as the rollback build. This is a local engineering candidate for independent review, not permission to change the live homepage, default build, hosting settings or publish. Owner cutoff October14 is17:00WIB/10:00UTC; reporting stays in this task and local QA, with no direct report message/retry to another thread.

## Decision and measured costs

|Delivery|44.1k101 files|48k101 files|Complete202 files|
|---|---:|---:|---:|
|Accepted PCM24|229,773,496 B|250,093,504 B|479,867,000 B|
|Standard gzip level6|117,811,843 B|209,153,293 B|326,965,136 B|
|First-party subset FLAC24|118,391,709 B|126,585,674 B|244,977,383 B|

Gzip is competitive at44.1k, but saves only16.37% at48k. FLAC saves48.95% overall and49.38% at48k, and needs no HTTP compression setting or browser decoder library. Default Saron PL48k drops15,320,882 to8,090,585bytes; worst SL Slenthem drops38,125,630 to18,746,343bytes. On a calibrated single global4Mbps+150ms-header simulator, native Chrome/Edge/Firefox FLAC default focus is ready in17.5-17.8s and worst focus in38.7-38.9s; Chrome PCM takes32.0s/77.9s respectively. These are controlled Windows desktop measurements, not real WAN/mobile/Safari promises.

All202 canonical WAV bytes reconstruct through gzip. Native raw/gzip all-sample comparisons1,212 and FLAC606 full-corpus decodes at both rates pass. FLAC retains every integer sample, channel and available tail; no additional gain, resampling, trim, normalization, retune or acoustic padding. Native FLAC decode median21.45ms, p9578.7ms, max242ms in the full-corpus laptop run. Decoded Float32 memory is **unchanged**; compression lowers transfer and encoded transient admission, not the resident sample geometry.

## Tooling and bounded format

No package is installed or vendored. Existing Playwright FFmpeg1011 only encodes PNG/VP8; native AudioEncoder FLAC is unsupported on the three tested browsers. The first-party `scripts/gamelan-flac-encode.py` subset encoder0.1.0 uses already installed Python3.12/NumPy1.26.4. It implements fixed4096 blocks, independent stereo, constant/verbatim/fixed2 subframes with Rice4 k0-14, CRC8/CRC16, canonical PCM MD5 and embedded source/title/creator/license/change comments. It is not the Xiph/libFLAC reference encoder or a general input-file converter.36 native technical vectors cover short/final1-frame blocks, exact4096 boundaries, UTF8 frame number128, silence/constant/ramp/random/full-scale signed values and the CRC check vectors. Those synthetic fixtures stay QA-only.

The [FLAC format specification](https://www.rfc-editor.org/rfc/rfc9639.html) defines these lossless constructs. [Xiph's licensing explanation](https://xiph.org/flac/license.html) distinguishes the open format from its BSD libraries/GPL utilities; no such implementation is copied here. The existing package's Artistic2 source-form terms and the individual recorded works' documented CC BY3 attribution remain separate. Full101 credits, both unchanged license texts, original source links/recipe and quality observations are carried. The new reference encoder, encoded map, per-rate registries and change notice are included; publication still requires source-form/rights-credit review. No legal warranty or global application relicensing is asserted.

Reproduce from the complete existing accepted sources with:

```powershell
python scripts/gamelan-flac-encode.py --root C:\PerkusiDotCom
```

An optional `--deadline <UTC ISO>` is a QA stop guard, not a codec parameter. The normal recipe never expires. Canonical PCM/source files remain untouched and separately hashed; manifests link each FLAC to its PCM SHA/MD5 and pinned work identity. Frozen evidence must never be overwritten by reproduction.

## Integration and conservative budgets

Only `gamelan-preview` plus explicit process flag selects FLAC:

```powershell
$env:PERKUSI_GAMELAN_DELIVERY='flac'
node node_modules/vite/bin/vite.js build --mode gamelan-preview --outDir qa-artifacts/<fresh-review-output>
```

Omit the flag or set `pcm` for the original transport. Default `npm run build` ignores the opt-in flag and retains existing live entries; homepage/headers/analytics/stack/nameservers stay as accepted. The two catalogue aliases change only asset URI, encoded SHA and byte length; bank IDs/versions/work IDs/frames/rates/tuning/gain/voice policy and all Original Groove descriptors stay exact. Thus existing schema4 projects, origin text and combined composition remain losslessly editable. Trusted registry validation merely adds `.flac`; imports cannot install arbitrary descriptors or remote URLs. No DSP/cache/session/schema/renderer code changes.

The build verifies every canonical PCM source, encoded source/copy and catalogue transformation before accepting the selected transport. `scripts/gamelan-delivery-budget.mjs` enforces202 files,101 per rate,8MiB/file,128MiB/profile,256MiB/corpus,19MiB/physical focus,52MiB decoded focus,8MiB default Saron focus. Actual application admission remains64MiB with unchanged32MiB per decoded buffer and16MiB encoded registry bound. The network acceptance recommendation is cold UI<=1MiB with0 audio before gesture, default focus<=20s and full physical focus<=45s on the global4Mbps/150ms simulator. These are additional candidate gates; no existing cap/deadline is raised to pass.

[Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/) currently state25MiB per asset and20,000 Free-plan files. Largest candidate FLAC is6,381,637bytes; complete static output is checked against the file/count limits. This is deployability evidence, not deployment. [Cloudflare's documented compression types](https://developers.cloudflare.com/speed/optimization/content/compression/) omit audio from automatic compression eligibility, so raw-WAV gzip savings cannot be assumed on the live CDN. The selected FLAC is a normal self-contained static file and does not need a compression-rule/security change.

Application focus changes intentionally trim unpinned decoded entries. Standard browser HTTP cache may retain files; persistence and maximum cacheable file sizes are not promised. Replay held leases provide measured decoded-cache hits without fetch/decode. SHA protects complete encoded content before native decode; exact shape/headroom checks follow decode. Cancelled native results retain admission until settlement and cannot rearm. TCP cut/corruption/cancel/retry and foreign-owner pressure gates are in the closing QA packet. Production CDN/ETag/revalidation policy and receipts still need a separately authorized release check; do not add immutable caching to fixed candidate URIs without a content-version policy.

## Remaining release gates

First-party encoder/candidate review; actual Android/iOS/Safari/devices, speakers/headphones/listening/onset/sustained-play/RSS/slow-network/CDN/OS share; competent one-set/Central-Javanese/demo review and seven source quality dispositions; full a11y/SEO/GA/source-form/rights-credit publication and production SHA/authorization. Exact digital samples do not establish traditional authenticity, acoustic completeness beyond the recordings or musical approval. No V5/V6 is started and no commit/push/Actions/deploy/microphone/settings action is authorized by this packet.
