import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { preview } from "vite";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"),
  );
}
const output =
  process.env.PERKUSI_AUDIO_QA_DIR || "qa-artifacts/s2-repair-2026-10-11";
const dist =
  process.env.PERKUSI_AUDIO_DIST ||
  "qa-artifacts/s2-repair-2026-10-11/prototype-dist";
const channel = process.env.PERKUSI_AUDIO_CHANNEL || "chrome";
await mkdir(output, { recursive: true });
const server = await preview({
  mode: "audio-prototype",
  build: { outDir: dist },
  preview: { host: "127.0.0.1", port: 4184, strictPort: true },
});
const evidence = {
  checkedAt: new Date().toISOString(),
  channel,
  checks: [],
  errors: [],
  headless: true,
  physicalDevice: "UNVERIFIED",
  listening: "UNVERIFIED",
  result: "RUNNING",
};
let browser;
async function check(name, action) {
  const detail = await action();
  evidence.checks.push({ name, result: "PASS", detail });
  console.log("PASS " + name);
}
try {
  browser = await playwright.chromium.launch({ channel, headless: true });
  evidence.browser = browser.version();
  const page = await browser.newPage({ locale: "en-US" });
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  await page.goto("http://127.0.0.1:4184/internal/audio/?lang=en");
  await page.waitForFunction(() => window.perkusiAudioQA?.voice);
  await check(
    "R1 native sample continuity: attack, repeat lifecycle fade, overlap cancel, future attack; native/fallback/throwing API",
    async () => {
      const rows = await page.evaluate(async () => {
        const { createLoopVoice, fadeOutVoice, cancelFade, disconnectVoice } =
          window.perkusiAudioQA.voice;
        const rows = [];
        for (const api of ["native", "missing", "throws"])
          for (const scenario of [
            "attack-pause",
            "repeated-fade",
            "pause-reset-dispose-chain",
            "overlap-cancel",
            "future-attack-fade",
            "future-attack-cancel",
          ]) {
            const context = new OfflineAudioContext(1, 4800, 48000);
            const buffer = context.createBuffer(1, 240000, 48000);
            buffer.getChannelData(0).fill(0.25);
            const voice = createLoopVoice(
              context,
              context.destination,
              { stem: { id: "qa-constant", gainTrim: 1 }, buffer },
              { duration: 5 },
              0,
            );
            const nativeAvailable =
              typeof voice.gain.gain.cancelAndHoldAtTime === "function";
            if (api !== "native")
              Object.defineProperty(voice.gain.gain, "cancelAndHoldAtTime", {
                value:
                  api === "missing"
                    ? undefined
                    : () => {
                        throw new Error("QA unsupported hold");
                      },
              });
            let at, rendered;
            if (scenario.startsWith("future-")) {
              at = 0.002;
              fadeOutVoice(voice, at);
              if (scenario === "future-attack-cancel") cancelFade(voice, at);
              rendered = await context.startRendering();
            } else {
              if (scenario !== "attack-pause") fadeOutVoice(voice, 0.02);
              const suspended = context.suspend(
                scenario === "attack-pause" ? 0.001 : 0.021,
              );
              const rendering = context.startRendering();
              await suspended;
              at = context.currentTime;
              if (scenario === "overlap-cancel") cancelFade(voice, at);
              else {
                fadeOutVoice(voice, at);
                if (scenario === "pause-reset-dispose-chain") {
                  fadeOutVoice(voice, at);
                  fadeOutVoice(voice, at);
                }
              }
              await context.resume();
              rendered = await rendering;
            }
            const data = rendered.getChannelData(0),
              sample = Math.round(at * 48000);
            let maxAdjacentDelta = 0,
              prefixDelta = 0;
            for (let i = 1; i < data.length; i++)
              maxAdjacentDelta = Math.max(
                maxAdjacentDelta,
                Math.abs(data[i] - data[i - 1]),
              );
            if (scenario.startsWith("future-"))
              for (let i = 0; i < sample; i++)
                prefixDelta = Math.max(
                  prefixDelta,
                  Math.abs(data[i] - (0.25 * i) / (48000 * 0.004)),
                );
            else
              for (let i = 0; i < sample; i++) {
                const t = i / 48000;
                const expected =
                  scenario === "attack-pause" || t < 0.02
                    ? 0.25 * Math.min(t / 0.004, 1)
                    : 0.25 * Math.max(0, 1 - (t - 0.02) / 0.004);
                prefixDelta = Math.max(
                  prefixDelta,
                  Math.abs(data[i] - expected),
                );
              }
            rows.push({
              api,
              scenario,
              nativeAvailable,
              at,
              sample,
              before: data[sample - 1],
              after: data[sample],
              jump: data[sample] - data[sample - 1],
              maxAdjacentDelta,
              maximumSmoothStep: 0.25 / (48000 * 0.004),
              prefixDelta,
              transitionWindow: Array.from(
                data.slice(sample - 12, sample + 24),
              ),
            });
            disconnectVoice(voice);
          }
        return rows;
      });
      await writeFile(
        join(output, "native-waveforms.json"),
        JSON.stringify(rows, null, 2),
      );
      for (const row of rows) {
        assert(
          row.maxAdjacentDelta <= row.maximumSmoothStep * 1.05 + 1e-7,
          JSON.stringify(row),
        );
        assert(row.prefixDelta < 1e-6, JSON.stringify(row));
      }
      return {
        cases: rows.length,
        nativeHoldAvailable: rows[0].nativeAvailable,
        worstAdjacentDelta: Math.max(
          ...rows.map((row) => row.maxAdjacentDelta),
        ),
        allowedSmoothStep: rows[0].maximumSmoothStep * 1.05 + 1e-7,
      };
    },
  );
  await check(
    "R1 waveform detector positive control catches the old full-trim step",
    async () => {
      const result = await page.evaluate(async () => {
        const { createLoopVoice, disconnectVoice } =
          window.perkusiAudioQA.voice;
        const c = new OfflineAudioContext(1, 4800, 48000),
          b = c.createBuffer(1, 240000, 48000);
        b.getChannelData(0).fill(0.25);
        const v = createLoopVoice(
          c,
          c.destination,
          { stem: { id: "qa-negative-control", gainTrim: 1 }, buffer: b },
          { duration: 5 },
          0,
        );
        const paused = c.suspend(0.001),
          rendering = c.startRendering();
        await paused;
        const at = c.currentTime;
        // Intentionally reproduce the rejected old algorithm only inside this test.
        v.gain.gain.cancelScheduledValues(at);
        v.gain.gain.setValueAtTime(1, at);
        v.gain.gain.linearRampToValueAtTime(0, at + 0.004);
        await c.resume();
        const data = (await rendering).getChannelData(0),
          i = Math.round(at * 48000);
        const result = {
          at,
          jump: data[i] - data[i - 1],
          smoothStep: 0.25 / (48000 * 0.004),
        };
        disconnectVoice(v);
        return result;
      });
      assert(result.jump > result.smoothStep * 20);
      return result;
    },
  );
  await check(
    "R2 native-decoded held result times out logically; retry wins and stale result cannot overwrite",
    async () => {
      return await page.evaluate(async () => {
        const e = window.perkusiAudioPrototype,
          Bank = e.bank.constructor;
        const native = new AudioContext({ sampleRate: 48000 });
        const stem = e.pack.stems[0],
          pack = { ...e.pack, stems: [stem] };
        const bytes = await (await fetch(stem.url)).arrayBuffer();
        const bank = new Bank(pack, {
          timeoutMs: 500,
          fetcher: async () => ({
            ok: true,
            arrayBuffer: async () => bytes.slice(0),
          }),
        });
        let release, decodedReady;
        const held = new Promise((resolve) => {
          release = resolve;
        });
        const nativeReady = new Promise((resolve) => {
          decodedReady = resolve;
        });
        const start = performance.now();
        try {
          const old = bank.load(stem.id, {
            decodeAudioData: async (data) => {
              const b = await native.decodeAudioData(data);
              decodedReady();
              await held;
              return b;
            },
          });
          await nativeReady;
          const logical = await old;
          if (
            logical !== null ||
            bank.get(stem.id).state !== "error" ||
            bank.get(stem.id).error !== "timeout"
          )
            throw new Error("Decode deadline did not terminate");
          const settledMs = performance.now() - start;
          const fresh = await bank.load(stem.id, native);
          if (!fresh || bank.get(stem.id).state !== "ready")
            throw new Error("Retry did not load");
          release();
          await Promise.resolve();
          await Promise.resolve();
          if (bank.get(stem.id).buffer !== fresh)
            throw new Error("Stale decode replaced retry");
          return {
            deadlineMs: 500,
            logicalSettledMs: settledMs,
            nativeDecodeHeldArtificially: true,
            retryState: bank.get(stem.id).state,
            retainedNewBuffer: true,
            pendingRequest: !!bank.get(stem.id).request,
            pendingTimeout: bank.get(stem.id).timeout,
          };
        } finally {
          release();
          bank.dispose();
          await native.close();
        }
      });
    },
  );
  await check(
    "R2 never-returning decode and dispose-after-timeout are terminal; canceled generation can retry",
    async () => {
      const result = await page.evaluate(async () => {
        const e = window.perkusiAudioPrototype,
          Bank = e.bank.constructor,
          stem = e.pack.stems[0],
          pack = { ...e.pack, stems: [stem] };
        const native = new AudioContext({ sampleRate: 48000 });
        const bytes = await (await fetch(stem.url)).arrayBuffer();
        const fetcher = async () => ({
          ok: true,
          arrayBuffer: async () => bytes.slice(0),
        });
        const rows = [];
        try {
          const never = new Bank(pack, { timeoutMs: 150, fetcher });
          const pending = never.load(stem.id, {
            decodeAudioData: async (data) => {
              await native.decodeAudioData(data);
              return await new Promise(() => {});
            },
          });
          if (
            (await pending) !== null ||
            never.get(stem.id).error !== "timeout"
          )
            throw new Error("Never decode was not bounded");
          rows.push({
            case: "never-return",
            state: never.get(stem.id).state,
            error: never.get(stem.id).error,
          });
          never.dispose();
          for (const action of ["timeout-dispose", "cancel-replace"]) {
            const bank = new Bank(pack, {
              timeoutMs: action === "timeout-dispose" ? 150 : 1000,
              fetcher,
            });
            let release, decoded;
            const hold = new Promise((resolve) => {
              release = resolve;
            });
            const ready = new Promise((resolve) => {
              decoded = resolve;
            });
            const old = bank.load(stem.id, {
              decodeAudioData: async (data) => {
                const b = await native.decodeAudioData(data);
                decoded();
                await hold;
                return b;
              },
            });
            await ready;
            let newBuffer;
            if (action === "timeout-dispose") {
              if ((await old) !== null) throw new Error("Deadline missed");
              bank.dispose();
            } else {
              bank.cancelLoading();
              if ((await old) !== null)
                throw new Error("Cancel did not settle");
              newBuffer = await bank.load(stem.id, native);
            }
            release();
            await Promise.resolve();
            await Promise.resolve();
            const entry = bank.get(stem.id);
            if (
              action === "timeout-dispose"
                ? entry.state !== "disposed" || entry.buffer !== null
                : entry.state !== "ready" || entry.buffer !== newBuffer
            )
              throw new Error("Late publication after " + action);
            rows.push({
              case: action,
              state: entry.state,
              pendingPromise: !!entry.promise,
              pendingTimeout: entry.timeout,
            });
            bank.dispose();
          }
          return rows;
        } finally {
          await native.close();
        }
      });
      return result;
    },
  );
  assert.deepEqual(evidence.errors, []);
  evidence.result = "PASS";
} catch (error) {
  evidence.result = "FAIL";
  evidence.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
  console.error(error);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
  await writeFile(
    join(output, "repair-browser.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      result: evidence.result,
      channel,
      browser: evidence.browser,
      checks: evidence.checks.length,
      output,
    }),
  );
}
