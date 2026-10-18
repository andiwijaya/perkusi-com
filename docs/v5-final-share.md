# Local V5 final WAV Share ownership

AB closure for AA independent review P2/P3. This does not change accepted audio
DSP, export encoding, transport or project persistence. V4 is already live;
full V5 and release remain HOLD pending their gates.

Each FinalPanel Share captures its encoded result, filename and generation. One
operation may await native Share at a time; the button shows a localized pending
status and direct duplicate calls fail before allocation. Clear/render-new may
proceed, invalidating older fallback/status without changing the requested File.
An unchanged-current normal failure or unsupported API downloads the same result.
Success and AbortError create no fallback and retain the ready WAV.

The original encoded result is pinned throughout Share. A separate shared-ledger
reservation of File.size+8192bytes covers possible File backing and wrapper. The
File reference, reservation and pin release only when the actual native promise
settles, including failure/cancellation. Closing audio/navigation invalidates
fallback immediately but cannot abort the OS Share API. Close does not hang on a
pending OS dialog; its remaining File/result stay accounted until settlement.
A permanently pending native promise therefore intentionally retains those bytes
and blocks another Share in that panel. This is not an audio/context leak or a
claim about browser RSS. Destroying the document destroys that realm's resources.

Download object URLs also pin their original result through their existing URL
grace lifetime or explicit cleanup. Clear/close revoke owned URLs and release their
pins, without releasing a pending Share pin. A late render result after Clear/close
is released rather than republished. Every last owner releases the result once.

The EQ band/dB separator is ASCII ` | ` in both locales. Directed UI regressions
must verify actual labels/codepoints and Share4/Clear/Render8/old rejection without
an8bar substitution, including intermediate accounting and final cleanup. Mocked
native Share promises establish lifecycle behavior, not OS delivery or listening.
