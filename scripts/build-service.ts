import { rendererSources } from "./build-renderer.ts";

const result = await Bun.build({
  entrypoints: ["./src/server/server.ts"],
  outdir: "./dist",
  target: "bun",
  packages: "external",
  define: Object.fromEntries(
    Object.entries(await rendererSources()).map(([name, source]) => [name, JSON.stringify(source)]),
  ),
});
if (!result.success) throw new AggregateError(result.logs, "Badge service build failed.");
