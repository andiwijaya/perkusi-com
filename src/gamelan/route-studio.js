import { gamelanHostAllowed } from "./public-context.js";
if (
  !gamelanHostAllowed(location.hostname, import.meta.env.GAMELAN_PUBLIC_BUILD)
)
  throw Error("Local candidate only");
document.body.replaceChildren();
const host = document.createElement("div");
host.id = "instrument-workspace";
document.body.append(host);
let robots = document.querySelector('meta[name="robots"]');
if (!robots) {
  robots = document.createElement("meta");
  robots.name = "robots";
  document.head.append(robots);
}
robots.content = "noindex,nofollow";
await import("./focus-workspace.js");
