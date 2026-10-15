import credits from "../../internal/gamelan-delivery/credits.json" with { type: "json" };
import flags from "../../internal/gamelan-delivery/quality-flags.json" with { type: "json" };
const source = new Map(credits.rows.map((r) => [r.sampleId, r]));
const flagged = new Set(flags.map((r) => r.sampleId));
export const sourceQualityPending = (id) => flagged.has(id);
export function gamelanWavAttribution(project) {
  const ids = [
    ...new Set(
      project.events
        .filter((e) => e.action === "strike" && e.bankId.startsWith("cdm-"))
        .map((e) => e.sampleId),
    ),
  ].sort();
  if (!ids.length)
    return "Perkusi.com original synthesised sounds: CC0 https://creativecommons.org/publicdomain/zero/1.0/ ; no CDM recording referenced.";
  const lines = [
    "Perkusi.com Gamelan Preview rendered arrangement. Licensed source recordings; no endorsement.",
    "Recording license: CC BY3.0 https://creativecommons.org/licenses/by/3.0/",
    "Recorded Pedro Augusto & Rui Penha; edited Pedro Augusto; support Jorge Queijo & Maria Monica; Digitopia_CdM / Casa da Musica.",
    "Delivery: uniform gain0.8, PCM24 stereo; separate44.1/48k profiles,48k explicit160/147 resampling; no trim, fade or retune. This rendered arrangement adds event timing/gain/pan/damping and legacy mixing, when selected.",
    "Library/package source: https://digitopia.casadamusica.com/CDM-GAMELAN-SAMPLE-LIBRARY/ (Artistic2.0). The original works referenced by this project are listed below, including any muted sources.",
    "Culture/listening/source-quality validation pending; not an authenticity or legal warranty.",
  ];
  for (const id of ids) {
    const row = source.get(id);
    if (!row) throw Error("Missing attribution");
    lines.push(
      row.title +
        " | " +
        row.creator +
        " | " +
        row.sourcePage +
        " | " +
        row.licenseURL,
    );
  }
  lines.push(
    "Legacy original synthesised sounds, if used: Perkusi.com project, CC0 https://creativecommons.org/publicdomain/zero/1.0/",
  );
  return lines.join("\n");
}
