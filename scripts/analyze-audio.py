"""Inspect actual source/QA WAV files; listening remains a separate manual gate."""
import hashlib
import json
import math
import struct
import wave
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = root / 'qa-artifacts/s2-2026-10-11'
registry = json.loads((root / 'internal/audio/fixtures/provenance.json').read_text(encoding='utf-8'))
results, signals = [], []
paths = [root / asset['file'] for asset in registry['assets']] + [out / 'fixture-mix-4bars.wav']
for path in paths:
    with wave.open(str(path), 'rb') as wav:
        channels, width, rate, frames = wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()
        assert width == 2 and channels == 1
        data = [sample[0] / 32768 for sample in struct.iter_unpack('<h', wav.readframes(frames))]
    peak = max(abs(x) for x in data)
    rms = math.sqrt(sum(x*x for x in data) / len(data))
    onset = next((i / rate for i, x in enumerate(data) if abs(x) > .001), None)
    max_jump = max(abs(a-b) for a,b in zip(data[1:],data[:-1]))
    result = {'path': path.relative_to(root).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'sampleRate': rate, 'frames': frames, 'channels': channels, 'durationSeconds': frames / rate, 'peak': peak, 'rms': rms, 'onsetSecondsAbove001': onset, 'maxAdjacentJump': max_jump, 'firstSample': data[0], 'lastSample': data[-1], 'listening': 'UNVERIFIED'}
    assert 0.001 < peak < .95 and rms > .001 and onset is not None and onset < .1
    assert data[0] == 0
    if path.parent.name == 'fixtures':
        asset = next(a for a in registry['assets'] if path.name == Path(a['file']).name)
        assert result['sha256'] == asset['sha256']
        assert frames == 240000 and rate == 48000 and frames / rate == 5
        assert data[-1] == 0
        result['fileWrapJump'] = abs(data[0] - data[-1])
    else:
        assert frames / rate == 10
        period = 5 * rate
        result['repeatMaxDeltaAfterInitialMicrofade'] = max(abs(data[i] - data[i+period]) for i in range(round(.01*rate),period))
        assert result['repeatMaxDeltaAfterInitialMicrofade'] < .0001
    results.append(result)
    signals.append((path.stem, rate, data))
headroom_bound = sum(asset['peak'] * .85 for asset in registry['assets']) * .75
assert headroom_bound < .95
(out / 'wav-analysis.json').write_text(json.dumps({'result': 'PASS', 'listening': 'UNVERIFIED', 'maximumMasterWorstCasePeakBound': headroom_bound, 'files': results}, indent=2), encoding='utf-8')

# Optional static waveform artifact, using an installed standard plotting library.
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
fig, axes = plt.subplots(len(signals), 1, figsize=(12, 8), constrained_layout=True)
for axis, (name, rate, data) in zip(axes, signals):
    stride = max(1, rate // 4000)
    axis.plot([i / rate for i in range(0, len(data), stride)], data[::stride], linewidth=.5)
    axis.set_title(name + ' — technical fixture, NOT accepted vocal pack', fontsize=10)
    axis.set_ylabel('Amplitude'); axis.set_ylim(-.5,.5); axis.grid(alpha=.2)
axes[-1].set_xlabel('Time (seconds)')
fig.savefig(out / 'waveforms.png', dpi=140)
plt.close(fig)
print(json.dumps({'result':'PASS', 'files':len(results), 'maximumMasterWorstCasePeakBound':headroom_bound, 'output':str(out/'wav-analysis.json')}))
