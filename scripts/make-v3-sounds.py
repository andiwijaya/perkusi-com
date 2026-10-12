"""Original modern Indonesia-inspired hand percussion and struck metal keys.
No sampled recordings or imitation of an identifiable performer. Python standard
library only (PSF license); recipe/source masters and all generated audio CC0-1.0.
This is not traditional tuning or an authenticity claim. Listening UNVERIFIED.
"""
import array, hashlib, json, math, pathlib, random, sys, wave
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'internal/v3-sounds'; RATE=48000
roles=['kick','snare','closed-hat','open-hat','clap','tom','rim','shaker']
durations=[.7,.4,.18,.65,.28,.65,.22,.28]
assets=[]; recipeHash=hashlib.sha256(pathlib.Path(__file__).read_bytes().replace(b'\r\n',b'\n')).hexdigest()
for i,(identity,duration) in enumerate(list(zip(roles,durations))+[(p,1.4) for p in ['d4','f4','g4','a4','c5']]):
 rng=random.Random(93017+i*719); frames=round(duration*RATE); raw=[]; low=phase=0
 for n in range(frames):
  t=n/RATE; noise=rng.uniform(-1,1); low+=.15*(noise-low); high=noise-low
  if i>=8:
   f=[293.664768,349.228231,391.995436,440,523.251131][i-8]
   v=sum(a*math.sin(2*math.pi*f*r*t)*math.exp(-t*d) for r,a,d in [(1,.55,3.2),(2.756,.24,4.8),(5.404,.12,8),(8.932,.06,13),(13.352,.03,22)])+.06*high*math.exp(-t*180)
  elif identity in ['kick','snare','tom']:
   f={'kick':64,'snare':184,'tom':108}[identity]; phase+=2*math.pi*(f+f*.65*math.exp(-t*42))/RATE
   v=(math.sin(phase)+.45*math.sin(phase*1.593)+.24*math.sin(phase*2.136)+.12*math.sin(phase*2.92))*math.exp(-t*(10 if identity!='snare' else 19))
   v+=high*(.12 if identity=='kick' else .42 if identity=='snare' else .23)*math.exp(-t*75)
  elif identity in ['closed-hat','open-hat']:
   v=(.5*high+.5*sum(math.sin(2*math.pi*f*t) for f in [2459,3471,4939,6827])/4)*math.exp(-t*(39 if identity=='closed-hat' else 9))
  elif identity=='clap':
   v=high*sum(.25*math.exp(-(t-at)*125) if t>=at else 0 for at in [0,.008,.017])+.25*math.sin(2*math.pi*432*t)*math.exp(-t*34)
  elif identity=='rim':
   v=sum(a*math.sin(2*math.pi*f*t)*math.exp(-t*d) for f,a,d in [(1077,.58,55),(2081,.28,83),(3719,.14,105)])+.1*high*math.exp(-t*185)
  else:v=high*math.exp(-t*25)*(.5+.5*math.sin(2*math.pi*97*t)**2)
  raw.append(v*min(1,t/.0006)*min(1,(duration-t)/.012))
 peak=max(map(abs,raw)); target=.48 if i>=8 or identity in ['kick','snare','tom'] else .34
 pcm=array.array('h',(round(v/peak*target*32767) for v in raw))
 if sys.byteorder!='little':pcm.byteswap()
 name=('bilah-' if i>=8 else 'fusion-')+identity+'.wav'; path=OUT/'audio'/name; path.parent.mkdir(parents=True,exist_ok=True)
 with wave.open(str(path),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(RATE);w.writeframes(pcm.tobytes())
 data=path.read_bytes()
 assets.append(dict(id=identity,assetPath='audio/'+name,sha256=hashlib.sha256(data).hexdigest(),frames=frames,sampleRate=RATE,channels=1,durationSeconds=duration,gainTrim=.16 if i>=8 else .18 if i not in [2,3,7] else .12,licenseId='CC0-1.0',licensePath='LICENSE.txt',commercialUse=True,rawRedistribution=True,author='Perkusi.com original code synthesis',createdAt='2026-10-11',sourceType='original seeded membrane/metal/excitation synthesis; no external samples',sourceRecipe='scripts/make-v3-sounds.py',sourceRecipeSha256=recipeHash,attributionRequired=False,bytes=len(data),seed=93017+i*719))
manifest=dict(schemaVersion=1,version='1.0.0',kind='one-shot',roleOrder=roles,kits=[dict(id='fusion',name='Nusantara Fusion',assets=assets[:8])],instrument=dict(id='bilah',version='1.0.0',key='D minor',assets=assets[8:]),listening='UNVERIFIED',identity='Original contemporary fusion inspired by Indonesian hand percussion. Not traditional recordings, not an authentic regional rhythm or tuning claim.')
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
(OUT/'LICENSE.txt').write_text('CC0 1.0 Universal\nPerkusi.com dedicates this original recipe and generated audio to the public domain under CC0-1.0. Commercial use and raw redistribution permitted; no attribution required.\nLicense: https://creativecommons.org/publicdomain/zero/1.0/legalcode\nPython runtime license: https://docs.python.org/3/license.html (PSF); standard library only. No external recordings, paid tools, model-generated sounds or third-party samples.\n')
print('Generated',len(assets),'original waveforms;',sum(a['bytes'] for a in assets),'bytes. Listening UNVERIFIED.')
