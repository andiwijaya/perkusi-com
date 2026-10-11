// Engine state establishes success; a running but silent transport does not.
export function createPlaybackMilestones(send) {
  const sent = new Set();
  const once = (name) => {
    if (sent.has(name)) return;
    sent.add(name);
    send(name);
  };
  return (snapshot) => {
    const active = Object.values(snapshot.stems).filter(
      (stem) => stem.active,
    ).length;
    if (
      snapshot.status !== "playing" ||
      snapshot.contextState !== "running" ||
      snapshot.resources.voices < 1 ||
      active < 1 ||
      snapshot.currentTime < snapshot.origin
    )
      return;
    once("audio_started");
    once("first_layer_enabled");
    if (active >= 3) once("three_layers_reached");
  };
}
