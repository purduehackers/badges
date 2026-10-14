const entrypoints = [
  "src/client.ts",
  "src/workflow/contracts.ts",
  "src/workflow/wire.ts",
  "src/workflow/presentation.ts",
  "src/workflow/inventory-contracts.ts",
  "src/workflow/tools.ts",
  "src/lib/materials.ts",
];
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
