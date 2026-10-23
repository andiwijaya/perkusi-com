import { initAnalytics } from "./analytics.js";
import { initNavigation } from "./app/navigation.js";
import { initLocalization } from "./app/localization.js";
import { handoffRecoveryRedirect } from "./app/legacy-recovery-link.js";

const recoveryRedirect = handoffRecoveryRedirect(location.href);
if (recoveryRedirect) location.replace(recoveryRedirect);
else {
  initLocalization();
  initNavigation();
  document.querySelector("#year").textContent = String(
    new Date().getFullYear(),
  );
  initAnalytics();
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
