"""Original CC0 one-shot percussion. Python standard library only; no source samples.
Reproducible seeds and physical/modal/envelope parameters are the source masters.
Listening/physical-device quality acceptance is separate from file verification.
"""
import array, datetime, hashlib, json, math, pathlib, random, sys, wave

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'internal/studio-kits'
RATE = 48000
ROLES = ['kick', 'snare', 'closed-hat', 'open-hat', 'clap', 'tom', 'rim', 'shaker']
DURATIONS = [.65, .35, .18, .7, .32, .55, .22, .24]
recipe = pathlib.Path(__file__)
manifest = {'schemaVersion': 1, 'version': '1.0.0', 'kind': 'one-shot', 'roleOrder': ROLES, 'kits': []}
for k, (kit_id, name) in enumerate([('ruang', 'Ruang'), ('arus', 'Arus')]):
    assets = []
    for i, (role, duration) in enumerate(zip(ROLES, DURATIONS)):
        rng = random.Random(70001 + 101 * i + 9001 * k)
        frames = round(duration * RATE)
        raw = []
        prev = low = phase = 0.0
        for n in range(frames):
            t = n / RATE
            noise = rng.uniform(-1, 1)
            low += (.18 if k else .28) * (noise - low)
            high = noise - low
            if role == 'kick':
                freq = (44 if k else 55) + (110 if k else 155) * math.exp(-t * 38)
                phase += 2 * math.pi * freq / RATE
                value = math.sin(phase) * math.exp(-t * (8 if k else 12)) + .16 * high * math.exp(-t * 190)
                if k: value += .12 * math.sin(phase * 2) * math.exp(-t * 16)
            elif role == 'snare':
                modes = sum(a * math.sin(2 * math.pi * f * t) for f, a in [(177 + k * 24, .65), (331, .25), (467, .1)])
                value = modes * math.exp(-t * 35) + (.75 if k else .65) * high * math.exp(-t * (16 if k else 23))
            elif role in ['closed-hat', 'open-hat']:
                metallic = sum(math.sin(2 * math.pi * f * (1 + k * .17) * t) for f in [3291, 4423, 5711, 7183, 8297]) / 5
                decay = 37 if role == 'closed-hat' else 8
                value = (.7 * high + .3 * metallic) * math.exp(-t * decay)
            elif role == 'clap':
                burst = sum(math.exp(-max(0, t - at) * 115) if t >= at else 0 for at in [0, .011, .024])
                value = (high * burst * .32 + low * math.exp(-t * 19) * .3) * (1 + .1 * k)
            elif role == 'tom':
                phase += 2 * math.pi * ((99 if k else 126) + 35 * math.exp(-t * 32)) / RATE
                value = (math.sin(phase) + .32 * math.sin(phase * 1.59) + .18 * math.sin(phase * 2.31)) * math.exp(-t * (12 if k else 15)) + .08 * high * math.exp(-t * 80)
            elif role == 'rim':
                value = sum(a * math.sin(2 * math.pi * f * t) * math.exp(-t * decay) for f, a, decay in [(811 + k * 170, .6, 65), (1637, .25, 85), (2813 + k * 227, .15, 95)]) + .12 * high * math.exp(-t * 180)
            else:
                value = high * math.exp(-t * 26) * (.65 + .35 * math.sin(2 * math.pi * (77 + k * 13) * t) ** 2)
            # Short attack and release suppress clicks without adding leading silence.
            value *= min(1, t / .0006) * min(1, (duration - t) / .012)
            raw.append(value)
            prev = noise
        peak = max(abs(v) for v in raw)
        target = .43 if role in ['kick', 'snare', 'tom'] else .34
        pcm = array.array('h', (round(v / peak * target * 32767) for v in raw))
        if sys.byteorder != 'little': pcm.byteswap()
        path = OUT / 'audio' / f'{kit_id}-{role}.wav'
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())
        data = path.read_bytes()
        assets.append({'id': role, 'assetPath': f'audio/{path.name}', 'sha256': hashlib.sha256(data).hexdigest(), 'frames': frames, 'sampleRate': RATE, 'channels': 1, 'durationSeconds': duration, 'gainTrim': .2 if i not in [2, 3, 7] else .14, 'licenseId': 'CC0-1.0', 'licensePath': 'LICENSE.txt', 'commercialUse': True, 'rawRedistribution': True, 'author': 'Perkusi.com original code synthesis', 'createdAt': '2026-10-11', 'sourceType': 'original seeded excitation/modal percussion synthesis; no external samples', 'sourceRecipe': 'scripts/make-studio-kits.py', 'sourceRecipeSha256': hashlib.sha256(recipe.read_bytes()).hexdigest(), 'attributionRequired': False, 'bytes': len(data)})
    manifest['kits'].append({'id': kit_id, 'name': name, 'assets': assets})
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print('Original 16 one-shots generated, bytes', sum(a['bytes'] for k in manifest['kits'] for a in k['assets']))
