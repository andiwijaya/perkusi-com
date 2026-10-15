import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, mkdir, copyFile, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function sha(file) {
  const h = createHash("sha256");
  for await (const part of createReadStream(file)) h.update(part);
  return h.digest("hex");
}
export function validateSourceForms(manifest, credits = null) {
  if (
    manifest?.version !== "candidate-1.0.0" ||
    manifest?.namespace !== "cdm-porto-candidate-1.0.0" ||
    !Array.isArray(manifest.archives) ||
    manifest.archives.length !== 102
  )
    throw Error("Invalid source-form manifest");
  const names = new Set();
  for (const a of manifest.archives) {
    if (
      !/^(?:work-\d{6}-source|common-recipes-and-manifest)\.zip$/.test(
        a.name,
      ) ||
      names.has(a.name) ||
      !/^[a-f0-9]{64}$/.test(a.sha256) ||
      !Number.isSafeInteger(a.bytes) ||
      a.bytes < 1 ||
      a.bytes > 25 * 1024 * 1024
    )
      throw Error("Invalid source-form archive");
    names.add(a.name);
  }
  if (!names.has("common-recipes-and-manifest.zip"))
    throw Error("Missing common source form");
  if (
    credits &&
    (credits.rows.length !== 101 ||
      credits.rows.some(
        (r) => !names.has("work-" + r.sampleId.slice(3) + "-source.zip"),
      ))
  )
    throw Error("Missing work source form");
  return manifest;
}
function indexHTML(locale, manifest, credits) {
  const en = locale === "en",
    base = "/source-forms/" + manifest.namespace + "/",
    canonical = "https://perkusi.com" + base + (en ? "en/" : ""),
    heading = en
      ? "Sources, attribution and licenses"
      : "Sumber, atribusi dan lisensi";
  const intro = en
    ? "Download the common archive and the required recording archives. Extract together into an empty folder. Originals, modified PCM profiles, metadata, notices and recipes are included. Musical and cultural validation remain pending."
    : "Unduh arsip umum dan arsip rekaman yang diperlukan. Ekstrak bersama ke folder kosong. Sumber asli, profil PCM modifikasi, metadata, notice dan recipe disertakan. Validasi musik dan budaya masih tertunda.";
  const links = manifest.archives
    .map(
      (a) =>
        `<li><a href="${base + a.name}" download>${escape(a.name)}</a> · ${a.bytes.toLocaleString("en-US")} bytes · SHA256 <code>${a.sha256}</code></li>`,
    )
    .join("");
  const works = credits.rows
    .map(
      (r) =>
        `<li>${escape(r.title)} — ${escape(r.creator)}; <a href="${escape(r.sourcePage)}">${en ? "Original work" : "Rekaman asal"}</a>; <a href="${escape(r.licenseURL)}">CC BY 3.0</a>; <a href="${base}work-${r.sampleId.slice(3)}-source.zip">${en ? "Source archive" : "Arsip sumber"}</a></li>`,
    )
    .join("");
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${heading} — Perkusi</title><link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="id" href="https://perkusi.com${base}"><link rel="alternate" hreflang="en" href="https://perkusi.com${base}en/"><link rel="alternate" hreflang="x-default" href="https://perkusi.com${base}"><link rel="stylesheet" href="${base}source.css"></head><body><main><h1>${heading}</h1><p>${intro}</p><p>Perkusi CDM Porto delivery candidate. Recorded Pedro Augusto &amp; Rui Penha; edited Pedro Augusto; support Jorge Queijo &amp; Maria Mónica. Digitópia / Casa da Música. No endorsement.</p><p>${en ? "Changes: uniform gain0.8, stereo PCM24; explicit48k resampling160/147. No retune, fade or tail trim. Lossless FLAC24 and source encoder are documented in the common archive." : "Perubahan: gain seragam0,8, stereo PCM24; resampling48k160/147 dinyatakan. Tanpa retune, fade atau trim tail. FLAC24 lossless dan source encoder dijelaskan di arsip umum."}</p><p><a href="${base}LICENSE_CC_BY_3.0.txt">CC BY3.0</a> · <a href="${base}LICENSE_ARTISTIC_2.0.txt">Artistic2.0</a> · <a href="${base}NOTICE.txt">Notice</a> · <a href="${base}manifest.json">Manifest</a> · <a href="${base}publication-reference.mjs">${en ? "Publication source recipe" : "Source recipe publikasi"}</a></p><h2>${en ? "102 source archives" : "102 arsip sumber"}</h2><ul>${links}</ul><h2>${en ? "101 recordings" : "101 rekaman"}</h2><ul>${works}</ul></main></body></html>`;
}
export async function copyGamelanSourceForms(root, output) {
  const input = resolve(root, "internal/gamelan-source-forms"),
    credits = JSON.parse(
      await readFile(
        resolve(root, "internal/gamelan-delivery/credits.json"),
        "utf8",
      ),
    ),
    manifest = validateSourceForms(
      JSON.parse(await readFile(join(input, "manifest.json"), "utf8")),
      credits,
    ),
    target = resolve(output, "source-forms", manifest.namespace);
  if (credits.rows.length !== 101 || credits.version !== manifest.version)
    throw Error("Source/recording version mismatch");
  await mkdir(target, { recursive: true });
  for (const a of manifest.archives) {
    const file = join(input, "archives", a.name);
    if ((await stat(file)).size !== a.bytes || (await sha(file)) !== a.sha256)
      throw Error("Source archive hash/size mismatch: " + a.name);
    await copyFile(file, join(target, a.name));
    if ((await sha(join(target, a.name))) !== a.sha256)
      throw Error("Source archive copy mismatch");
  }
  for (const file of [
    "LICENSE_CC_BY_3.0.txt",
    "LICENSE_ARTISTIC_2.0.txt",
    "NOTICE.txt",
    "credits.json",
  ])
    await copyFile(
      resolve(root, "internal/gamelan-delivery", file),
      join(target, file),
    );
  await copyFile(join(input, "manifest.json"), join(target, "manifest.json"));
  await copyFile(
    resolve(root, "scripts/gamelan-source-forms.mjs"),
    join(target, "publication-reference.mjs"),
  );
  await writeFile(
    join(target, "source.css"),
    "body{font:17px/1.6 system-ui,sans-serif;max-width:1100px;margin:auto;padding:24px;color:#243b30;background:#f7f5ee}a{color:#074b85}li{margin:12px 0}code{overflow-wrap:anywhere}",
  );
  await mkdir(join(target, "en"), { recursive: true });
  for (const locale of ["id", "en"])
    await writeFile(
      join(target, locale === "en" ? "en/index.html" : "index.html"),
      indexHTML(locale, manifest, credits),
    );
  return {
    namespace: manifest.namespace,
    archives: manifest.archives.length,
    bytes: manifest.archives.reduce((n, a) => n + a.bytes, 0),
  };
}
