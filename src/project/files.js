import { MAX_PROJECT_BYTES, ProjectError, parseProject } from "./schema.js";

export function safeFilename(title, extension) {
  if (!["wav", "perkusi.json"].includes(extension))
    throw new ProjectError("invalidProject");
  const base =
    String(title)
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "perkusi-beat";
  const safeBase = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)
    ? "perkusi-" + base
    : base;
  return safeBase + "." + extension;
}
export async function readProjectFile(file, catalog) {
  if (!file || !/\.perkusi\.json$/i.test(file.name))
    throw new ProjectError("invalidProject");
  if (
    !Number.isFinite(file.size) ||
    file.size <= 0 ||
    file.size > MAX_PROJECT_BYTES
  )
    throw new ProjectError("projectTooLarge");
  let text;
  try {
    text = await file.text();
  } catch {
    throw new ProjectError("fileReadFailed");
  }
  return parseProject(text, catalog);
}
export class FileDelivery {
  constructor({
    url = globalThis.URL,
    document = globalThis.document,
    navigator = globalThis.navigator,
    timers = globalThis,
  } = {}) {
    this.url = url;
    this.document = document;
    this.navigator = navigator;
    this.timers = timers;
    this.urls = new Map();
    this.disposed = false;
  }
  download(blob, name) {
    if (
      this.disposed ||
      !(blob instanceof Blob) ||
      !/^[a-zA-Z0-9_-]+\.(?:wav|perkusi\.json)$/.test(name)
    )
      throw new ProjectError("deliveryFailed");
    let link, url;
    try {
      url = this.url.createObjectURL(blob);
      if (!url.startsWith("blob:")) throw Error();
      link = this.document.createElement("a");
      link.href = url;
      link.download = name;
      this.document.body.append(link);
      link.click();
      this.urls.set(
        url,
        this.timers.setTimeout(() => this.release(url), 1000),
      );
    } catch {
      if (url) this.url.revokeObjectURL(url);
      throw new ProjectError("deliveryFailed");
    } finally {
      link?.remove();
    }
  }
  canShare(file) {
    try {
      return (
        typeof this.navigator?.share === "function" &&
        typeof this.navigator?.canShare === "function" &&
        this.navigator.canShare({ files: [file] })
      );
    } catch {
      return false;
    }
  }
  async share(file) {
    if (this.disposed) throw new ProjectError("deliveryFailed");
    if (!this.canShare(file)) {
      this.download(file, file.name);
      return "shareFallback";
    }
    try {
      await this.navigator.share({ files: [file] });
      return "shared";
    } catch (error) {
      if (error.name === "AbortError") return "shareCancelled";
      this.download(file, file.name);
      return "shareFallback";
    }
  }
  release(url) {
    const timer = this.urls.get(url);
    if (timer !== undefined) this.timers.clearTimeout(timer);
    this.urls.delete(url);
    this.url.revokeObjectURL(url);
  }
  dispose() {
    this.disposed = true;
    for (const url of [...this.urls.keys()]) this.release(url);
  }
}
