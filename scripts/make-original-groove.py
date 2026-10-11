"""Original source/filter vocal-percussion candidate. CC0-1.0.

No recordings, samples, voice models, paid API or third-party DSP code.
The score and recipes are authored for Perkusi.com, not artist/voice imitation.
--pilot proves the route before --full creates the twelve-variation candidate.
Listening/musicality MUST remain UNVERIFIED until an actual audition.
"""
import argparse
import hashlib
import json
import math
import random
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / 'qa-artifacts/s3-2026-10-11'
BPM, BARS, BEATS, DURATION = 96, 2, 8, 5.0
ROLES = ['kick', 'snare', 'hat', 'vocal-bass', 'hum', 'percussion-fx']
TRIMS = dict(zip(ROLES, [.42, .30, .25, .38, .28, .20]))
PEAKS = dict(zip(ROLES, [.65, .50, .35, .60, .45, .42]))
SYLLABLES = {'kick': ['buh', 'bup'], 'snare': ['pf', 'psh'], 'hat': ['ts', 'tsh'], 'vocal-bass': ['doum', 'woum'], 'hum': ['mm', 'ng'], 'percussion-fx': ['ka-tik', 'tok-r']}
VOWELS = {'u': [(310, 80), (820, 100), (2350, 180)], 'o': [(430, 90), (920, 120), (2450, 200)], 'a': [(720, 100), (1260, 130), (2660, 200)], 'm': [(260, 65), (1100, 130), (2240, 200)]}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def resonances(source, bands, rate):
    """Independently written parallel two-pole oral resonances, stable r<1."""
    output = [0.0] * len(source)
    for band, (frequency, width) in enumerate(bands):
        r = math.exp(-math.pi * width / rate)
        c = 2 * r * math.cos(2 * math.pi * frequency / rate)
        r2, y1, y2 = r * r, 0.0, 0.0
        for i, value in enumerate(source):
            y = (1-r) * value + c*y1 - r2*y2
            y2, y1 = y1, y
            output[i] += y / (1 + band * .8)
    return output

def phrase(role, variant, duration, note, level, rng, rate):
    count = round(duration * rate)
    source, phase, slow, previous = [], 0.0, 0.0, 0.0
    fundamental = 440 * 2 ** ((note-69)/12)
    for i in range(count):
        t = i / rate
        white = rng.uniform(-1, 1)
        slow = .88 * slow + .12 * white
        high = white - slow
        if role in ['hum', 'vocal-bass', 'kick']:
            # Asymmetric opening/closing glottal flow, not a pure oscillator.
            pitch = fundamental * (1 + .004 * math.sin(2*math.pi*4.7*t))
            if role == 'kick':
                pitch *= 1 + .4 * math.exp(-t*40)
            elif role == 'vocal-bass':
                pitch *= 1 + .045 * math.exp(-t*18)
            phase = (phase + pitch / rate) % 1
            flow = (.5 * (1-math.cos(math.pi*phase/.42)) if phase < .42
                    else math.cos(math.pi*.5*(phase-.42)/.28) if phase < .70 else 0)
            radiation = flow - previous
            previous = flow
            source.append(radiation * 12 + high * (.028 if role == 'hum' else .06))
        elif role == 'snare':
            # Bilabial pressure release into breath/frication, with an oral body.
            release = math.exp(-t*105) * (1 if i % 9 < 4 else -.8)
            source.append(.85*high + .24*slow + .35*release)
        elif role == 'hat':
            source.append(high + .22 * (white-previous))
            previous = white
        else:
            # Tongue/velar release plus a short irregular flutter, not a drum sample.
            flutter = .5 + .5 * math.sin(2*math.pi*(43+variant*11)*t)
            source.append(high * flutter + .5 * math.exp(-t*90)*slow)
    if role == 'kick':
        bands = [(150+variant*30, 125), *VOWELS['u']]
    elif role == 'snare':
        bands = [(850, 340), (2100+variant*300, 650), (5100, 1900)]
    elif role == 'hat':
        bands = [(3200, 1100), (6200-variant*700, 1800), (9400, 2600)]
    elif role == 'vocal-bass':
        bands = VOWELS['u' if variant == 1 else 'o']
    elif role == 'hum':
        bands = VOWELS['m']
    else:
        bands = [(980+variant*240, 280), (2900, 450), (4900, 1100)]
    sound = resonances(source, bands, rate)
    # Radiation/DC correction, bounded articulation and a natural release.
    average = sum(sound) / max(1, len(sound))
    for i in range(count):
        t = i / rate
        attack = min(1, t / (.015 if role == 'hum' else .003))
        release = min(1, max(0, (duration-t) / (.055 if role in ['hum', 'vocal-bass'] else .025)))
        decay = math.exp(-t * (28 if role == 'kick' else 17 if role == 'snare' else 40 if role == 'hat' else 20 if role == 'percussion-fx' else 1.1))
        sound[i] = (sound[i]-average) * attack * release * decay * level
    return sound

