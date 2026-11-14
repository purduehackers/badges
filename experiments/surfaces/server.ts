import index from "./index.html";
import { inspectSvg } from "../../src/workflow/svg.ts";
import { criterionSchema } from "../../src/workflow/contracts.ts";

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
      try {
        const role = criterionSchema.parse(url.searchParams.get("role"));
        const result = inspectSvg(await request.text(), role);
        const failed = result.checks.filter((check) => check.status !== "pass");
        if (failed.length) throw new Error(failed.map((check) => check.detail).join(" "));
        return Response.json({ svg: result.source });
      } catch (cause) {
        return Response.json(
          { error: cause instanceof Error ? cause.message : "Could not read the SVG." },
          { status: 400 },
        );
      }
    const file = url.pathname.slice("/lab/assets/".length);
    if (url.pathname.startsWith("/lab/assets/") && files.has(file))
      return new Response(Bun.file(`${import.meta.dir}/assets/${file}`));
    return new Response("Not found", { status: 404 });
  },
  development: { hmr: true, console: true },
});
console.log(`Stamp and acrylic experiments: ${server.url}`);
