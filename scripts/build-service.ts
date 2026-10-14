import { rendererDefines } from "./build-renderer.ts";

const result = await Bun.build({
  entrypoints: ["./src/server/server.ts"],
  outdir: "./dist",
  target: "bun",
  packages: "external",
  define: await rendererDefines(),
});
if (!result.success) throw new AggregateError(result.logs, "Badge service build failed.");
