from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,struct,time,math,gzip
import numpy as np
import scipy
from scipy.signal import resample_poly

q=Path('qa-artifacts/v4-s2-2026-10-13');manifest=json.loads((q/'PINNED-ACQUISITION-MANIFEST.json').read_text(encoding='utf-8'));gain=0.8;rows=[]
def wav_data(data):
 assert data[:4]==b'RIFF' and data[8:12]==b'WAVE'
 size=struct.unpack_from('<I',data,4)[0];assert size+8<=len(data)
 chunks=[];fmt=None;pcm=None;at=12
 while at+8<=size+8:
  tag=data[at:at+4];length=struct.unpack_from('<I',data,at+4)[0];assert at+8+length<=len(data)
  chunks.append({'id':tag.decode('ascii','replace'),'bytes':length})
  body=data[at+8:at+8+length]
  if tag==b'fmt ':fmt=struct.unpack_from('<HHIIHH',body,0)
  if tag==b'data':assert pcm is None;pcm=body
  at+=8+length+(length%2)
 assert fmt and pcm is not None
 audio_format,channels,rate,byte_rate,align,bits=fmt
 assert audio_format==1 and channels==2 and rate==44100 and align==4 and bits==16 and byte_rate==rate*align
 assert len(pcm)%align==0
 return np.frombuffer(pcm,dtype='<i2').reshape(-1,channels),chunks
def max_run(mask):
 positions=np.flatnonzero(np.diff(np.r_[False,mask,False].astype(np.int8)))
 return int(np.max(positions[1::2]-positions[::2])) if len(positions) else 0
def metrics(values,rate):
 x=values.astype(np.float64,copy=False);peaks=np.max(np.abs(x),axis=0);tail=x[-round(rate*.1):]
 rms=np.sqrt(np.mean(tail*tail,axis=0));envelope=np.max(np.abs(x),axis=1);peak=float(np.max(peaks));active=np.flatnonzero(envelope>peak*.01);late=np.flatnonzero(envelope>peak*.001)
 return {'frames':len(x),'rate':rate,'channels':2,'seconds':len(x)/rate,'peak':peaks.tolist(),'rms':np.sqrt(np.mean(x*x,axis=0)).tolist(),'last100msRMSdBFS':[20*math.log10(v) if v else -300 for v in rms],'firstAboveMinus40RelativeFrame':int(active[0]) if len(active) else None,'lastAboveMinus60RelativeFrame':int(late[-1]) if len(late) else None,'decodedFloat32Bytes':len(x)*2*4}
def write_pcm24(path,values,rate):
 quantized=np.rint(values*8388608).astype(np.int32)
 assert np.min(quantized)>=-8388608 and np.max(quantized)<=8388607
 payload=quantized.astype('<i4').view(np.uint8).reshape(-1,4)[:,:3].copy().tobytes()
 header=b'RIFF'+struct.pack('<I',36+len(payload))+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,2,rate,rate*6,6,24)+b'data'+struct.pack('<I',len(payload))
 path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(header+payload)
 reconstructed=quantized.astype(np.float64)/8388608
 return metrics(reconstructed,rate),float(np.max(np.abs(reconstructed-values))),len(header)+len(payload),hashlib.sha256(header+payload).hexdigest()

for i,row in enumerate(manifest['rows']):
 at=time.perf_counter();original=q/'originals'/row['relativePath'];data=original.read_bytes();assert len(data)==row['expectedBytes'] and hashlib.sha256(data).hexdigest()==row['wavSHA256'];raw,chunks=wav_data(data);assert len(raw)==row['expectedFrames'];normalized=raw.astype(np.float64)/32768
 source=metrics(normalized,44100);source['integerFullScaleMaxRunFrames']=[max_run((raw[:,c]==32767)|(raw[:,c]==-32768)) for c in range(2)];source['RIFFChunks']=chunks
 delivered=[]
 for rate in [44100,48000]:
  converted=normalized if rate==44100 else resample_poly(normalized,160,147,axis=0,window=('kaiser',8.6))
  assert len(converted)==(len(raw) if rate==44100 else math.ceil(len(raw)*160/147))
  candidate=converted*gain;assert np.max(np.abs(candidate))<=.95
  filename=f's{row["soundId"]}.wav';path=q/'delivery'/str(rate)/filename
  measured,error,bytes_,hash_=write_pcm24(path,candidate,rate)
  assert measured['decodedFloat32Bytes']<=32*1024*1024 and bytes_<=16*1024*1024
  delivered.append({'rate':rate,'path':path.relative_to(q).as_posix(),'assetPath':f'/sounds/cdm-porto-candidate/{rate}/{filename}','SHA256':hash_,'encodedBytes':bytes_,'gzipTransferEstimateBytes':len(gzip.compress(path.read_bytes(),compresslevel=6,mtime=0)),'metrics':measured,'maxPCM24QuantizationError':error,'durationDeltaSeconds':measured['seconds']-source['seconds'],'transformation':{'sourceSHA256':row['wavSHA256'],'uniformGain':gain,'perNoteNormalization':False,'codec':'RIFF_PCM24_LE','originalRate':44100,'deliveredRate':rate,'resampler':None if rate==44100 else 'scipy.resample_poly(up160,down147,Kaiser8.6,zero-phase/defaultconstantpad)','retune':False,'trim':False,'originalsModified':False,'ancillaryMetadata':'Not copied into delivery WAV; unchanged original and per-file notices retain provenance'}})
  del converted,candidate
 rows.append({'soundId':row['soundId'],'title':row['title'],'instrument':row['instrument'],'bank':row['bank'],'degree':row['degree'],'stroke':row['stroke'],'sourceSHA256':row['wavSHA256'],'sourcePath':original.relative_to(q).as_posix(),'sourceMetrics':source,'qualityFlags':row['qualityFlags'],'delivery':delivered,'auditAndDeriveSeconds':time.perf_counter()-at})
 if (i+1)%10==0:print('audited/derived',i+1,flush=True)
