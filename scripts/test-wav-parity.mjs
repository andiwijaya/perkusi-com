import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { preview } from "vite";
import {
  newComposition,
  withPatternLoops,
  newCompositionClip,
} from "../src/project/composition-model.js";
import { withKendhang } from "../src/project/kendhang.js";
import { withBass } from "../src/project/bass.js";
import { withGuitar } from "../src/project/guitar.js";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"),
  );
}
const output = process.env.PERKUSI_WAV_QA_DIR || "qa-artifacts/wav-parity";
await mkdir(output, { recursive: true });
const remote = process.env.PERKUSI_WAV_BASE_URL;
const server = remote
  ? null
  : await preview({
      preview: { host: "127.0.0.1", port: 4183, strictPort: true },
    });
const sourceBase = remote || "http://127.0.0.1:4183";
const base = "http://127.0.0.1:4184";
const resources = {};
const csp = (await readFile("public/_headers", "utf8"))
  .split("Content-Security-Policy: ")[1]
  .split(/\r?\n/)[0]
  .trim();
const evidence = {
  date: new Date().toISOString(),
  sourceBase,
  base,
  checks: [],
  errors: [],
  humanListening: false,
  result: "RUNNING",
};
const captureProcessor = `
class WavQACapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.at = 0; this.data = [new Float32Array(4096), new Float32Array(4096)];
    this.port.onmessage = () => {
      this.at = 0; this.data = [new Float32Array(4096), new Float32Array(4096)];
      this.port.postMessage({ reset: true });
    };
  }
  process(inputs, outputs) {
    const input = inputs[0];
    if (!this.at) this.frame = currentFrame;
    const length = outputs[0][0].length;
    for (let c = 0; c < 2; c++) {
      const channel = input[c] || input[0];
      if (channel) this.data[c].set(channel, this.at);
      else this.data[c].fill(0, this.at, this.at + length);
    }
    this.at += length;
    if (this.at === 4096) {
      this.port.postMessage({ frame: this.frame, data: this.data }, this.data.map(a => a.buffer));
      this.data = [new Float32Array(4096), new Float32Array(4096)]; this.at = 0;
    }
    return true;
  }
}
registerProcessor('wav-qa-capture', WavQACapture);`;
// Chromium's worklet module requests bypass Playwright routing. Serve a local
// capture module next to byte-identical upstream responses; keep the real CSP.
// This adds no QA asset or capture hook to the published product.
const proxy = createServer(async (req, res) => {
  try {
    if (req.url === "/__wav-qa-capture.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      res.end(captureProcessor);
      return;
    }
    const response = await fetch(sourceBase + req.url);
    const bytes = Buffer.from(await response.arrayBuffer());
    const headers = Object.fromEntries(response.headers);
    delete headers["content-encoding"];
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    if (
      headers["content-type"]?.includes("text/html") &&
      !headers["content-security-policy"]
    )
      headers["content-security-policy"] = csp;
    if (/\.(js|wav|flac)(\?|$)/.test(req.url))
      resources[req.url] = createHash("sha256").update(bytes).digest("hex");
    res.writeHead(response.status, headers);
    res.end(bytes);
  } catch (error) {
    res.writeHead(502);
    res.end(error.message);
  }
});
await new Promise((resolve) => proxy.listen(4184, "127.0.0.1", resolve));
const catalog = JSON.parse(
  await readFile("internal/original-groove/manifest.json", "utf8"),
);
const beatbox = (all = false) => ({
  format: "perkusi-project",
  schemaVersion: 1,
  mode: "beatbox",
  title: all ? "Variants parity" : "First mix parity",
  pack: { id: catalog.packId, version: catalog.version },
  timing: { bpm: 96, meter: [4, 4] },
  master: { volume: all ? 0.37 : 0.65 },
  tracks: catalog.roleOrder.map((role, i) => ({
    role,
    enabled: all || ["kick", "hat", "vocal-bass"].includes(role),
    variant: all && i % 2 ? 2 : 1,
  })),
  export: { bars: all ? 8 : 4 },
});
const studio = () =>
  withGuitar(
    withBass(
      withKendhang(withPatternLoops(newComposition("First beat parity"))),
    ),
  );
