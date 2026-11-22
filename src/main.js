import { initAnalytics } from "./analytics.js";
import { initNavigation } from "./app/navigation.js";
import { initLocalization } from "./app/localization.js";
import { handoffRecoveryRedirect } from "./app/legacy-recovery-link.js";
import { initTutorialNavigation } from "./tutorials/navigation.js";
import { initTutorialSearch } from "./tutorials/search.js";

const recoveryRedirect = handoffRecoveryRedirect(location.href);
if (recoveryRedirect) location.replace(recoveryRedirect);
else {
  initLocalization();
  initNavigation();
  initTutorialNavigation();
  initTutorialSearch();
  document.querySelector("#year").textContent = String(
    new Date().getFullYear(),
  );
  initAnalytics();
  if (
    document.body.dataset.page === "instruments" ||
    document.body.dataset.page.startsWith("instrument-")
  ) {
    window.addEventListener("pageshow", (event) => {
      if (event.persisted && document.body.dataset.page !== "instruments")
        location.reload();
    });
    import("./instruments/localize.js")
      .then(({ initInstrumentPages }) => initInstrumentPages())
      .catch(() => {
        const status = document.querySelector("#article-pad-status");
        if (status)
          status.textContent =
            document.documentElement.lang === "id"
              ? "Pemutar belum dapat disiapkan. Muat ulang halaman untuk mencoba lagi."
              : "The player could not initialize. Reload the page to try again.";
      });
  }
  if (document.body.dataset.page === "beatbox") {
    import("./beatbox/main.js").then(({ initBeatbox }) => initBeatbox());
  }

  if (document.body.dataset.page === "studio") {
    // A bfcache-restored document must rebuild its disposed owner from the draft.
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) location.reload();
    });
    import("./studio/main.js").then(({ initStudio }) => initStudio());
  }
  if (document.body.dataset.page === "pads") {
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) location.reload();
    });
    import("./pads/main.js")
      .then(({ initPadStation }) => initPadStation())
      .catch(() => {
        const status = document.querySelector("#ps-status");
        if (status) {
          status.setAttribute("role", "alert");
          status.textContent =
            document.documentElement.lang === "en"
              ? "Could not prepare sounds. Reload the page to try again."
              : "Suara belum dapat disiapkan. Muat ulang halaman untuk mencoba lagi.";
        }
      });
  }
}
