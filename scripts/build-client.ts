import { exports as modules } from "../package.json";
const entrypoints = [...new Set(Object.values(modules).map((module) => module.types))];
const result = await Bun.build({
  entrypoints,
  outdir: "dist/client",
  naming: "[name].js",
  target: "node",
  format: "esm",
  packages: "external",
  splitting: true,
});
if (!result.success) throw new AggregateError(result.logs, "Badge client build failed.");
export {};
