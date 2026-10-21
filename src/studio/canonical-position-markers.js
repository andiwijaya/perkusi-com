// These are views of the admitted score's audio frame. Editing selections and
// every saved document field remain independent of the playback presentation.
export function canonicalSourceLabel(project, source, locale = "id") {
  const named = (value) =>
      typeof value === "string" && value.trim() ? value : null,
    child = project.sourceDefs.find(
      (d) => d.id === source.programme.accompanimentRef,
    ),
    placement = project.sections
      .flatMap((s) => s.placements)
      .find(
        (p) => p.sourceRef.kind === "working" && p.sourceRef.id === source.id,
      ),
    track = project.tracks.find((t) => t.id === placement?.trackId),
    index = project.sourceDefs
      .filter((d) => d.kind === source.kind)
      .findIndex((d) => d.id === source.id);
  return (
    named(source.programme.title) ??
    named(child?.programme.title) ??
    named(track?.name) ??
    `${locale === "en" ? "Instrument" : "Instrumen"} ${index + 1}`
  );
}

export function initCanonicalPositionMarkers({
  root,
  locale,
  readDocument,
  nativeLabel,
}) {
  const en = locale === "en",
    motion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)"),
    song = document.createElement("p");
  song.dataset.canSongPosition = "";
  song.className = "st-hint";
  song.hidden = true;
  root.querySelector("#st-position").after(song);
  const live = document.createElement("section"),
    heading = document.createElement("p"),
    list = document.createElement("ul"),
    rows = new Map();
  live.dataset.canNativeLive = "";
  heading.textContent = en
    ? "Instrument playback · editing selection stays separate"
    : "Pemutaran instrumen · pilihan edit tetap terpisah";
  heading.className = "st-hint";
  live.append(heading, list);
  song.after(live);
  live.hidden = true;
  let documentIdentity = null,
    defs = new Map();
  const text = (el, value) => {
    if (el && el.textContent !== value) el.textContent = value;
  };
  return Object.freeze({
    position(p, state) {
      const following =
          !!p && p.started !== false && ["playing", "paused"].includes(state),
        current = following ? p.occurrences?.[0] : null;
      song.hidden = !following;
      if (current) {
        root.dataset.canonicalOccurrence = current.id;
        root.dataset.canonicalSection = current.sectionId;
        text(
          song,
          `${en ? "Song pattern" : "Pola lagu"}: ${current.sectionName} · ${en ? "repeat" : "ulang"} ${current.repeatIndex + 1}${state === "paused" ? (en ? " · Paused" : " · Dijeda") : ""}`,
        );
      } else {
        delete root.dataset.canonicalOccurrence;
        delete root.dataset.canonicalSection;
        text(
          song,
          following
            ? en
              ? "Natural decay / effect tail"
              : "Decay alami / tail efek"
            : "",
        );
      }
      for (const row of root.querySelectorAll("[data-song-chain-id]")) {
        const active = !!current && row.dataset.songChainId === current.entryId;
        row.classList.toggle("st-current", active);
        if (active) row.setAttribute("aria-current", "step");
        else row.removeAttribute("aria-current");
      }
      const doc = readDocument();
      if (doc !== documentIdentity) {
        documentIdentity = doc;
        defs = new Map(doc.sourceDefs.map((d) => [d.id, d]));
      }
      const ids = new Set(
        following
          ? [
              ...(p.nativePlacements ?? []).map((x) => x.sourceId),
              ...(p.voices ?? [])
                .filter((x) => x.audible)
                .map((x) => x.sourceId),
            ]
          : [],
      );
      live.hidden = !ids.size;
      for (const [id, row] of rows)
        if (!ids.has(id)) {
          row.item.remove();
          rows.delete(id);
        }
      for (const id of ids) {
        const source = defs.get(id);
        if (!source) continue;
        let row = rows.get(id);
        if (!row) {
          const item = document.createElement("li"),
            caption = document.createElement("p"),
            cursor = document.createElement("progress");
          item.dataset.canLiveNativeSource = id;
          item.className = "st-current";
          cursor.dataset.canNativeLiveCursor = "";
          cursor.max = 1;
          cursor.setAttribute(
            "aria-label",
            en ? "Instrument playback position" : "Posisi pemutaran instrumen",
          );
          item.append(caption, cursor);
          list.append(item);
          row = { item, caption, cursor, key: null };
          rows.set(id, row);
        }
        const placement = p.nativePlacements
            ?.filter((x) => x.sourceId === id)
            .at(-1),
          voices =
            p.voices?.filter((x) => x.sourceId === id && x.audible) ?? [],
          eventIds = [...new Set(voices.map((v) => v.eventId))],
          key = state + "/" + eventIds.join(" ") + "/" + !!placement;
        row.item.dataset.canLiveNativeEvents = eventIds.join(" ");
        row.cursor.hidden = !placement;
        const value = placement?.progress ?? 0;
        row.cursor.value = motion?.matches
          ? Math.floor(value * 16) / 16
          : value;
        if (row.key !== key) {
          row.key = key;
          const labels = eventIds
            .map((id) =>
              nativeLabel(
                source,
                source.programme.events.find((e) => e.id === id),
              ),
            )
            .filter(Boolean);
          text(
            row.caption,
            canonicalSourceLabel(doc, source, locale) +
              (labels.length ? ": " + labels.join("; ") : "") +
              (state === "paused"
                ? en
                  ? " · Paused"
                  : " · Dijeda"
                : !placement
                  ? en
                    ? " · Natural decay"
                    : " · Decay alami"
                  : ""),
          );
        }
      }
      for (const box of root.querySelectorAll("[data-can-native-source]")) {
        const id = box.dataset.canNativeSource,
          placement = following
            ? p.nativePlacements?.filter((x) => x.sourceId === id).at(-1)
            : null,
          voices = following
            ? (p.voices?.filter((x) => x.sourceId === id && x.audible) ?? [])
            : [],
          progress = box.querySelector("[data-can-native-cursor]"),
          status = box.querySelector("[data-can-native-position]");
        box.classList.toggle("st-current", !!placement || voices.length > 0);
        if (progress) {
          progress.hidden = !placement;
          const value = placement?.progress ?? 0;
          progress.value = motion?.matches
            ? Math.floor(value * 16) / 16
            : value;
        }
        if (status) {
          status.hidden = !following || (!placement && !voices.length);
          status.dataset.canLiveNativeEvents = [
            ...new Set(voices.map((x) => x.eventId)),
          ].join(" ");
          const options = [...box.querySelector("[data-can-event]").options],
            labels = [
              ...new Set(
                voices
                  .map(
                    (v) =>
                      options.find((o) => o.value === v.eventId)?.textContent,
                  )
                  .filter(Boolean),
              ),
            ];
          text(
            status,
            `${state === "paused" ? (en ? "Paused" : "Dijeda") : en ? "Playback" : "Pemutaran"}${labels.length ? ": " + labels.join("; ") : ""}`,
          );
        }
      }
    },
  });
}