const first = studio();
first.timing.bpm = 100;
first.chain = Array(4).fill("p1");
for (const [role, indices] of Object.entries({
  kick: [0, 4, 8, 12],
  snare: [4, 12],
  "closed-hat": [0, 2, 4, 6, 8, 10, 12, 14],
}))
  for (const i of indices) first.patterns[0].steps[role][i] = 0.7;
const swing = structuredClone(first);
swing.title = "Swing mixer parity";
swing.pack.id = "arus";
swing.timing.bpm = 137;
swing.timing.swing = 0.32;
swing.patterns.push({
  ...structuredClone(swing.patterns[0]),
  id: "p2",
  name: "B",
});
swing.patterns[1].steps.kick = Array(16).fill(0);
swing.patterns[1].steps.kick[3] = 1;
swing.patterns[1].steps.snare[15] = 0.45;
swing.activePattern = "p2";
swing.chain = ["p1", "p2", "p2", "p1"];
swing.tracks[0].pan = -0.8;
swing.tracks[0].volume = 0.5;
swing.tracks[1].pan = 0.65;
swing.tracks[1].volume = 0.4;
swing.tracks[0].solo = swing.tracks[1].solo = true;
swing.tracks[2].mute = true;
const composition = studio();
composition.title = "Pattern instruments parity";
composition.timing.bpm = 96;
composition.patterns.push({
  ...structuredClone(composition.patterns[0]),
  id: "p2",
  name: "B",
});
composition.activePattern = "p2";
composition.chain = ["p1", "p2", "p1", "p2"];
for (const [pi, p] of composition.patterns.entries()) {
  for (const i of [0, 6, 10]) p.steps.kick[i] = 0.55;
  p.steps.snare[pi ? 13 : 4] = 0.6;
  p.clips = [
    {
      ...newCompositionClip("hat"),
      enabled: true,
      variant: pi + 1,
      volume: pi ? 0.3 : 0.6,
      pan: pi ? -0.6 : 0.6,
    },
  ];
  p.notes[0] = { pitch: pi ? "g4" : "d4", velocity: 0.45 };
  p.notes[11] = { pitch: "a4", velocity: 0.6 };
  p.kendhang.tak[3] = 0.5;
  p.kendhang.thung[12] = 0.6;
  p.bassNotes[2] = { pitch: "e1", velocity: 0.6 };
  p.bassNotes[8] = { pitch: pi ? "b1" : "g1", velocity: 0.5 };
  p.guitarNotes[1] = { pitch: "e3", velocity: 0.5 };
  p.guitarNotes[7] = { pitch: "e3", velocity: 0.65 };
  p.guitarNotes[10] = { pitch: "g3", velocity: 0.6 };
}
composition.instrument.pan = -0.4;
composition.guitar.pan = 0.5;
const cases = [
  { name: "beatbox-first", tool: "beatbox", project: beatbox() },
  { name: "beatbox-variants-8bars", tool: "beatbox", project: beatbox(true) },
  { name: "studio-first", tool: "studio", project: first },
  {
    name: "studio-live-mix-edit",
    tool: "studio",
    project: first,
    liveEdit: true,
  },
  { name: "studio-swing-solo-pan", tool: "studio", project: swing },
  { name: "studio-pattern-instruments", tool: "studio", project: composition },
].filter(
  (c) =>
    !process.env.PERKUSI_WAV_CASE ||
    c.name.includes(process.env.PERKUSI_WAV_CASE),
);

