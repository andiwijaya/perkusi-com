"""First-party RFC9639 lossless PCM24 encoder0.1.0; not the libFLAC tool.
Only accepted stereo44.1/48k PCM24 WAV. Fixed4096 blocks, independent
channels, constant/verbatim/fixed2 subframes, Rice4 k0..14. No DSP/padding.
Uses already installed NumPy; does not install or vendor a codec library.
"""
from pathlib import Path
import sys,json,hashlib,struct,time,datetime,argparse
import numpy as np
BLOCK=4096
def table(bits,poly):
 out=[];mask=(1<<bits)-1
 for i in range(256):
  v=i<<(bits-8)
  for _ in range(8):v=((v<<1)^poly) if v&(1<<(bits-1)) else v<<1
  out.append(v&mask)
 return out
C8=table(8,0x07);C16=table(16,0x8005)
def crc(data,bits):
 value=0;t=C8 if bits==8 else C16;mask=(1<<bits)-1
 for b in data:value=((value<<8)^t[((value>>(bits-8))^b)&255])&mask
 return value
def bits(data):return np.unpackbits(np.frombuffer(data,dtype=np.uint8))
def pcm_bits(values):
 a=np.asarray(values,dtype=np.int64)&0xffffff
 return ((a[:,None]>>np.arange(23,-1,-1))&1).astype(np.uint8).reshape(-1)
def subframe(values):
 n=len(values)
 if np.all(values==values[0]):return np.r_[bits(b'\x00'),pcm_bits(values[:1])]
 if n<3:return np.r_[bits(b'\x02'),pcm_bits(values)]
 residual=values[2:]-2*values[1:-1]+values[:-2]
 unsigned=np.where(residual<0,-2*residual-1,2*residual)
 costs=[int(np.sum(unsigned>>k))+(n-2)*(k+1) for k in range(15)]
 k=int(np.argmin(costs));cost=8+48+10+costs[k]
 if cost>=8+n*24:return np.r_[bits(b'\x02'),pcm_bits(values)]
 quotients=unsigned>>k;lengths=quotients+k+1;offsets=np.cumsum(lengths)-lengths
 coded=np.zeros(int(np.sum(lengths)),dtype=np.uint8);coded[offsets+quotients]=1
 if k:
  positions=offsets[:,None]+quotients[:,None]+1+np.arange(k)
  coded[positions.reshape(-1)]=((unsigned[:,None]>>np.arange(k-1,-1,-1))&1).astype(np.uint8).reshape(-1)
 rice_header=np.r_[np.zeros(6,dtype=np.uint8),((k>>np.arange(3,-1,-1))&1).astype(np.uint8)]
 return np.r_[bits(b'\x14'),pcm_bits(values[:2]),rice_header,coded]
def number(value):
 assert value<65536
 return chr(value).encode('utf-8')
