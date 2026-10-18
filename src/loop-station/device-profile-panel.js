import { deviceProfileCopy } from "./device-profile-copy.js";

export function mountDeviceProfiles({
  host,
  locale,
  store,
  sampleRate,
  getDraft,
  setDraft,
}) {
  const t = deviceProfileCopy[locale],
    doc = host.ownerDocument,
    element = doc.createElement("details");
  element.className = "ls-device-profiles";
  host.append(element);
  const node = (tag, text, parent = element) => {
    const n = doc.createElement(tag);
    if (text !== undefined) n.textContent = text;
    parent.append(n);
    return n;
  };
  node("summary", t.title);
  node("p", t.hint).className = "ls-note";
  const controls = node("div");
  controls.className = "ls-toolbar";
  const name = node("input", undefined, node("label", t.name, controls));
  name.maxLength = 48;
  name.autocomplete = "off";
  name.dataset.profileName = "true";
  name.dataset.edit = "true";
  const select = node("select", undefined, node("label", t.select, controls));
  select.dataset.profileSelect = "true";
  select.dataset.edit = "true";
  const status = node("output");
  let listed = new Map();
  status.setAttribute("role", "status");
  status.dataset.profileStatus = "true";
  const message = (value) => {
    if (status.textContent !== value) status.textContent = value;
  };
  const refresh = () => {
    select.replaceChildren();
    node("option", t.empty, select).value = "";
    const profiles = store.read();
    listed = new Map(profiles.map((p) => [p.id, p]));
    for (const p of profiles) {
      const option = node(
        "option",
        `${p.label} · ${p.advanceMs} ms · ${p.sampleRate} Hz · ${t.uncalibrated}`,
        select,
      );
      option.value = p.id;
    }
    select.value = "";
  };
  const run = (fn) => {
    try {
      fn();
    } catch (e) {
      if (["profileSelectionStale", "profileMissing"].includes(e.code)) {
        try {
          refresh();
        } catch {
          /* Keep the original action failure visible. */
        }
      }
      message(t.errors[e.code] ?? t.errors.profileValueInvalid);
    }
  };
  const button = (text, action, fn) => {
    const b = node("button", text, controls);
    b.type = "button";
    b.dataset.profileAction = action;
    b.dataset.edit = "true";
    b.onclick = () => run(fn);
    return b;
  };
  button(t.save, "save", () => {
    store.save({ label: name.value, advanceMs: getDraft(), sampleRate });
    refresh();
    message(t.saved);
  });
  button(t.load, "load", () => {
    const profile = store.load(
      select.value,
      sampleRate,
      listed.get(select.value),
    );
    setDraft(profile.advanceMs);
    message(t.loaded);
  });
  button(t.remove, "remove", () => {
    store.remove(select.value, listed.get(select.value));
    refresh();
    message(t.removed);
  });
  button(t.refresh, "refresh", () => {
    refresh();
    message(t.uncalibrated);
  });
  const confirm = button(t.confirm, "confirm-clear", () => {
      store.clear();
      refresh();
      confirm.hidden = cancel.hidden = true;
      message(t.cleared);
    }),
    cancel = button(t.cancel, "cancel-clear", () => {
      confirm.hidden = cancel.hidden = true;
    });
  confirm.hidden = cancel.hidden = true;
  button(t.clear, "clear", () => {
    confirm.hidden = cancel.hidden = false;
    confirm.focus();
  });
  run(() => {
    refresh();
    message(t.uncalibrated);
  });
  return element;
}