// Instrument only the real-time destination. The app and WAV renderer keep
// their own graphs, clock and controls. No microphone or lossy recorder is used.
function installCapture() {
  const qa = (window.__wavQA = {
    chunks: [],
    frames: 0,
    starts: [],
    active: false,
    rate: 0,
  });
  const connect = AudioNode.prototype.connect;
  const start = AudioBufferSourceNode.prototype.start;
  const render = OfflineAudioContext.prototype.startRendering;
  OfflineAudioContext.prototype.startRendering = function () {
    if (!qa.holdRender) return render.call(this);
    qa.renderBlocked = true;
    return new Promise((resolve, reject) => {
      qa.releaseRender = () => {
        qa.holdRender = false;
        render.call(this).then(resolve, reject);
      };
    });
  };
  AudioNode.prototype.connect = function (destination, ...args) {
    const result = connect.call(this, destination, ...args);
    if (
      destination === this.context.destination &&
      this.context instanceof AudioContext &&
      !qa.settingUp
    ) {
      qa.settingUp = true;
      qa.rate = this.context.sampleRate;
      this.context.audioWorklet
        .addModule(new URL("/__wav-qa-capture.js", location.href))
        .then(() => {
          qa.node = new AudioWorkletNode(this.context, "wav-qa-capture", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          });
          qa.node.port.onmessage = ({ data }) => {
            if (data.reset) {
              qa.chunks = [];
              qa.frames = 0;
              qa.resetDone = true;
              qa.active = true;
              return;
            }
            if (!qa.active) return;
            qa.chunks.push([data.frame / qa.rate, ...data.data]);
            qa.frames += data.data[0].length;
          };
          connect.call(this, qa.node);
          connect.call(qa.node, destination);
          qa.ready = true;
        })
        .catch((error) => {
          qa.error = error.message;
        });
    }
    return result;
  };
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (qa.active && this.context instanceof AudioContext)
      qa.starts.push({
        when: args[0],
        offset: args[1] || 0,
        length: this.buffer?.length,
      });
    return start.apply(this, args);
  };
}
function parseWav(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  let fmt, data;
  for (let p = 12; p + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", p, p + 4),
      length = bytes.readUInt32LE(p + 4);
    if (id === "fmt ")
      fmt = {
        encoding: bytes.readUInt16LE(p + 8),
        channels: bytes.readUInt16LE(p + 10),
        rate: bytes.readUInt32LE(p + 12),
        bits: bytes.readUInt16LE(p + 22),
      };
    if (id === "data") data = bytes.subarray(p + 8, p + 8 + length);
    p += 8 + length + (length % 2);
  }
  assert.equal(fmt.encoding, 1);
  assert.equal(fmt.bits, 16);
  const channels = Array.from(
    { length: fmt.channels },
    () => new Float32Array(data.length / 2 / fmt.channels),
  );
  for (let i = 0; i < channels[0].length; i++)
    for (let c = 0; c < fmt.channels; c++)
      channels[c][i] = data.readInt16LE((i * fmt.channels + c) * 2) / 32767;
  return { ...fmt, channels, frames: channels[0].length };
}
function compare(live, wav, rate, startGuess = null) {
  const onset = (arrays) => {
    for (let i = 0; i < arrays[0].length; i++)
      if (arrays.some((a) => Math.abs(a[i]) > 0.0001)) return i;
    throw Error("Silent audio");
  };
  const guess = startGuess ?? onset(live) - onset(wav),
    from = Math.round(rate * 0.04),
    to = wav[0].length - Math.round(rate * 0.015);
  let best = { correlation: -1 };
  for (let shift = guess - 32; shift <= guess + 32; shift++) {
    if (shift < 0 || shift + to >= live[0].length) continue;
    let xy = 0,
      xx = 0,
      yy = 0,
      ee = 0,
      peakError = 0;
    for (let c = 0; c < wav.length; c++)
      for (let i = from; i < to; i += 3) {
        const x = live[c][i + shift],
          y = wav[c][i],
          d = x - y;
        xy += x * y;
        xx += x * x;
        yy += y * y;
        ee += d * d;
        peakError = Math.max(peakError, Math.abs(d));
      }
    const correlation = xy / Math.sqrt(xx * yy);
    if (correlation > best.correlation)
      best = {
        shift,
        correlation,
        normalizedError: Math.sqrt(ee / yy),
        levelDb: 10 * Math.log10(xx / yy),
        peakError,
      };
  }
  return best;
}

