export const deviceProfileCopy = {
  id: {
    title: "Profil offset perangkat lokal (opsional)",
    hint: "BELUM DIKALIBRASI: profil hanya menyimpan offset manual dan nama pilihan Anda di browser ini. Tidak ada deteksi perangkat atau pengukuran latensi. Pilih ulang profil dan periksa perangkat/rute setelah perubahan. Memuat profil hanya mengisi angka di atas; gunakan Preview lalu Simpan posisi untuk mengubah proyek. Profil tidak ikut ekspor proyek.",
    name: "Nama ringkas pilihan Anda (maks. 48 karakter)",
    save: "Simpan angka sebagai profil baru",
    select: "Profil tersimpan",
    empty: "Pilih profil secara sadar",
    load: "Isi angka dari profil",
    remove: "Hapus profil terpilih",
    refresh: "Muat ulang daftar profil",
    clear: "Hapus semua profil lokal",
    confirm: "Ya, hapus profil lokal",
    cancel: "Batal",
    uncalibrated: "Belum dikalibrasi",
    saved: "Profil manual tersimpan lokal. Belum dikalibrasi.",
    loaded:
      "Angka diisi. Proyek belum diubah; Preview lalu Simpan posisi bila sesuai.",
    removed: "Profil dihapus; posisi proyek tetap.",
    cleared: "Profil lokal dihapus; posisi proyek tetap.",
    errors: {
      profileStoreInvalid:
        "Data profil tidak didukung/rusak; tetap dipertahankan. Anda dapat menghapus profil lokal secara sadar.",
      profileStorageUnavailable:
        "Penyimpanan profil tidak tersedia. Penyesuaian manual tetap dapat digunakan; profil tidak diklaim tersimpan.",
      profileStorageConflict:
        "Profil berubah di tab lain. Muat ulang daftar dan coba lagi.",
      profileSelectionStale:
        "Profil yang ditampilkan sudah berubah. Pilihan dibersihkan; pilih ulang profil secara sadar. Angka dan proyek belum diubah.",
      profileLimit:
        "Maksimum 8 profil. Hapus profil yang tidak diperlukan dahulu.",
      profileValueInvalid:
        "Isi nama singkat dan offset antara −250 dan 250 ms.",
      profileMissing:
        "Pilih profil yang masih tersedia; muat ulang daftar bila perlu.",
      profileRateMismatch:
        "Sample rate rekaman berbeda dari profil. Pilih profil yang sesuai atau atur manual; angka belum diubah.",
    },
  },
  en: {
    title: "Local device offset profiles (optional)",
    hint: "UNCALIBRATED: profiles store only a manual offset and your chosen name in this browser. No device detection or latency measurement occurs. Explicitly select and check the device/route again after changes. Loading only fills the field above; use Preview then Save position to change the project. Profiles are not exported with projects.",
    name: "Your short name (maximum 48 characters)",
    save: "Save value as a new profile",
    select: "Saved profiles",
    empty: "Explicitly select a profile",
    load: "Fill value from profile",
    remove: "Delete selected profile",
    refresh: "Reload profile list",
    clear: "Delete all local profiles",
    confirm: "Yes, delete local profiles",
    cancel: "Cancel",
    uncalibrated: "Uncalibrated",
    saved: "Manual profile saved locally. Uncalibrated.",
    loaded:
      "Value filled. Project unchanged; Preview then Save position if suitable.",
    removed: "Profile deleted; project position unchanged.",
    cleared: "Local profiles deleted; project position unchanged.",
    errors: {
      profileStoreInvalid:
        "Unsupported/corrupt profile data is preserved. You can explicitly delete local profiles.",
      profileStorageUnavailable:
        "Profile storage is unavailable. Manual adjustment still works; no profile is claimed saved.",
      profileStorageConflict:
        "Profiles changed in another tab. Reload the list and retry.",
      profileSelectionStale:
        "The displayed profile changed. Selection cleared; explicitly select again. The value and project were not changed.",
      profileLimit: "Maximum 8 profiles. Delete an unwanted profile first.",
      profileValueInvalid:
        "Enter a short name and an offset between −250 and 250 ms.",
      profileMissing: "Select an available profile; reload the list if needed.",
      profileRateMismatch:
        "Recording sample rate differs from the profile. Choose a matching profile or adjust manually; the value was not changed.",
    },
  },
};