def encode(data,comments=None):
 assert data[:4]==b'RIFF' and data[8:12]==b'WAVE' and data[12:16]==b'fmt ' and data[36:40]==b'data'
 fmt,channels,rate,byte_rate,align,bps=struct.unpack_from('<HHIIHH',data,20)
 assert (fmt,channels,align,bps)==(1,2,6,24) and rate in [44100,48000] and byte_rate==rate*6
 payload=data[44:];assert len(payload)==struct.unpack_from('<I',data,40)[0] and len(payload)%6==0
 a=np.frombuffer(payload,dtype=np.uint8).reshape(-1,3).astype(np.int64)
 values=a[:,0]|(a[:,1]<<8)|(a[:,2]<<16);values=np.where(values&0x800000,values-0x1000000,values).reshape(-1,2)
 frames=[]
 for i,start in enumerate(range(0,len(values),BLOCK)):
  block=values[start:start+BLOCK];header=b'\xff\xf8'+bytes([(7<<4)|(9 if rate==44100 else 10),0x1c])+number(i)+struct.pack('>H',len(block)-1)
  header+=bytes([crc(header,8)]);body=np.packbits(np.r_[subframe(block[:,0]),subframe(block[:,1])]).tobytes();frame=header+body;frames.append(frame+struct.pack('>H',crc(frame,16)))
 packed=(rate<<44)|(1<<41)|(23<<36)|len(values)
 info=struct.pack('>HH',BLOCK,BLOCK)+min(map(len,frames)).to_bytes(3,'big')+max(map(len,frames)).to_bytes(3,'big')+packed.to_bytes(8,'big')+hashlib.md5(payload).digest()
 assert len(info)==34
 vendor=b'Perkusi lossless subset encoder0.1.0'
 items=[str(s).encode('utf-8') for s in (comments or [])]
 vorbis=struct.pack('<I',len(vendor))+vendor+struct.pack('<I',len(items))+b''.join(struct.pack('<I',len(s))+s for s in items)
 return b'fLaC\x00\x00\x00\x22'+info+b'\x84'+len(vorbis).to_bytes(3,'big')+vorbis+b''.join(frames)
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=Path.cwd());parser.add_argument('--deadline',default=None,help='Optional UTC ISO cutoff for a bounded QA run; not a codec parameter');args=parser.parse_args();root=args.root.resolve();deadline=datetime.datetime.fromisoformat(args.deadline.replace('Z','+00:00')) if args.deadline else None
 destination=root/'internal/gamelan-flac';manifest=json.loads((root/'internal/gamelan-delivery/asset-map.json').read_text(encoding='utf-8'));credits=json.loads((root/'internal/gamelan-delivery/credits.json').read_text(encoding='utf-8'));rows=[]
 assert len(manifest['files'])==202 and len(credits['rows'])==101
 credit_by_id={r['sampleId']:r for r in credits['rows']}
 for r in manifest['files']:
  if deadline and datetime.datetime.now(datetime.timezone.utc)>=deadline:raise RuntimeError('Safe checkpoint window: stop encoding')
  at=time.perf_counter();data=(root/r['sourcePath']).read_bytes();assert len(data)==r['bytes'] and hashlib.sha256(data).hexdigest()==r['sha256'];sound_id=Path(r['sourcePath']).stem[1:];credit=credit_by_id['fs-'+sound_id]
  comments=['TITLE='+credit['title'],'ARTIST='+credit['attribution']['creator'],'SOURCE='+credit['sourcePage'],'LICENSE='+credit['licenseURL'],'COMMENT=Lossless encoding of accepted Perkusi PCM24 delivery; original uniform0.8/resample notice retained. No additional DSP, trim, retune or padding. No endorsement.','PCM24_SHA256='+r['sha256']]
  flac=encode(data,comments);assert len(flac)<=r['bytes'] and len(flac)<=16*1024*1024
  p=destination/'audio'/str(r['rate'])/('s'+sound_id+'.flac');p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(flac)
  rows.append({'rate':r['rate'],'assetPath':f'/sounds/cdm-porto-flac-candidate/{r["rate"]}/s{sound_id}.flac','sourcePath':p.relative_to(root).as_posix(),'sha256':hashlib.sha256(flac).hexdigest(),'bytes':len(flac),'frames':r['frames'],'channels':r['channels'],'referencePCM':r,'pcm24MD5':hashlib.md5(data[44:]).hexdigest(),'encodeSeconds':time.perf_counter()-at})
  if len(rows)%20==0:print('Losslessly encoded',len(rows),flush=True)
 destination.mkdir(parents=True,exist_ok=True)
 result={'version':1,'name':'Perkusi lossless FLAC delivery candidate','codec':'FLAC24 independent-stereo fixed4096 constant/verbatim/fixed2 Rice4; full exact frames, no DSP','encoderVersion':'Perkusi subset0.1.0','encoderSourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'pythonVersion':sys.version,'numpyVersion':np.__version__,'newDependencies':False,'bytes':sum(r['bytes'] for r in rows),'files':rows,'status':'LOCAL_CANDIDATE_NATIVE_EXACTNESS_AND_REVIEW_PENDING'}
 (destination/'asset-map.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
 for rate in [44100,48000]:
  c=json.loads((root/f'internal/instrument-focus/registry-{rate}.json').read_text(encoding='utf-8'));by_pcm={r['referencePCM']['assetPath']:r for r in rows if r['rate']==rate}
  for bank in c['banks']:
   for sample in bank['samples']:
    if not sample['assetPath'].startswith('/sounds/cdm-porto-candidate/'):
     assert sample['assetPath'].startswith('/sounds/original-groove/')
     continue
    r=by_pcm[sample['assetPath']];assert sample['sha256']==r['referencePCM']['sha256'] and sample['frames']==r['frames'] and sample['sampleRate']==rate
    sample.update(assetPath=r['assetPath'],sha256=r['sha256'],encodedBytes=r['bytes'])
  (destination/f'registry-{rate}.json').write_text(json.dumps(c,indent=2)+'\n',encoding='utf-8')
 (destination/'encode-reference.py').write_bytes(Path(__file__).read_bytes())
 (destination/'NOTICE.txt').write_text('Perkusi FLAC delivery candidate, lossless packaging variant of accepted CDM Porto PCM24.\n\nAll101 work/title/creator/source/license/quality/rights records, CC BY3.0 text, Artistic2.0 library text and prior gain/resample changes remain in internal/gamelan-delivery/ and the credits page. This encoding adds no DSP, mono conversion, trim/fade/retune, padding or normalization. Full integer PCM24 MD5/SHA256 and original-to-FLAC map are in asset-map.json; every FLAC has embedded title/creator/source/license/change comments. No endorsement or legal/cultural/listening warranty.\n\nThe first-party limited encoder source encode-reference.py uses pre-existing NumPy1.26.4 and Python3.12. It implements the open RFC9639 format; no Xiph/libFLAC code/binary or new dependency is copied. This modified delivery source form and existing original library remain available under the preserved Artistic2.0 package terms described in the unchanged parent NOTICE and license, without changing the overall Perkusi application license. Upstream acquisition links and unchanged source/derivative reference recipes are retained. Original WAVs and accepted PCM files are untouched.\n\nNative decode compatibility and exactness must be validated before adoption; this is not production release. Numeric losslessness does not establish musical quality, one-set/region identity or acoustic completeness beyond the original recording.\n',encoding='utf-8')
 print(json.dumps({'files':len(rows),'pcmBytes':sum(r['referencePCM']['bytes'] for r in rows),'flacBytes':result['bytes'],'numpyVersion':np.__version__,'encoder':'first-party subset0.1.0','status':result['status']}),flush=True)
