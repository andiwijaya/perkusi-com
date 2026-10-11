import { initAnalytics } from "./analytics.js";
import { initNavigation } from "./app/navigation.js";
import { initLocalization } from "./app/localization.js";

initLocalization();
initNavigation();
document.querySelector("#year").textContent = String(new Date().getFullYear());
initAnalytics();
if (document.body.dataset.page === "beatbox") {
  import("./beatbox/main.js").then(({ initBeatbox }) => initBeatbox());
}
