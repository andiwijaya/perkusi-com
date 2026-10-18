import { takePlan } from "../project/instrument-take.js";
import {
  instrumentVoice,
  INSTRUMENT_LEVEL,
  DAMP_SECONDS,
} from "./instrument-voice.js";
import { fail } from "../project/instrument-contract.js";
import { OwnedOutput } from "./owned-output.js";
import { prepareLegacyBus } from "./legacy-bus.js";
import { addInstrumentFrames, renderYield } from "./frame-dsp.js";
import { gamelanPlaybackScale } from "./gamelan-level.js";
import { programmeSample } from "./programme-output.js";
import {
  ProgrammeMeter,
  programmeGain,
  PROGRAMME_SCRATCH_BYTES,
} from "./programme-level.js";

export const RENDER_CHUNK_FRAMES = 65536;
export const MAX_RENDER_SECONDS = 90;
const cancelled = (signal) => {
  if (signal?.aborted) fail("cancelled");
};
export function wavAttributionChunk(text) {
  if (typeof text !== "string") fail("invalidExportAttribution");
  if (!text) return new Uint8Array(0);
  if (
    typeof text !== "string" ||
    text.includes("\0") ||
    new TextEncoder().encode(text).length > 65534
  )
    fail("invalidExportAttribution");
  const payload = new TextEncoder().encode(text + "\0"),
    bytes = new Uint8Array(20 + payload.length + (payload.length % 2)),
    view = new DataView(bytes.buffer);
  const label = (at, s) =>
    [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  label(0, "LIST");
  view.setUint32(4, bytes.length - 8, true);
  label(8, "INFO");
  label(12, "ICMT");
  view.setUint32(16, payload.length, true);
  bytes.set(payload, 20);
  return bytes;
}
export function instrumentWavHeader(
  frames,
  rate,
  metadata = new Uint8Array(0),
) {
  if (
    !Number.isInteger(frames) ||
    frames <= 0 ||
    ![44100, 48000].includes(rate) ||
    frames > rate * MAX_RENDER_SECONDS
  )
    fail("exportDurationLimit");
  const bytes = new ArrayBuffer(44 + frames * 4 + metadata.length),
    view = new DataView(bytes);
  const text = (offset, s) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 4, true);
  new Uint8Array(bytes).set(metadata, 44 + frames * 4);
  return { bytes, view };
}
// Same full source, level and explicit damp envelope in live and chunk render.
export function scheduleInstrumentChunk(
  context,
  output,
  buffer,
  voice,
  startFrame,
  rate,
  release = () => {},
) {
  const from = Math.max(startFrame, voice.startFrame);
  if (from >= voice.endFrame) return null;
  const damp = voice.dampFrame,
    fadeFrames = Math.round(DAMP_SECONDS * rate);
  const initial =
    damp !== null && from > damp
      ? Math.max(0, 1 - (from - damp) / fadeFrames)
      : 1;
  const v = instrumentVoice(
    context,
    output,
    buffer,
    (from - startFrame) / rate,
    voice.velocity,
    {
      offset: (from - voice.startFrame) / rate,
      initialLevel: initial,
      release,
    },
  );
  if (damp !== null) {
    if (damp >= from) v.damp((damp - startFrame) / rate);
    else {
      v.gain.gain.linearRampToValueAtTime(
        0,
        (damp + fadeFrames - startFrame) / rate,
      );
      try {
        v.source.stop((damp + fadeFrames - startFrame) / rate);
      } catch {
        /* Already ended. */
      }
    }
  }
  return v;
}
export async function renderInstrumentWav(
  value,
  {
    registry,
    cache,
    memory,
    rate,
    signal,
    yieldTask = renderYield,
    onProgress = () => {},
    attribution = "",
    matchProgramme = false,
    analysisOnly = false,
  },
) {
  cancelled(signal);
  const plan = takePlan(value, registry, rate);
  if (plan.frames > rate * MAX_RENDER_SECONDS) fail("exportDurationLimit");
  let metadataMemory, metadata, encoded;
  try {
    if (attribution)
      metadataMemory = memory.reserve(
        196640,
        "WAV attribution encoding scratch",
      );
    metadata = wavAttributionChunk(attribution);
    const encodedBytes = 44 + plan.frames * 4 + metadata.length;
    encoded = memory.reserve(
      analysisOnly ? 4096 : encodedBytes * 2,
      "WAV staging + Blob copy",
    );
  } catch (error) {
    metadataMemory?.release();
    throw error;
  }
  let completed = false,
    peak = 0,
    energy = 0,
    nonzero = false,
    passes = 0,
    legacy = null,
    meterLease;
  try {
    legacy = await prepareLegacyBus(plan.project, { memory, rate, signal });
    const wav = analysisOnly
      ? null
      : instrumentWavHeader(plan.frames, rate, metadata);
    if (matchProgramme || analysisOnly)
      meterLease = memory.reserve(
        PROGRAMME_SCRATCH_BYTES,
        "programme-export-meter",
      );
    const meter =
      matchProgramme || analysisOnly ? new ProgrammeMeter(rate) : null;
    let calibration = { gain: 1, metrics: null };
    const iterations = matchProgramme && !analysisOnly ? 2 : 1;
    for (let iteration = 0; iteration < iterations; iteration++) {
      if (iteration === 1) {
        const metrics = meter.result();
        calibration = {
          gain: programmeGain(metrics, plan.project.composition.master.volume),
          metrics,
        };
        peak = 0;
        energy = 0;
      }
      for (let start = 0; start < plan.frames; start += RENDER_CHUNK_FRAMES) {
        cancelled(signal);
        const frames = Math.min(RENDER_CHUNK_FRAMES, plan.frames - start),
          mixMemory = memory.reserve(frames * 8, "render accumulator");
        const mixed = [new Float32Array(frames), new Float32Array(frames)];
        try {
          if (legacy)
            for (let c = 0; c < 2; c++) {
              const data = legacy.buffer.getChannelData(c);
              mixed[c].set(
                data.subarray(start, Math.min(start + frames, data.length)),
              );
            }
          const sounding = plan.voices.filter(
              (v) => v.startFrame < start + frames && v.endFrame > start,
            ),
            groups = new Map();
          for (const v of sounding) {
            const list = groups.get(v.key) ?? [];
            list.push(v);
            groups.set(v.key, list);
          }
          for (const [, voices] of [...groups].sort(([a], [b]) =>
            a.localeCompare(b),
          )) {
            cancelled(signal);
            const first = voices[0];
            let loaded, held, scratch;
            try {
              loaded = await cache.acquire(
                first.bankId,
                first.version,
                first.sampleId,
                { signal },
              );
              held = loaded.retain();
              loaded.release();
              loaded = null;
              cancelled(signal);
              scratch = memory.reserve(
                8192,
                "deterministic voice/frame scratch",
              );
              for (const voice of voices) {
                addInstrumentFrames(
                  mixed,
                  held.buffer,
                  {
                    ...voice,
                    mix: {
                      ...voice.mix,
                      volume:
                        voice.mix.volume *
                        gamelanPlaybackScale(
                          registry.bank(voice.bankId, voice.version),
                          held.metrics.peak,
                        ),
                    },
                  },
                  start,
                  rate,
                  plan.project.composition.master.volume,
                );
                passes++;
                await yieldTask();
                cancelled(signal);
              }
            } finally {
              scratch?.release();
              held?.release();
              loaded?.release();
            }
          }

          if (meter && iteration === 0) meter.push(mixed[0], mixed[1]);
          for (let i = 0; i < frames; i++)
            for (let c = 0; c < 2; c++) {
              const raw = mixed[c][i] * calibration.gain,
                v =
                  matchProgramme && iteration === 1
                    ? programmeSample(raw)
                    : raw;
              if (!Number.isFinite(v) || Math.abs(v) > 0.950001)
                fail("unsafeOutput");
              peak = Math.max(peak, Math.abs(v));
              energy += v * v;
              const sample = Math.round(v * 32767);
              nonzero ||= sample !== 0;
              if (wav)
                wav.view.setInt16(44 + ((start + i) * 2 + c) * 2, sample, true);
            }
          onProgress({
            phase: "rendering",
            value: (iteration + (start + frames) / plan.frames) / iterations,
          });
        } finally {
          mixMemory.release();
        }
        await yieldTask();
      }
    }
    cancelled(signal);
    if (!nonzero) fail("emptyMix");
    if (analysisOnly) {
      const metrics = meter.result();
      return {
        frames: plan.frames,
        sampleRate: rate,
        peak,
        programmeCalibration: {
          gain: programmeGain(metrics, plan.project.composition.master.volume),
          metrics,
        },
      };
    }
    const blob = new Blob([wav.bytes], { type: "audio/wav" });
    completed = true;
    return Object.assign(new OwnedOutput(blob, encoded), {
      frames: plan.frames,
      sampleRate: rate,
      channels: 2,
      peak,
      rms: Math.sqrt(energy / plan.frames / 2),
      passes,
      programmeCalibration: calibration,
    });
  } finally {
    legacy?.release();
    meterLease?.release();
    // eslint-disable-next-line no-useless-assignment -- Drop the transient metadata before releasing its scratch admission.
    metadata = null;
    metadataMemory?.release();
    if (!completed) encoded.release();
  }
}
export function plannedHeadroom(plan, metrics, master = 0.65) {
  const points = [];
  for (const v of plan.voices) {
    const level =
      metrics.get(v.key).peak *
      v.velocity *
      INSTRUMENT_LEVEL *
      master *
      (v.mix?.volume ?? 1) *
      (v.mix?.pan ? Math.SQRT2 : 1);
    points.push(
      { frame: v.startFrame, level },
      { frame: v.endFrame, level: -level },
    );
  }
  points.sort((a, b) => a.frame - b.frame || a.level - b.level);
  let sum = 0,
    max = 0;
  for (const p of points) {
    sum += p.level;
    max = Math.max(max, sum);
  }
  return max;
}
