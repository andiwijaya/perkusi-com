"""Original deterministic DSP test signals, NOT accepted V1 vocal recordings.

No source recordings, model weights, third-party samples or external libraries.
Raw generated WAV bytes and this generator are dedicated under CC0-1.0.
"""
import hashlib
import json
import math
import random
import struct
import wave
from pathlib import Path

RATE = 48000
BPM = 96
BARS = 2
SECONDS = BARS * 4 * 60 / BPM
root = Path(__file__).resolve().parents[1]
out = root / 'internal/audio/fixtures'
out.mkdir(parents=True, exist_ok=True)
rng = random.Random(20261011)
count = round(SECONDS * RATE)
stems = {name: [0.0] * count for name in ['thump', 'air', 'hum']}

def add(name, beat, signal):
    offset = round(beat * 60 / BPM * RATE)
    for i, sample in enumerate(signal):
        if offset + i < count:
            stems[name][offset + i] += sample

# Lip-like low transient with noise excitation, not a metronome sine beep.
for beat, level in [(0, .34), (1.5, .18), (2.75, .26), (4, .34), (5.75, .23), (7, .27)]:
    samples, phase, noise_lp = [], 0.0, 0.0
    for i in range(round(.25 * RATE)):
        t = i / RATE
        phase += 2 * math.pi * (53 + 82 * math.exp(-t * 35)) / RATE
        noise_lp = .75 * noise_lp + .25 * rng.uniform(-1, 1)
        attack = min(1, t / .002)
        samples.append(level * attack * (math.sin(phase) * math.exp(-t * 23) + .16 * noise_lp * math.exp(-t * 65)))
    add('thump', beat, samples)

# Breath-like filtered noise accents and short hats.
for half in range(16):
    beat = half / 2
    accent = half in [2, 6, 10, 14]
    length = .17 if accent else .065
    samples, previous, low = [], 0.0, 0.0
    for i in range(round(length * RATE)):
        t = i / RATE
        white = rng.uniform(-1, 1)
        low = .9 * low + .1 * white
        high = white - low
        shaped = .65 * high + .35 * previous
        previous = high
        env = min(1, t / .002) * math.exp(-t * (27 if accent else 65))
        samples.append((.24 if accent else .105) * shaped * env)
    add('air', beat, samples)

# D-minor harmonic phrase with vowel-like harmonic weighting and breath.
for beat, note, duration in [(0, 50, 1.5), (2, 53, 1.25), (4, 57, 1.5), (6, 53, 1.5)]:
    freq = 440 * 2 ** ((note - 69) / 12)
    samples = []
    seconds = duration * 60 / BPM
    for i in range(round(seconds * RATE)):
        t = i / RATE
        env = min(1, t / .018, max(0, (seconds - t) / .065))
        phase = 2 * math.pi * freq * t + .012 * math.sin(2 * math.pi * 4.5 * t)
        voiced = sum(weight * math.sin(h * phase) for h, weight in [(1, .7), (2, .18), (3, .12), (5, .08), (7, .04)])
        samples.append(.22 * env * (voiced + .015 * rng.uniform(-1, 1)))
    add('hum', beat, samples)

registry = []
for name, data in stems.items():
    # File-edge guard; the pattern also ends with natural silence.
    fade = round(.004 * RATE)
    for i in range(fade):
        data[i] *= i / fade
        data[-1-i] *= i / fade
    path = out / (name + '.wav')
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(b''.join(struct.pack('<h', round(max(-1, min(1, x)) * 32767)) for x in data))
    registry.append({'file': path.relative_to(root).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size, 'frames': count, 'sampleRate': RATE, 'channels': 1, 'durationSeconds': SECONDS, 'peak': max(abs(x) for x in data), 'rms': math.sqrt(sum(x*x for x in data)/count), 'role': name, 'production': False, 'acceptedVocalBeatbox': False, 'licenseId': 'CC0-1.0', 'source': 'scripts/make-audio-fixtures.py', 'author': 'Perkusi.com project engineering / Codex', 'date': '2026-10-11', 'method': 'Original deterministic Python standard-library DSP; no samples/voice models/recordings', 'attributionRequired': False, 'commercialUse': True, 'rawRedistribution': True})
(out / 'provenance.json').write_text(json.dumps({'packId': 's2-technical-fixture', 'version': 1, 'purpose': 'Technical synchronization test; NOT V1 sound-quality acceptance', 'bpm': BPM, 'beatsPerBar': 4, 'bars': BARS, 'key': 'D minor', 'assets': registry}, indent=2), encoding='utf-8')
print(json.dumps({'result': 'GENERATED', 'assets': registry}))
