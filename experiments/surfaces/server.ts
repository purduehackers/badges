import index from "./index.html";
import { inspectPreview } from "../../src/server/inspect-preview.ts";

const files = new Set([
  "stamp.svg",
  "badge.svg",
  "bottle.svg",
  "fingerprints.png",
  "scratches.png",
]);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 30589,
  maxRequestBodySize: 2 * 1024 * 1024,
  routes: { "/": index },
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/lab/paper.png")
      return new Response(
        Bun.file(`${import.meta.dir}/../../src/renderer/assets/paper-height.png`),
      );
    if (url.pathname === "/lab/inspect" && request.method === "POST")
      return inspectPreview(request);
    const file = url.pathname.slice("/lab/assets/".length);
    if (url.pathname.startsWith("/lab/assets/") && files.has(file))
      return new Response(Bun.file(`${import.meta.dir}/assets/${file}`));
    return new Response("Not found", { status: 404 });
  },
  development: { hmr: true, console: true },
});
console.log(`Stamp and acrylic experiments: ${server.url}`);
