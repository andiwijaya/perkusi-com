// Independent full chronology oracle. No product imports; no adapter states,
// fitting, excluded transitions or inferred alignment. Inputs are retained PCM.
export function reference({ rate, period, cycles, master, groups }) {
  const F = Math.fround,
    attack = Math.round(0.0006 * rate),
    release = Math.round(0.004 * rate),
    body = cycles * period,
    rows = [];
  let frames = body;
  for (const g of groups) {
    if (g.gain === 0) continue;
    if (g.loop) {
      frames = Math.max(frames, body + release);
      rows.push({ ...g, loop: true });
      continue;
    }
    const timeline = [];
    for (let cycle = 0; cycle < cycles; cycle++)
      for (const e of g.events)
        timeline.push({ ...e, at: cycle * period + e.at });
    timeline.sort((a, b) => a.at - b.at);
    for (let i = 0; i < timeline.length; i++) {
      const e = timeline[i],
        choke = timeline[i + 1]?.at ?? Infinity,
        end = Math.min(e.at + e.left.length, choke + release);
      frames = Math.max(frames, end);
      rows.push({ ...g, ...e, choke, end });
    }
  }
  const out = [new Float32Array(frames), new Float32Array(frames)];
  for (const r of rows) {
    const mono = r.channels === 1,
      angle = ((r.pan + 1) * Math.PI) / 4,
      matrix = r.loop
        ? [
            r.pan === 0 ? 1 : F(Math.SQRT2 * Math.cos(angle)),
            0,
            0,
            r.pan === 0 ? 1 : F(Math.SQRT2 * Math.sin(angle)),
          ]
        : mono
          ? [F(Math.cos(angle)), 0, F(Math.sin(angle)), 0]
          : r.pan === 0
            ? [1, 0, 0, 1]
            : r.pan < 0
              ? [
                  1,
                  F(Math.cos(((r.pan + 1) * Math.PI) / 2)),
                  0,
                  F(Math.sin(((r.pan + 1) * Math.PI) / 2)),
                ]
              : [
                  F(Math.cos((r.pan * Math.PI) / 2)),
                  0,
                  F(Math.sin((r.pan * Math.PI) / 2)),
                  1,
                ];
    for (
      let n = r.loop ? 0 : r.at;
      n < (r.loop ? body + release : r.end);
      n++
    ) {
      const i = r.loop ? n : n - r.at,
        length = r.left.length,
        natural = (i) =>
          i < 0 || i >= length
            ? 0
            : Math.min(
                1,
                i / Math.min(length, attack),
                (length - i) / Math.min(length, release),
              ),
        env = r.loop
          ? F(
              Math.min(1, n / release) *
                (n < body ? 1 : Math.max(0, 1 - (n - body) / release)),
            )
          : F(
              n >= r.choke
                ? natural(r.choke - r.at) *
                    Math.max(0, 1 - (n - r.choke) / release)
                : natural(i),
            ),
        at = r.loop ? ((n * length) / (5 * rate)) % length : i,
        a = Math.floor(at),
        fraction = at - a,
        level = F(r.trim * (r.velocity ?? 1)),
        gain = F(r.gain),
        sample = (src) =>
          F(src[a] + fraction * (src[(a + 1) % length] - src[a])),
        left = F(F(sample(r.left) * F(level * env)) * gain),
        right = F(F(sample(r.right) * F(level * env)) * gain);
      out[0][n] = F(out[0][n] + F(F(left * matrix[0]) + F(right * matrix[1])));
      out[1][n] = F(out[1][n] + F(F(left * matrix[2]) + F(right * matrix[3])));
    }
  }
  const curve = (i) => {
    const x = i / 32768 - 1,
      a = Math.abs(x);
    return F(
      a <= 0.7
        ? x
        : Math.sign(x) *
            (0.7 + 0.2 * (1 - (1 - Math.min(1, (a - 0.7) / 0.3)) ** 1.5)),
    );
  };
  for (let n = 0; n < frames; n++)
    for (let c = 0; c < 2; c++) {
      const x = Math.max(-1, Math.min(1, F(F(out[c][n] * F(master)) * 3))),
        p = (x + 1) * 32768,
        i = Math.min(65535, Math.floor(p));
      out[c][n] = F(curve(i) + (p - i) * (curve(i + 1) - curve(i)));
    }
  return out;
}