def score(role, variant):
    if role == 'kick':
        beats = [0, 1.5, 2.75, 4, 5.5, 7] if variant == 1 else [0, 1.75, 3.5, 4, 5.75, 6.5, 7.5]
        return [(b, 38, .21, 1 if b in [0,4] else .75) for b in beats]
    if role == 'snare':
        return [(b, 50, .18 if variant == 1 else .22, 1) for b in [1,3,5,7]] + [(b, 50, .10, .27) for b in ([2.5,6.75] if variant == 1 else [.75,4.75])]
    if role == 'hat':
        return [(i/4, 70, .052 if i%4 != 2 else .13, .6 if i%2 else 1) for i in range(32) if variant == 2 or i%2 == 0]
    if role == 'vocal-bass':
        pattern = [(0,38,.9), (1.75,33,.55), (3,41,.6), (4,38,1.2), (6,36,.7), (7,33,.55)] if variant == 1 else [(0,38,.9),(1.5,41,.6),(2.75,33,.65),(4,38,1.1),(5.75,36,.7),(7,33,.5)]
        return [(b,n,d*60/BPM,1) for b,n,d in pattern]
    if role == 'hum':
        pattern = [(.5,62,1.2),(2,65,1.1),(4.5,57,1.2),(6.25,65,1.1)] if variant == 1 else [(.5,65,1.2),(2.25,69,.9),(4.5,62,1.2),(6.25,65,1.1)]
        return [(b,n,d*60/BPM,1) for b,n,d in pattern]
    return [(b,50,.105 if variant == 1 else .145,.65 if i%2 else 1) for i,b in enumerate([.75,2.25,3.75,5.25,6.75,7.75])]

def render(role, variant, rate):
    rng = random.Random(2026101100 + ROLES.index(role)*17 + variant)
    data = [0.0] * round(DURATION*rate)
    events = []
    for number, (beat,note,duration,level) in enumerate(score(role,variant)):
        # Subtle fixed breath timing; every file retains the exact same 8-beat grid.
        offset_seconds = .002 if number%2 else .001
        offset = round((beat*60/BPM + offset_seconds)*rate)
        signal = phrase(role,variant,duration,note,level,rng,rate)
        for i,value in enumerate(signal):
            if offset+i < len(data):
                data[offset+i] += value
        events.append({'beat':beat, 'offsetSeconds':offset_seconds,'noteMidi':note if role in ['hum','vocal-bass'] else None,'syllable':SYLLABLES[role][variant-1],'durationSeconds':duration,'velocity':level})
    peak = max(abs(v) for v in data)
    multiplier = PEAKS[role] / peak
    fade = round(.004*rate)
    for i in range(len(data)):
        data[i] *= multiplier
    for i in range(fade):
        data[i] *= i/fade
        data[-1-i] *= i/fade
    return data,events,multiplier

