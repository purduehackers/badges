import { mountBadge } from "./mount.ts";
async function start() {
  const viewport = document.querySelector("main");
  if (!viewport) throw new Error("Missing preview area.");
  const dispose = await mountBadge(viewport, window.badgeInput, document.querySelector("button"));
  document.querySelector("[role=status]")?.remove();
  window.addEventListener("pagehide", dispose, { once: true });
}
void start().catch(() => {
  const status = document.querySelector("[role=status]");
  if (status)
    status.textContent =
      "Could not open this preview. Reload the page or open the image in Discord.";
});
