import {
  TrackWaveforms,
  waveformCopy,
} from "../loop-station/track-waveforms.js";
import { AudioDocument } from "../loop-station/audio-document.js";
import { DeviceProfileStore } from "../loop-station/device-profiles.js";
import { mountDeviceProfiles } from "../loop-station/device-profile-panel.js";
import { retainCanonicalBundle } from "../project/canonical-package.js";
import { canonicalRecordingPhase } from "../project/canonical-recording-position.js";

export function initCanonicalRecordingTools({
  root,
  editor,
  registry,
  memory,
  locale,
  mutate,
  preview,
  signal,
}) {
  const en = locale === "en",
    host = document.createElement("section"),
    profiles = new DeviceProfileStore(),
    drafts = new Map();
  host.className = "st-panel";
  host.dataset.canRecordingTools = "";
  root.querySelector(".canonical-material").append(host);
  const el = (tag, text = "", attrs = {}) => {
    const n = document.createElement(tag);
    n.textContent = text;
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const waves = new TrackWaveforms({
    memory,
    documentStore: {
      async waveform(ref, options) {
        const b = retainCanonicalBundle(editor.snapshot().bundle);
        try {
          const doc = new AudioDocument({
            registry,
            memory,
            backend: { entry: (r) => b.entries.get(r.id) },
          });
          return await doc.waveform(ref, options);
        } finally {
          b.dispose();
        }
      },
    },
  });
  function render() {
    const p = editor.snapshot().project,
      s = p.sections.find((s) => s.id === p.activeSection),
      projection = { assetRefs: p.assets, clock: p.timing.clock };
    host.replaceChildren(
      el(
        "h3",
        en
          ? "Recordings: waveform and position"
          : "Rekaman: waveform dan posisi",
      ),
      el("p", waveformCopy[locale].hint),
    );
    waves.begin(projection);
    const targets = s.placements.filter((a) => a.sourceRef.kind === "asset");
    const activeKeys = new Set(
      targets.map((a) => {
        const r = p.assets.find((r) => r.id === a.sourceRef.id);
        return [a.id, r.sha256, r.sampleRate, r.channels, r.frames].join(":");
      }),
    );
    for (const key of drafts.keys())
      if (!activeKeys.has(key)) drafts.delete(key);
    if (!targets.length)
      host.append(
        el(
          "p",
          en
            ? "Apply a recorded take or open a project containing recordings."
            : "Terapkan take atau buka proyek yang berisi rekaman.",
        ),
      );
    for (const a of targets) {
      const ref = p.assets.find((r) => r.id === a.sourceRef.id),
        bus = p.tracks.find((t) => t.id === a.trackId),
        row = el("fieldset", "", { "data-can-recording": a.id });
      row.append(el("legend", bus.name + " / " + ref.id));
      host.append(row);
      const clip = {
        id: a.id,
        sourceId: ref.id,
        startTick: a.startTick,
        lengthTicks: a.lengthTicks,
        offsetFrames: a.offsetFrames,
        loop: a.loop,
        ...(a.alignment ? { phaseAlignment: a.alignment } : {}),
      };
      waves.mount(row, { id: a.id, clips: [clip] }, projection, locale);
      for (const v of waves.views.filter((v) => v.clip?.id === a.id))
        v.trackId = bus.id;
      try {
        canonicalRecordingPhase(
          p,
          a.id,
          a.alignment?.advanceFrames ?? 0,
          ref.sha256,
        );
      } catch {
        row.append(
          el(
            "p",
            en
              ? "Position adjustment requires a complete 1/2/4/8-bar loop at its original rate and period."
              : "Penyesuaian posisi memerlukan Loop penuh 1/2/4/8 bar pada rate dan periode asli.",
          ),
        );
        continue;
      }
      const key =
          a.id +
          ":" +
          ref.sha256 +
          ":" +
          ref.sampleRate +
          ":" +
          ref.channels +
          ":" +
          ref.frames,
        offset = el("input", "", {
          type: "number",
          min: -250,
          max: 250,
          step: 0.01,
          "data-can-offset": "",
          "data-can-edit": "",
          "data-can-global": "",
        }),
        label = el(
          "label",
          en
            ? "Manual advance (ms, UNCALIBRATED) "
            : "Majukan manual (ms, BELUM DIKALIBRASI) ",
        );
      offset.value = String(
        drafts.get(key) ??
          ((a.alignment?.advanceFrames ?? 0) * 1000) / ref.sampleRate,
      );
      label.append(offset);
      row.append(label);
      offset.addEventListener(
        "input",
        () => drafts.set(key, Number(offset.value)),
        { signal },
      );
      const value = () =>
        canonicalRecordingPhase(
          editor.snapshot().project,
          a.id,
          Math.round((Number(offset.value) * ref.sampleRate) / 1000),
          ref.sha256,
        );
      const button = (text, name, fn) => {
        const b = el("button", text, {
          type: "button",
          "data-can-position-action": name,
          "data-can-edit": "",
          "data-can-global": "",
        });
        b.addEventListener("click", fn, { signal });
        row.append(b);
      };
      button(en ? "Preview position" : "Pratinjau posisi", "preview", () =>
        preview(value),
      );
      button(en ? "Save position" : "Simpan posisi", "save", () =>
        mutate(() => editor.edit((d) => Object.assign(d, value()))),
      );
      button(en ? "Reset position" : "Atur ulang posisi", "reset", () => {
        offset.value = "0";
        drafts.set(key, 0);
        mutate(() =>
          editor.edit((d) =>
            Object.assign(d, canonicalRecordingPhase(d, a.id, 0, ref.sha256)),
          ),
        );
      });
      mountDeviceProfiles({
        host: row,
        locale,
        store: profiles,
        sampleRate: ref.sampleRate,
        getDraft: () => Number(offset.value),
        setDraft: (value) => {
          offset.value = String(value);
          drafts.set(key, value);
        },
      });
    }
  }
  function locks(locked) {
    for (const n of host.querySelectorAll("button,input,select"))
      n.disabled = locked;
  }
  function position(p, state) {
    for (const v of waves.views) {
      if (!v.ref) continue;
      const r = p?.recordings?.find(
          (r) =>
            r.sha256 === v.ref.sha256 &&
            r.trackId === v.trackId &&
            (r.originalPlacementIds ?? []).includes(v.clip.id),
        ),
        visible =
          !!r && ["playing", "paused"].includes(state) && p.started !== false;
      v.cursor.setAttribute("visibility", visible ? "visible" : "hidden");
      if (visible) {
        let f = r.rawFrame / v.ref.frames;
        if (waves.reduced?.matches) f = Math.floor(f * 16) / 16;
        v.cursor.setAttribute("transform", `translate(${f * 512} 0)`);
        v.cursor.setAttribute("opacity", state === "paused" ? "0.5" : "1");
      }
    }
  }
  return { render, locks, position, dispose: () => waves.dispose() };
}