def write_wav(path, data, rate):
    path.parent.mkdir(parents=True,exist_ok=True)
    if max(abs(x) for x in data) >= .95:
        raise RuntimeError('Unsafe signal; fix the mix, never force a limiter')
    with wave.open(str(path),'wb') as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(rate)
        target.writeframes(b''.join(struct.pack('<h',round(x*32767)) for x in data))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase',choices=['pilot','full'],required=True)
    args = parser.parse_args()
    assert str(ROOT).lower() == 'c:\\perkusidotcom'
    full = args.phase == 'full'
    out = ROOT / 'internal/original-groove' if full else QA / 'pilot'
    out.mkdir(parents=True,exist_ok=True)
    assets,sums = [],{}
    for variant in ([1,2] if full else [1]):
        mix = [0.0]*160000
        for role in ROLES:
            data,events,multiplier = render(role,variant,32000)
            path = out / 'audio' / f'{role}-{variant}.wav'
            write_wav(path,data,32000)
            master,_,master_multiplier = render(role,variant,48000)
            master_path = QA / args.phase / 'masters-48k' / path.name
            write_wav(master_path,master,48000)
            for i,x in enumerate(data):
                mix[i] += x*TRIMS[role]*.65
            assets.append({'id':f'{role}-{variant}','role':role,'variant':variant,'assetPath':f'audio/{path.name}','sourceMaster':master_path.relative_to(ROOT).as_posix(),'masterSha256':digest(master_path),'sourceRecipe':'scripts/make-original-groove.py','sourceRecipeSha256':digest(Path(__file__)),'seed':2026101100+ROLES.index(role)*17+variant,'events':events,'sourceType':'original-procedural-mouth-synthesis','author':'Perkusi.com project / Codex','createdAt':'2026-10-11','licenseId':'CC0-1.0','licensePath':'LICENSE.txt','commercialUse':True,'rawRedistribution':True,'attributionRequired':False,'sha256':digest(path),'bytes':path.stat().st_size,'sampleRate':32000,'channels':1,'frames':160000,'durationSeconds':DURATION,'loopStart':0,'loopEnd':DURATION,'gainTrim':TRIMS[role],'peak':max(abs(x) for x in data),'rms':math.sqrt(sum(x*x for x in data)/len(data)),'derivation':{'method':'render original source/filter score directly at the target rate; peak scaling; DC correction per articulation; 4ms file-edge fades; mono PCM16','normalizationMultiplier':multiplier,'masterNormalizationMultiplier':master_multiplier},'listening':'UNVERIFIED','production':False,'acceptedVocalBeatbox':False})
        sums[variant] = mix
        write_wav(QA/args.phase/f'mix-variant-{variant}-4bars.wav',mix*2,32000)
    manifest = {'schemaVersion':1,'packId':'original-groove','version':'0.1.0-candidate','bpm':BPM,'meter':[4,4],'beatsPerBar':4,'bars':BARS,'key':'D minor','roleOrder':ROLES,'initialSelection':{role:1 for role in ROLES},'qualityStatus':'candidate; listening/musicality UNVERIFIED','supplyRoute':'original source/filter synthesis, no imported audio or voice model','licenseId':'CC0-1.0','production':False,'assets':assets}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    proof = {'phase':args.phase,'assets':len(assets),'bytes':sum(a['bytes'] for a in assets),'maxSixRolePeakBoundAtMasterMax':sum(PEAKS[r]*TRIMS[r] for r in ROLES)*.75,'mixPeaks':{v:max(abs(x) for x in mix) for v,mix in sums.items()},'generatorSha256':digest(Path(__file__)),'externalAudioOrModels':[],'paidServices':[],'listening':'UNVERIFIED','legalRoute':'project-authored score, code and generated files dedicated CC0; no third-party input'}
    (QA/args.phase/'generation-proof.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(proof))

if __name__ == '__main__':
    main()
