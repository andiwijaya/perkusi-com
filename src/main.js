import { initAnalytics } from "./analytics.js";
import { initNavigation } from "./app/navigation.js";
import { initLocalization } from "./app/localization.js";

const routedInstrumentStudio =
  import.meta.env.GAMELAN_BUILD &&
  new URL(location.href).searchParams.get("workspace") === "gamelan" &&
  document.body.dataset.page === "studio";
if (routedInstrumentStudio) {
  import("./gamelan/route-studio.js");
} else {
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
}
