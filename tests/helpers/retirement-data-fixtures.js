// Pinned QA data snapshots, not replacements for retired model/history APIs.
import empty from "../fixtures/retirement-data/empty-loop.json" with { type: "json" };
import groups from "../fixtures/retirement-data/eight-programmes.json" with { type: "json" };
import document from "../fixtures/retirement-data/audio-document.json" with { type: "json" };
import layers from "../fixtures/retirement-data/two-layer-portable.json" with { type: "json" };

export const emptyLoopFixture = () => structuredClone(empty);
export const eightProgrammeFixture = () => structuredClone(groups);
export const audioDocumentFixture = () => structuredClone(document);
export const twoLayerFixture = () => structuredClone(layers);
