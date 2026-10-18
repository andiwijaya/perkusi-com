import { fail } from "../project/instrument-contract.js";
export const SOURCE_WINDOW_FRAMES = 2048;
export const SOURCE_WINDOW_COUNT = 32; // At most16 stereo voices.
export const SOURCE_WINDOW_BYTES =
  SOURCE_WINDOW_FRAMES * SOURCE_WINDOW_COUNT * 4;

// copyFromChannel avoids retaining a complete getChannelData view for every
// long source. Recycle physical windows rather than rely on garbage collection.
export class SourceWindows {
  constructor() {
    this.tables = new WeakMap();
    this.recent = new Map();
  }
  read(buffer, channel, frame) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= buffer.length)
      fail("unsafeOutput");
    if (typeof buffer.copyFromChannel !== "function") fail("loopFXUnavailable");
    let tables = this.tables.get(buffer);
    if (!tables) {
      tables = Array.from({ length: buffer.numberOfChannels }, () => new Map());
      this.tables.set(buffer, tables);
    }
    const table = tables[channel],
      block = Math.floor(frame / SOURCE_WINDOW_FRAMES);
    let row = table.get(block);
    if (!row) {
      if (this.recent.size === SOURCE_WINDOW_COUNT) {
        row = this.recent.keys().next().value;
        this.recent.delete(row);
        row.table.delete(row.block);
      } else row = { data: new Float32Array(SOURCE_WINDOW_FRAMES) };
      row.table = table;
      row.block = block;
      row.data.fill(0);
      buffer.copyFromChannel(row.data, channel, block * SOURCE_WINDOW_FRAMES);
      table.set(block, row);
    } else this.recent.delete(row);
    this.recent.set(row, row);
    return row.data[frame - block * SOURCE_WINDOW_FRAMES];
  }
}
