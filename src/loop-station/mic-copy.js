export const micCopy = Object.freeze({
  id: {
    headphones: "Saya memakai headphone berkabel dan volume rendah",
    monitorOn: "Aktifkan monitoring opsional",
    monitorOff: "Matikan monitoring",
    monitorActive: "Mic siap · monitoring aktif pada gain 0,25",
    monitorGated:
      "Monitoring dibisukan untuk input di luar batas aman; PCM asli tetap utuh",
    clipTotal: "Sampel clipping sejak aktif",
    name: "Mikrofon",
    enable: "Aktifkan Mic",
    stop: "Stop Mic",
    title: "Input mikrofon",
    hint: "Pilih Mikrofon, siapkan trek, lalu aktifkan izin secara sadar. Suara tetap lokal. Monitoring langsung mati; rekaman baru terdengar saat loop diulang.",
    limitation:
      "Monitoring opsional memerlukan headphone berkabel. Input di atas puncak 0,5 dibisukan pada keluaran monitoring; rekaman asli tidak diubah. Latensi perangkat dan kualitas listening BELUM TERVERIFIKASI.",
    meter: "Level input",
    status: "Status mikrofon",
    details: "Detail input",
    converted: "Kanal aktual / sample rate rekaman",
    hardware: "Sample rate input yang dilaporkan browser",
    unsafe:
      "Puncak input melewati batas replay aman 0,5. PCM asli tetap tersedia sebagai rekaman yang perlu dipulihkan; turunkan level input sebelum merekam ulang.",
    states: {
      off: "Mic mati",
      closed: "Mic mati",
      userStop: "Mic dihentikan",
      requesting: "Menunggu izin mic; Stop Mic dapat membatalkan",
      ready: "Mic siap · monitoring mati",
      denied:
        "Izin mic ditolak atau diblokir kebijakan. Instrumen dan demo tetap dapat dipakai.",
      unavailable: "Input mic tidak tersedia. Gunakan instrumen atau demo.",
      error: "Input mic gagal. Hentikan lalu aktifkan kembali.",
      inputLost:
        "Input mic terputus; periksa rekaman sebagian sebelum mencoba lagi.",
      suspended:
        "Mic dilepas saat audio ditangguhkan. Aktifkan kembali secara sadar.",
      muted: "Input mic dibisukan perangkat/browser",
      preparing: "Menunggu probe kanal input",
      micChannelsUnsupported: "Hanya input mono atau stereo yang didukung",
      micProbeTimeout: "Input tidak menghasilkan data untuk probe kanal",
      invalidPCM:
        "Input menghasilkan data nonfinite; rekaman aman sebelumnya dipertahankan",
      channelsChanged: "Jumlah kanal berubah; siapkan ulang input",
      captureCancelled: "Aktivasi mic dibatalkan",
    },
  },
  en: {
    headphones: "I am using wired headphones at low volume",
    monitorOn: "Enable optional monitoring",
    monitorOff: "Disable monitoring",
    monitorActive: "Mic ready · monitoring enabled at gain 0.25",
    monitorGated:
      "Monitor muted for input outside the safe bound; original PCM remains intact",
    clipTotal: "Clipped samples since enable",
    name: "Microphone",
    enable: "Enable Mic",
    stop: "Stop Mic",
    title: "Microphone input",
    hint: "Select Microphone, prepare the track, then deliberately enable permission. Audio stays local. Live monitoring is off; a recording becomes audible when the loop repeats.",
    limitation:
      "Optional monitoring requires wired headphones. Input above peak 0.5 is muted only in the monitor output; original recordings are unchanged. Device latency and listening quality remain UNVERIFIED.",
    meter: "Input level",
    status: "Microphone status",
    details: "Input details",
    converted: "Actual channels / recording sample rate",
    hardware: "Browser-reported input sample rate",
    unsafe:
      "Input exceeded the safe replay peak of 0.5. Original PCM remains available as a recording requiring recovery; lower the input level before recording again.",
    states: {
      off: "Mic off",
      closed: "Mic off",
      userStop: "Mic stopped",
      requesting: "Waiting for mic permission; Stop Mic can cancel",
      ready: "Mic ready · monitoring off",
      denied:
        "Mic permission denied or blocked by policy. Instruments and demos remain usable.",
      unavailable: "Mic input unavailable. Use an instrument or demo.",
      error: "Mic input failed. Stop and deliberately enable again.",
      inputLost:
        "Mic input lost; review the partial recording before retrying.",
      suspended:
        "Mic released when audio suspended. Deliberately enable again.",
      muted: "Mic input muted by device/browser",
      preparing: "Waiting for input channel probe",
      micChannelsUnsupported: "Only mono or stereo input is supported",
      micProbeTimeout: "No input data for channel probe",
      invalidPCM:
        "Nonfinite input; the preceding safe recording prefix is retained",
      channelsChanged: "Input channel count changed; prepare again",
      captureCancelled: "Mic activation canceled",
    },
  },
});