report={'atUTC':datetime.now(timezone.utc).isoformat(),'status':'PASS_101_ORIGINALS_202_PCM24_DELIVERY_CANDIDATES','gainPolicy':'Uniform0.8 across ensemble; protects headroom without per-note normalization; numerical safety not source-rail repair or listening acceptance','originalCount':101,'deliveryCount':202,'numpyVersion':np.__version__,'scipyVersion':scipy.__version__,'originalBytes':sum(r['expectedBytes'] for r in manifest['rows']),'deliveryBytes':sum(d['encodedBytes'] for r in rows for d in r['delivery']),'gzipEstimateBytes':sum(d['gzipTransferEstimateBytes'] for r in rows for d in r['delivery']),'gzipQualification':'Offline potential transfer estimate; no CDN/server compression/settings claim or production file','rows':rows,'qualifications':['Originals preserved/sha verified','No trimming/fades/laras retuning','PCM24quantization and48kresampling explicit','Native decode/tail/cache tests follow','Cultural/CentralJavanese/listening/seven qualityflags open','No production installation/hotlinks/FreesoundAPI']}
(q/'DERIVATIVE-MANIFEST.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
credits=['# Candidate audio provenance and attribution\n','Local S2 candidates only. Original works attributed to Digitopia_CdM / Digitópia, Casa da Música. Recording: Pedro Augusto and Rui Penha; editing: Pedro Augusto; support: Jorge Queijo and Maria Mónica.\n','Each recorded work is mapped to its individually evidenced CC BY 3.0 source page by the parent waveform audit. The collection software Artistic License 2.0 label is separate. Same-work correspondence is strong; an exact Freesound-original lossless checksum is unavailable. No cultural/listening/universal legal-warranty or production approval is asserted.\n','Licence: https://creativecommons.org/licenses/by/3.0/ ; legal code: https://creativecommons.org/licenses/by/3.0/legalcode.en . Preserve credit/title/source/licence and describe derivatives; no endorsement is implied.\n','Original WAVs are unchanged. Local delivery copies: uniform gain0.8, PCM24 WAV, full stereo duration;48kcopy explicitly resampled160/147 Kaiser8.6. No per-note normalization, tuning/laras change, trim or source-clipping repair.\n']
provenance=[]
for row,audit in zip(manifest['rows'],rows):
 provenance.append({**row,'attribution':{'creator':'Digitopia_CdM / Digitópia Casa da Música','recording':['Pedro Augusto','Rui Penha'],'editing':'Pedro Augusto','support':['Jorge Queijo','Maria Mónica'],'title':row['title'],'sourcePage':row['sourcePage'],'licenseURL':row['licenseURL'],'changes':'Local delivery uniformgain0.8, PCM24;48kresamplingexplicit; full originals preserved','endorsement':False},'sourceIdentity':{'GitCommit':manifest['commit'],'GitBlobSHA1':row['gitBlobSHA1'],'SHA256':row['wavSHA256'],'bytes':row['expectedBytes'],'format':'PCM16stereo44100','frames':row['expectedFrames']},'deliveredIdentities':audit['delivery'],'culturalStatus':'CENTRAL_JAVANESE_AND_LISTENING_UNVERIFIED','qualityStatus':'OPEN_FLAGS' if row['qualityFlags'] else 'NUMERIC_AUDIT_ONLY_NOT_LISTENED'})
 credits.append(f'\n- {row["title"]} (Freesound{row["soundId"]}) — Digitopia_CdM; {row["sourcePage"]}; CC BY3.0 {row["licenseURL"]}. OriginalSHA256 {row["wavSHA256"]}. Delivery transformations above; rawpath {row["relativePath"]}.')
(q/'PROVENANCE-101.json').write_text(json.dumps({'sourceKind':'Joined pinned rights + quantified work evidence + actual local originals/derivatives','rows':provenance},indent=2),encoding='utf-8')
(q/'ATTRIBUTION-101.md').write_text('\n'.join(credits),encoding='utf-8');print(json.dumps({k:report[k] for k in ['status','originalBytes','deliveryBytes','gzipEstimateBytes']}),flush=True)
