import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

// Supply a fresh hash-verified local candidate server and evidence directory.
// The repair's run-numeric.mjs provides the environment-owned Playwright runtime.
export async function testCombinedNumeric({
  playwright,
  origin,
  outputDirectory,
}) {
  const result = {
    status: "RUNNING",
    profiles: [],
    qualification:
      "Native Windows desktop form/keyboard, actual editable score/history/file/play/WAV checks. Live outputs muted. No physical listening/device/Safari/microphone claim.",
  };
  let browser;
  const save = () =>
    writeFile(
      outputDirectory + "/NUMERIC-NATIVE.json",
      JSON.stringify(result, null, 2),
    );
  try {
    for (const channel of ["chrome", "msedge", "firefox"]) {
      browser =
        channel === "firefox"
          ? await playwright.firefox.launch({
              headless: true,
              executablePath:
                "C:/Users/andi_/AppData/Local/ms-playwright/firefox-1543/firefox/firefox.exe",
            })
          : await playwright.chromium.launch({ headless: true, channel });
      const context = await browser.newContext({
          viewport: { width: 390, height: 1000 },
          acceptDownloads: true,
        }),
        page = await context.newPage(),
        errors = [];
      page.setDefaultTimeout(60000);
      page.on("pageerror", (error) => errors.push(error.stack));
      await context.addInitScript(() => {
        globalThis.qa = { contexts: [], starts: [], mic: 0 };
        const Native = globalThis.AudioContext;
        globalThis.AudioContext = class extends Native {
          constructor(options = {}) {
            super({ ...options, sampleRate: 48000 });
            globalThis.qa.contexts.push(this);
            const makeGain = this.createGain.bind(this),
              makeSource = this.createBufferSource.bind(this);
            const mute = (node) => {
              const connect = node.connect.bind(node);
              node.connect = (target, ...args) => {
                if (target === this.destination) {
                  const gain = makeGain();
                  gain.gain.value = 0;
                  connect(gain);
                  gain.connect(target);
                } else connect(target, ...args);
                return target;
              };
              return node;
            };
            this.createGain = () => mute(makeGain());
            this.createBufferSource = () => {
              const source = mute(makeSource()),
                start = source.start.bind(source);
              source.start = (when = 0, offset = 0, ...args) => {
                globalThis.qa.starts.push({
                  when,
                  offset,
                  frames: source.buffer?.length,
                  rate: source.playbackRate.value,
                });
                return start(when, offset, ...args);
              };
              return source;
            };
          }
        };
        if (globalThis.navigator.mediaDevices)
          globalThis.navigator.mediaDevices.getUserMedia = () => {
            globalThis.qa.mic++;
            throw Error("Mic forbidden");
          };
      });
      await page.goto(origin + "/internal/instrument-focus/", {
        waitUntil: "networkidle",
      });
      await page.evaluate(async () => {
        globalThis.s = (
          await import("/src/gamelan/focus-workspace.js")
        ).session;
      });
      const profile = {
        channel,
        version: browser.version(),
        strength: [],
        adjacent: [],
        focusTempo: [],
        roundtrip: null,
      };
      const numberState = (e) => ({
        value: e.value,
        number: Number.isFinite(e.valueAsNumber) ? e.valueAsNumber : null,
        finite: Number.isFinite(e.valueAsNumber),
        valid: e.checkValidity(),
        stepMismatch: e.validity.stepMismatch,
        min: e.min,
        max: e.max,
        step: e.step,
        required: e.required,
      });
      const typeNumber = async (field, value) => {
        await field.focus();
        await field.press("Control+A");
        if (value === "") await field.press("Backspace");
        else await page.keyboard.type(value);
        await field.press("Tab");
      };
      for (const value of ["96", "96.5", "60", "180", "124.75"]) {
        await typeNumber(page.locator("#if-tempo"), value);
        const state = await page.locator("#if-tempo").evaluate(numberState);
        assert.ok(state.valid && !state.stepMismatch);
        assert.equal(
          await page.evaluate(
            () => globalThis.s.project.composition.timing.bpm,
          ),
          Number(value),
        );
        profile.focusTempo.push({ requested: value, ...state });
      }
      for (const value of ["", "0", "59.9", "180.01", "abc", "1e999"]) {
        const before = await page.evaluate(() => globalThis.s.toJSON());
        await typeNumber(page.locator("#if-tempo"), value);
        const state = await page.locator("#if-tempo").evaluate(numberState);
        assert.equal(state.valid, false);
        assert.equal(await page.evaluate(() => globalThis.s.toJSON()), before);
        profile.focusTempo.push({ requested: value, rejected: true, ...state });
      }
      await typeNumber(page.locator("#if-tempo"), "96");
      await page.locator("#if-studio").click();
      await page.waitForFunction(
        () => !globalThis.document.querySelector("#if-studio-host").hidden,
      );
      await page.locator('[data-demo="pelog-space"]').click();
      await page.locator('details[data-section="bilah"] summary').click();
      await page
        .locator('details[data-section="bilah"] select')
        .first()
        .selectOption("f4");
      const strength = page
        .locator(
          'details[data-section="bilah"] .combined-mix input[type=number]',
        )
        .first();
      const generated = await strength.evaluate(numberState);
      assert.equal(generated.number, 0.5);
      assert.equal(generated.valid, true);
      assert.equal(generated.stepMismatch, false);
      profile.generatedDefault = generated;
      const readStrength = () =>
        page.evaluate(
          () => globalThis.s.project.composition.patterns[0].notes[0].velocity,
        );
      for (const locale of ["id", "en"]) {
        if ((await page.locator("html").getAttribute("lang")) !== locale)
          await page.locator("#if-language").click();
        for (const value of [
          "0.5",
          "0.75",
          "1",
          "0.51",
          "0.01",
          "0.001",
          "0.33333333",
          "5e-324",
          "0.99999",
        ]) {
          const before = await page.evaluate(() => globalThis.s.toJSON());
          await typeNumber(strength, value);
          const state = await strength.evaluate(numberState),
            stored = await readStrength();
          assert.ok(
            state.valid && !state.stepMismatch,
            JSON.stringify({ channel, value, state }),
          );
          assert.equal(stored, Number(value));
          const current = await page.evaluate(() => globalThis.s.toJSON());
          if (current !== before) {
            await page.locator("#is-undo").click();
            assert.equal(
              await page.evaluate(() => globalThis.s.toJSON()),
              before,
            );
            await page.locator("#is-redo").click();
            assert.equal(
              await page.evaluate(() => globalThis.s.toJSON()),
              current,
            );
          }
          assert.equal(
            JSON.parse(current).composition.patterns[0].notes[0].velocity,
            Number(value),
          );
          profile.strength.push({
            locale,
            requested: value,
            stored,
            ...state,
            historyExact: true,
          });
        }
        for (const value of [
          "0",
          "-0.01",
          "1.001",
          "",
          "abc",
          "NaN",
          "Infinity",
          "1e999",
          "1e-999",
        ]) {
          const before = await page.evaluate(() => globalThis.s.toJSON());
          await typeNumber(strength, value);
          const state = await strength.evaluate(numberState);
          assert.equal(
            state.valid,
            false,
            JSON.stringify({ channel, value, state }),
          );
          assert.equal(
            await page.evaluate(() => globalThis.s.toJSON()),
            before,
          );
          profile.strength.push({
            locale,
            requested: value,
            rejected: true,
            ...state,
            sourceIntact: true,
          });
        }
      }
      await typeNumber(strength, "1");
      // Every adjacent continuous domain: generated/default values, non-lattice
      // decimals, true bounds and invalid entries, including exact score writes.
      for (const section of ["tracks", "clips"])
        await page
          .locator('details[data-section="' + section + '"] summary')
          .click();
      const controls = page.locator(".combined-controls input[type=number]");
      const controlsToCheck = [
        {
          name: "master",
          field: controls.nth(0),
          path: "master.volume",
          valid: ["0", "0.28", "0.75"],
          invalid: ["", "-0.001", "0.751"],
        },
        {
          name: "tempo",
          field: controls.nth(1),
          path: "timing.bpm",
          valid: ["60", "124.5", "180"],
          invalid: ["", "59.9", "180.01"],
        },
        {
          name: "swing",
          field: controls.nth(2),
          path: "timing.swing",
          valid: ["0", "0.16", "0.5"],
          invalid: ["", "-0.01", "0.501"],
        },
        {
          name: "trackVolume",
          field: page
            .locator(
              'details[data-section="tracks"] fieldset input[type=number]',
            )
            .nth(0),
          path: "tracks.0.volume",
          valid: ["0", "0.731", "1"],
          invalid: ["", "-0.001", "1.01"],
        },
        {
          name: "trackPan",
          field: page
            .locator(
              'details[data-section="tracks"] fieldset input[type=number]',
            )
            .nth(1),
          path: "tracks.0.pan",
          valid: ["-1", "-0.123", "0", "1"],
          invalid: ["", "-1.01", "1.01"],
        },
        {
          name: "bilahVolume",
          field: page
            .locator(
              'details[data-section="bilah"] > fieldset input[type=number]',
            )
            .nth(0),
          path: "instrument.volume",
          valid: ["0", "0.271", "1"],
          invalid: ["", "-0.01", "1.01"],
        },
        {
          name: "bilahPan",
          field: page
            .locator(
              'details[data-section="bilah"] > fieldset input[type=number]',
            )
            .nth(1),
          path: "instrument.pan",
          valid: ["-1", "0.337", "1"],
          invalid: ["", "-1.01", "1.01"],
        },
        {
          name: "clipVolume",
          field: page
            .locator('details[data-section="clips"] fieldset')
            .first()
            .locator("input[type=number]")
            .nth(0),
          path: "clips.0.volume",
          valid: ["0", "0.283", "1"],
          invalid: ["", "-0.01", "1.01"],
        },
        {
          name: "clipPan",
          field: page
            .locator('details[data-section="clips"] fieldset')
            .first()
            .locator("input[type=number]")
            .nth(1),
          path: "clips.0.pan",
          valid: ["-1", "-0.317", "1"],
          invalid: ["", "-1.01", "1.01"],
        },
        {
          name: "groupVolume",
          field: page
            .locator("[data-group]")
            .first()
            .locator("input[type=number]")
            .nth(0),
          path: null,
          valid: ["0", "0.733", "1"],
          invalid: ["", "-0.01", "1.01"],
        },
        {
          name: "groupPan",
          field: page
            .locator("[data-group]")
            .first()
            .locator("input[type=number]")
            .nth(1),
          path: null,
          valid: ["-1", "0.319", "1"],
          invalid: ["", "-1.01", "1.01"],
        },
      ];
      for (const check of controlsToCheck) {
        for (const value of check.valid) {
          await typeNumber(check.field, value);
          const state = await check.field.evaluate(numberState);
          assert.ok(state.valid && !state.stepMismatch);
          const property = check.name.endsWith("Volume") ? "volume" : "pan";
          const stored = await page.evaluate(
            ({ path, property }) => {
              const project = globalThis.s.project;
              return path
                ? path
                    .split(".")
                    .reduce((v, key) => v[key], project.composition)
                : project.instrumentMix[0][property];
            },
            { path: check.path, property },
          );
          assert.equal(stored, Number(value));
          profile.adjacent.push({
            name: check.name,
            requested: value,
            stored,
            ...state,
          });
        }
        for (const value of check.invalid) {
          const before = await page.evaluate(() => globalThis.s.toJSON());
          await typeNumber(check.field, value);
          const state = await check.field.evaluate(numberState);
          assert.equal(state.valid, false);
          assert.equal(
            await page.evaluate(() => globalThis.s.toJSON()),
            before,
          );
          profile.adjacent.push({
            name: check.name,
            requested: value,
            rejected: true,
            sourceIntact: true,
            ...state,
          });
        }
        // Restore a valid visible value before the next independent field.
        await typeNumber(check.field, check.valid[1]);
      }
      // Render/play the user-created maximum-strength note on a safe mix;
      // keep the score and source metadata through actual file download/reopen.
      await typeNumber(controls.nth(0), "0.2");
      await typeNumber(controls.nth(1), "96");
      await typeNumber(controls.nth(2), "0");
      await typeNumber(
        page
          .locator(
            'details[data-section="bilah"] > fieldset input[type=number]',
          )
          .nth(0),
        "0.25",
      );
      await page
        .locator("#is-composition > label input[type=checkbox]")
        .check();
      const expected = await page.evaluate(() => globalThis.s.toJSON());
      const pendingFile = page.waitForEvent("download");
      await page.locator("#is-project").click();
      const file = await pendingFile,
        filePath = outputDirectory + "/" + channel + "-numeric.perkusi.json";
      await file.saveAs(filePath);
      assert.equal(await readFile(filePath, "utf8"), expected);
      await page.evaluate(async () => {
        await globalThis.s.dispose();
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.evaluate(async () => {
        globalThis.s = (
          await import("/src/gamelan/focus-workspace.js")
        ).session;
      });
      await page.locator("#if-file").setInputFiles(filePath);
      await page.waitForFunction(
        () =>
          globalThis.s.project.composition.patterns[0].notes[0]?.velocity === 1,
      );
      assert.equal(await page.evaluate(() => globalThis.s.toJSON()), expected);
      assert.equal(await page.evaluate(() => globalThis.qa.contexts.length), 0);
      await page.locator("#if-studio").click();
      await page.locator('details[data-section="bilah"] summary').click();
      assert.equal((await strength.evaluate(numberState)).valid, true);
      assert.equal(await readStrength(), 1);
      await page.locator("#is-enable").click();
      await page.waitForFunction(
        () =>
          globalThis.s.snapshot().playbackRequested &&
          globalThis.s.snapshot().status === "ready",
      );
      await page.locator("#is-play").click();
      await page.waitForFunction(
        () =>
          globalThis.s.snapshot().replaying &&
          globalThis.s.snapshot().legacyBusActive,
      );
      await page.waitForTimeout(180);
      const playback = await page.evaluate(() => ({
        snapshot: globalThis.s.snapshot(),
        starts: globalThis.qa.starts,
        contexts: globalThis.qa.contexts.length,
      }));
      assert.ok(
        playback.starts.length > 1 &&
          playback.starts.every((v) => v.rate === 1),
      );
      assert.equal(playback.contexts, 1);
      await page.locator("#is-pause").click();
      await page.waitForFunction(
        () =>
          globalThis.s.snapshot().voiceCount === 0 &&
          !globalThis.s.snapshot().legacyBusActive,
      );
      const pendingWav = page.waitForEvent("download", { timeout: 120000 });
      await page.locator("#is-pause-export").click();
      const wav = await pendingWav,
        wavPath = outputDirectory + "/" + channel + "-numeric.wav";
      await wav.saveAs(wavPath);
      const bytes = await readFile(wavPath);
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
      assert.equal(bytes.readUInt32LE(24), 48000);
      assert.equal(bytes.readUInt16LE(22), 2);
      let peak = 0,
        nonzero = 0;
      for (let i = 44; i < bytes.length; i += 2) {
        const v = bytes.readInt16LE(i);
        peak = Math.max(peak, Math.abs(v) / 32768);
        nonzero += Number(v !== 0);
      }
      assert.ok(nonzero > 0 && peak <= 0.950001);
      assert.equal(await page.evaluate(() => globalThis.s.toJSON()), expected);
      profile.roundtrip = {
        velocity: 1,
        byteExactJSON: true,
        coldImportContexts: 0,
        nativePlayback: playback,
        wavPath,
        frames: (bytes.length - 44) / 4,
        peak,
        nonzero,
        dataPreserved: true,
      };
      await page.screenshot({
        path: outputDirectory + "/" + channel + "-numeric-ui.png",
        fullPage: false,
      });
      profile.final = await page.evaluate(async () => {
        await globalThis.s.dispose();
        return {
          snapshot: globalThis.s.snapshot(),
          mic: globalThis.qa.mic,
          contexts: globalThis.qa.contexts.map((c) => c.state),
        };
      });
      assert.equal(profile.final.snapshot.memory.bytes, 0);
      assert.equal(profile.final.mic, 0);
      assert.ok(profile.final.contexts.every((s) => s === "closed"));
      assert.deepEqual(errors, []);
      result.profiles.push(profile);
      await save();
      console.log(
        "PASS combined numeric",
        channel,
        profile.strength.length,
        profile.adjacent.length,
      );
      await context.close();
      await browser.close();
      browser = null;
    }
    result.status = "PASS";
  } catch (error) {
    result.status = "FAIL";
    result.error = error.stack;
    throw error;
  } finally {
    await browser?.close();
    await save();
  }
  return result;
}