let browser;
try {
  browser = await playwright.chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  evidence.browser = browser.version();
  for (const item of cases) {
    console.log("CHECK " + item.name);
    const ctx = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    await ctx.route(/googletagmanager\.com|google-analytics\.com/, (route) =>
      route.fulfill({ status: 200, body: "" }),
    );
    await ctx.addInitScript(installCapture);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => evidence.errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    try {
      await writeFile(
        join(output, item.name + ".perkusi.json"),
        JSON.stringify(item.project, null, 2),
      );
      assert.equal(
        (
          await page.goto(
            base +
              "/" +
              (item.tool === "studio" ? "studio" : "beatbox") +
              "/?lang=id",
            { waitUntil: "domcontentloaded", timeout: 60000 },
          )
        ).status(),
        200,
      );
      const st = item.tool === "studio",
        prefix = st ? "st" : "project";
      await page.waitForFunction(
        (st) =>
          document.querySelector(st ? "#st-preload" : "#bb-preload")?.dataset
            .state === "ready",
        st,
        { timeout: 90000 },
      );
      console.log("IMPORT " + item.name);
      await page.locator(`#${prefix}-file`).setInputFiles({
        name: item.name + ".perkusi.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(item.project)),
      });
      await page.waitForFunction(
        ({ st, title }) =>
          document.querySelector(st ? "#st-title" : "#project-title").value ===
            title &&
          !document.querySelector(st ? "#st-play" : "#bb-play").disabled &&
          document.querySelector(st ? "#st-preload" : "#bb-preload").dataset
            .state === "ready",
        { st, title: item.project.title },
        { timeout: 90000 },
      );
      await page.waitForFunction(
        () => window.__wavQA.ready || window.__wavQA.error,
      );
      assert.equal(await page.evaluate(() => window.__wavQA.error), undefined);
      const seconds = st
        ? (item.project.chain.length * 240) / item.project.timing.bpm
        : item.project.export.bars * 2.5;
      console.log("CAPTURE " + item.name);
      let captureCycle = 0;
      await page.evaluate(() => {
        window.__wavQA.active = true;
      });
      await page.locator(st ? "#st-play" : "#bb-play").click();
      if (item.liveEdit) {
        await page.waitForFunction(() => window.__wavQA.starts.length > 0);
        for (const role of ["kick", "snare", "closed-hat"]) {
          const slider = page.locator(`[data-st-volume="${role}"]`);
          await slider.press("Home");
          for (let i = 0; i < 20; i++) await slider.press("ArrowRight");
        }
        await page.evaluate(() => {
          const q = window.__wavQA;
          q.active = false;
          q.resetDone = false;
          q.node.port.postMessage({ reset: true });
        });
        await page.waitForFunction(() => window.__wavQA.resetDone);
        await page.waitForFunction(() => window.__wavQA.chunks.length > 0);
        captureCycle = await page.evaluate((seconds) => {
          const q = window.__wavQA;
          return Math.max(
            1,
            Math.ceil((q.chunks[0][0] + 0.1 - q.starts[0].when) / seconds),
          );
        }, seconds);
      }
      await page.waitForFunction(
        (length) => {
          const q = window.__wavQA;
          return (
            q.starts.length &&
            q.chunks.length &&
            q.chunks.at(-1)[0] + 4096 / q.rate >= q.starts[0].when + length
          );
        },
        seconds * (captureCycle + 1) + 0.3,
        { timeout: 60000 },
      );
      await page.locator(st ? "#st-pause" : "#bb-pause").click();
      const recorded = await page.evaluate(() => {
        const q = window.__wavQA;
        q.active = false;
        const encode = (a) => {
          const b = new Uint8Array(a.buffer);
          let s = "";
          for (let i = 0; i < b.length; i += 16384)
            s += String.fromCharCode(...b.subarray(i, i + 16384));
          return btoa(s);
        };
        const channels = [0, 1].map((c) => {
          const data = new Float32Array(q.frames);
          let at = 0;
          for (const block of q.chunks) {
            data.set(block[c + 1], at);
            at += block[c + 1].length;
          }
          return encode(data);
        });
        return {
          rate: q.rate,
          starts: q.starts,
          times: q.chunks.map((b) => b[0]),
          channels,
        };
      });
      const live = recorded.channels.map((s) => {
        const b = Buffer.from(s, "base64");
        return new Float32Array(
          b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        );
      });
      await writeFile(
        join(output, item.name + "-capture.json"),
        JSON.stringify({ ...recorded, channels: undefined }, null, 2),
      );
      // Chromium can label a block one quantum early, then correct the next
      // label. Check the complete clock span as well as the actual PCM below.
      const clockFrames =
        (recorded.times.at(-1) - recorded.times[0]) * recorded.rate;
      assert(
        Math.abs(clockFrames - (recorded.times.length - 1) * 4096) < 0.001,
        "Capture sample count must match the full render-thread clock span",
      );
      const timestampCorrections = recorded.times.flatMap((time, i) =>
        i &&
        Math.abs((time - recorded.times[i - 1]) * recorded.rate - 4096) > 0.001
          ? [
              {
                block: i,
                frames: (time - recorded.times[i - 1]) * recorded.rate - 4096,
              },
            ]
          : [],
      );
      for (let c = 0; c < live.length; c++)
        await writeFile(
          join(output, `${item.name}-live-${c}.f32`),
          new Uint8Array(live[c].buffer),
        );
      console.log("EXPORT " + item.name);
      await page.locator(`#${prefix}-render`).click();
      await page
        .locator(`#${prefix}-result`)
        .waitFor({ state: "visible", timeout: 90000 });
      const downloadEvent = page.waitForEvent("download");
      await page.locator(st ? "#st-wav-download" : "#project-download").click();
      const download = await downloadEvent;
      const target = join(output, item.name + ".wav");
      await download.saveAs(target);
      const wav = parseWav(await readFile(target));
      assert.equal(wav.rate, recorded.rate);
      assert.equal(wav.frames, Math.round(seconds * wav.rate));
      const startGuess = item.liveEdit
        ? Math.round(
            (recorded.starts[0].when +
              seconds * captureCycle -
              recorded.times[0]) *
              wav.rate,
          )
        : null;
      const metrics = compare(live, wav.channels, wav.rate, startGuess);
      const shifted = compare(
        live.map((a) => a.subarray(53)),
        wav.channels,
        wav.rate,
        startGuess === null ? null : startGuess - 53,
      );
      assert.equal(
        shifted.shift,
        metrics.shift - 53,
        "Alignment control must detect a deliberate 53-frame shift",
      );
      const result = {
        name: item.name,
        seconds,
        channels: wav.channels.length,
        rate: wav.rate,
        metrics,
        sourceStarts: recorded.starts.length,
        blocks: recorded.times.length,
        timestampCorrections,
        shiftedControl: shifted.shift,
      };
      evidence.checks.push(result);
      console.log(JSON.stringify(result));
      await page.screenshot({ path: join(output, item.name + ".png") });
      assert(metrics.correlation > 0.999, "Live/WAV waveform correlation");
      assert(
        metrics.normalizedError < 0.025,
        "Live/WAV relative sample difference",
      );
      assert(Math.abs(metrics.levelDb) < 0.1, "Live/WAV output level");
      const quietControl = compare(
        live,
        wav.channels.map((a) => a.map((x) => x * 0.5)),
        wav.rate,
        startGuess,
      );
      assert(
        quietControl.normalizedError > 0.9 && quietControl.levelDb > 5.9,
        "Comparison must reject a WAV at the wrong volume",
      );
      result.wrongLevelControlRejected = true;
      // A ready download must not silently keep an older sound selection.
      if (st) await page.locator('[data-st-step="kick:1"]').click();
      else await page.locator('[data-role="snare"]').click();
      const staleVisible = await page.locator(`#${prefix}-result`).isVisible();
      result.staleDownloadVisibleAfterEdit = staleVisible;
      assert.equal(
        staleVisible,
        false,
        "Editing the beat must invalidate its old WAV",
      );
      if (item.name.endsWith("first")) {
        await page.evaluate(() => {
          window.__wavQA.holdRender = true;
        });
        await page.locator(`#${prefix}-render`).click();
        await page.waitForFunction(() => window.__wavQA.renderBlocked);
        if (st) await page.locator('[data-st-step="kick:2"]').click();
        else await page.locator('[data-role="snare"]').click();
        await page.evaluate(() => window.__wavQA.releaseRender());
        await page.waitForFunction(
          (id) => !document.querySelector(id).disabled,
          `#${prefix}-render`,
          { timeout: 90000 },
        );
        assert.equal(
          await page.locator(`#${prefix}-result`).isVisible(),
          false,
          "A render completed after an edit must not publish the earlier beat",
        );
        assert.match(
          await page
            .locator(st ? "#st-project-status" : "#project-status")
            .innerText(),
          /Beat berubah/,
        );
        result.editDuringRenderRejected = true;
      }
      console.log("PASS " + item.name);
    } catch (error) {
      await writeFile(
        join(output, item.name + "-failure.txt"),
        await page.locator("body").innerText(),
      );
      throw error;
    } finally {
      await ctx.close();
    }
  }
  assert.deepEqual(evidence.errors, []);
  evidence.result = "PASS";
} catch (e) {
  evidence.result = "FAIL";
  evidence.failure = e.stack;
  process.exitCode = 1;
  console.error(e);
} finally {
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await writeFile(
    join(output, "resources.json"),
    JSON.stringify(resources, null, 2),
  );
  await browser?.close();
  await server?.close();
  proxy.closeAllConnections();
  await new Promise((resolve) => proxy.close(resolve));
}
