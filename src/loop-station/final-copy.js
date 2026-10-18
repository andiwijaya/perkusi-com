export const finalCopy = {
  id: {
    title: "Mix akhir & WAV",
    intro:
      "Render snapshot proyek saat ini: semua clip, level, EQ dan limiter. Audio take asli tetap utuh. FX diubah saat playback berhenti. File baru mengikuti pengaturan saat Render ditekan.",
    bars: "Panjang",
    render: "Render WAV mix akhir",
    preview: "Dengar pratinjau WAV",
    cancel: "Batalkan render",
    download: "Unduh WAV mix akhir",
    share: "Bagikan WAV / unduh",
    sharing: "Menunggu hasil berbagi; file tetap ditahan sampai selesai.",
    clear: "Tutup hasil WAV",
    eq: "EQ tiga band",
    bypass: "Bypass EQ",
    low: "Rendah ≤200 Hz",
    mid: "Tengah 200–3000 Hz",
    high: "Tinggi ≥3000 Hz",
    limiter: "Soft limiter master",
    limiterHint:
      "Knee 0,80; ceiling 0,95. Mengubah puncak keras tanpa auto-normalisasi. Boost EQ tetap harus lolos headroom.",
    fxHint:
      "EQ memakai crossover orde pertama; tail EQ 100 ms, latency FX 0 frame. Mengubah FX menghentikan playback dan mereset state.",
    phase: {
      preparing: "Menyiapkan audio",
      rendering: "Merender mix",
      checking: "Memeriksa level",
      encoding: "Menulis WAV",
    },
    ready: "WAV siap",
    peak: "Peak sebelum / sesudah limiter",
    limited: "sampel terkena knee",
    fallback: "Web Share tidak tersedia; WAV diunduh.",
    errors: {
      invalidLoopFX:
        "Parameter EQ/limiter tidak valid. Proyek sebelumnya tetap utuh.",
      loopFXUnavailable:
        "EQ/limiter tidak didukung browser ini. Proyek sebelumnya tetap utuh.",
      finalMixBusy:
        "Render sedang berjalan. Batalkan atau tunggu sampai selesai.",
      finalShareBusy: "Proses berbagi sebelumnya belum selesai.",
      finalMixLength:
        "Pilih 4 atau 8 bar; batas render 40 detik dan anggaran memori bersama tetap berlaku.",
      finalMixPeriodMismatch:
        "Pilih panjang export yang memuat siklus rekaman penuh; take tidak dipotong diam-diam.",
      finalMixBoundary:
        "Boundary offline tidak sesuai; WAV tidak dibuat dan audio asli tetap utuh.",
      unsafeOutput:
        "Level render melewati batas aman 0,95. Tidak ada clipping yang disembunyikan atau normalisasi otomatis.",
      recordBusy:
        "Hentikan/review input rekaman dahulu; snapshot hanya memuat audio yang sudah masuk proyek.",
    },
  },
  en: {
    title: "Final mix & WAV",
    intro:
      "Render a current-project snapshot: all clips, levels, EQ and limiter. Original take audio stays intact. FX edits stop playback. A new file uses the settings when Render was pressed.",
    bars: "Length",
    render: "Render final mix WAV",
    preview: "Preview WAV mix",
    cancel: "Cancel render",
    download: "Download final mix WAV",
    share: "Share WAV / download",
    sharing: "Waiting for sharing to finish; the requested file remains held.",
    clear: "Close WAV result",
    eq: "Three-band EQ",
    bypass: "Bypass EQ",
    low: "Low ≤200 Hz",
    mid: "Mid 200–3000 Hz",
    high: "High ≥3000 Hz",
    limiter: "Master soft limiter",
    limiterHint:
      "Knee 0.80; ceiling 0.95. Shapes loud peaks without auto-normalizing. EQ boosts must still pass headroom admission.",
    fxHint:
      "EQ uses first-order crossovers; EQ tail 100 ms, FX latency 0 frames. FX edits stop playback and reset state.",
    phase: {
      preparing: "Preparing audio",
      rendering: "Rendering mix",
      checking: "Checking levels",
      encoding: "Writing WAV",
    },
    ready: "WAV ready",
    peak: "Peak before / after limiter",
    limited: "samples above the knee",
    fallback: "Web Share unavailable; WAV downloaded.",
    errors: {
      invalidLoopFX:
        "Invalid EQ/limiter parameters. The previous project is intact.",
      loopFXUnavailable:
        "EQ/limiter is unavailable in this browser. The previous project is intact.",
      finalMixBusy: "A render is running. Cancel or wait for completion.",
      finalShareBusy: "The previous share operation has not finished.",
      finalMixLength:
        "Choose 4 or 8 bars; the 40-second render and shared memory limits still apply.",
      finalMixPeriodMismatch:
        "Choose an export length containing full recording cycles; takes are not silently cut.",
      finalMixBoundary:
        "Offline boundary mismatch; no WAV was created and originals are intact.",
      unsafeOutput:
        "Rendered level exceeds the safe 0.95 ceiling. No clipping is hidden and no automatic normalization is applied.",
      recordBusy:
        "Stop/review recording input first; the snapshot includes only audio already in the project.",
    },
  },
};
