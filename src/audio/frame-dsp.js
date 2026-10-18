// V4 frame contract. The ordinary V1-V3 voice/renderer is unchanged.
export const f32 = Math.fround;
export const attackFrames = (rate) => Math.round(0.0006 * rate);
export const releaseFrames = (rate) => Math.round(0.004 * rate);
export const dampFrames = (rate) => Math.round(0.02 * rate);
export const frameTime = (time, rate) => Math.round(time * rate) / rate;
export const renderYield = () =>
  new Promise((resolve) => setTimeout(resolve, 0));

export function shotEnvelope(frame, length, rate, choke = null) {
  const attack = Math.min(length, attackFrames(rate));
  const release = Math.min(length, releaseFrames(rate));
  const natural = (n) =>
    n < 0 || n >= length ? 0 : Math.min(1, n / attack, (length - n) / release);
  return choke !== null && frame >= choke
    ? f32(natural(choke) * Math.max(0, 1 - (frame - choke) / release))
    : f32(natural(frame));
}

export function panMatrix(pan, mono = false) {
  if (mono) {
    const angle = ((pan + 1) * Math.PI) / 4;
    return [f32(Math.cos(angle)), 0, f32(Math.sin(angle)), 0];
  }
  if (pan === 0) return [1, 0, 0, 1];
  if (pan < 0) {
    const angle = ((pan + 1) * Math.PI) / 2;
    return [1, f32(Math.cos(angle)), 0, f32(Math.sin(angle))];
  }
  const angle = (pan * Math.PI) / 2;
  return [f32(Math.cos(angle)), 0, f32(Math.sin(angle)), 1];
}

export function addInstrumentFrames(mixed, buffer, voice, start, rate, master) {
  const begin = Math.max(start, voice.startFrame);
  const end = Math.min(start + mixed[0].length, voice.endFrame);
  const source = [
    buffer.getChannelData(0),
    buffer.getChannelData(buffer.numberOfChannels - 1),
  ];
  const volume = f32(voice.mix?.volume ?? 1),
    pan = voice.mix?.pan ?? 0;
  const level = f32(voice.velocity * 0.25),
    gain = f32(master);
  // Instrument live routing bypasses StereoPanner at exact center. A mono
  // buffer therefore duplicates at unity, unlike the legacy kit's always-on
  // equal-power panner. Preserve that existing level contract.
  const matrix =
    pan === 0 ? [1, 0, 0, 1] : panMatrix(pan, buffer.numberOfChannels === 1);
  for (let n = begin; n < end; n++) {
    const envelope =
      voice.dampFrame !== null && n >= voice.dampFrame
        ? Math.max(0, 1 - (n - voice.dampFrame) / dampFrames(rate))
        : 1;
    const voiceGain = f32(level * envelope),
      index = n - voice.startFrame;
    const left = f32(f32(source[0][index] * voiceGain) * volume);
    const right = f32(f32(source[1][index] * voiceGain) * volume);
    const a = f32(f32(left * matrix[0]) + f32(right * matrix[1]));
    const b = f32(f32(left * matrix[2]) + f32(right * matrix[3]));
    mixed[0][n - start] = f32(mixed[0][n - start] + f32(a * gain));
    mixed[1][n - start] = f32(mixed[1][n - start] + f32(b * gain));
  }
}

// Parse the trusted same-rate integer WAV without native PCM scaling variance.
// Rate conversion retains the existing native decoder; never silently substitute
// a different resampler to obtain a green cross-browser check.
export async function decodeCanonicalWav(context, data) {
  if (typeof context.createBuffer !== "function")
    return context.decodeAudioData(data);
  const view = new DataView(data),
    text = (at) => String.fromCharCode(...new Uint8Array(data, at, 4));
  if (data.byteLength < 44 || text(0) !== "RIFF" || text(8) !== "WAVE")
    throw Error("Invalid canonical WAV");
  let format, pcm;
  const end = view.getUint32(4, true) + 8;
  if (end > data.byteLength) throw Error("Truncated canonical WAV");
  for (let at = 12; at + 8 <= end;) {
    const size = view.getUint32(at + 4, true),
      begin = at + 8;
    if (begin + size > end) throw Error("Truncated canonical WAV chunk");
    if (text(at) === "fmt ") {
      if (size < 16) throw Error("Invalid WAV format");
      format = {
        kind: view.getUint16(begin, true),
        channels: view.getUint16(begin + 2, true),
        rate: view.getUint32(begin + 4, true),
        align: view.getUint16(begin + 12, true),
        bits: view.getUint16(begin + 14, true),
      };
    }
    if (text(at) === "data") {
      if (pcm) throw Error("Duplicate WAV data");
      pcm = { begin, size };
    }
    at = begin + size + (size % 2);
  }
  if (
    !format ||
    !pcm ||
    format.kind !== 1 ||
    ![1, 2].includes(format.channels) ||
    ![16, 24].includes(format.bits) ||
    format.align !== (format.channels * format.bits) / 8 ||
    pcm.size % format.align
  )
    throw Error("Unsupported canonical WAV");
  if (format.rate !== context.sampleRate) return context.decodeAudioData(data);
  const frames = pcm.size / format.align,
    buffer = context.createBuffer(format.channels, frames, format.rate);
  for (let c = 0; c < format.channels; c++) {
    const target = buffer.getChannelData(c);
    for (let n = 0; n < frames; n++) {
      const at = pcm.begin + n * format.align + (c * format.bits) / 8;
      const integer =
        format.bits === 16
          ? view.getInt16(at, true)
          : view.getUint8(at) |
            (view.getUint8(at + 1) << 8) |
            (view.getInt8(at + 2) << 16);
      target[n] = integer / 2 ** (format.bits - 1);
    }
  }
  return buffer;
}
