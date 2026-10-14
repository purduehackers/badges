export {};
async function browser(entrypoint: string) {
  const bundle = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    format: "iife",
    minify: true,
  });
  if (!bundle.success || !bundle.outputs[0]) throw new Error("Badge browser build failed.");
  return bundle.outputs[0].text();
}
const result = await Bun.build({
  entrypoints: ["./src/server/server.ts"],
  outdir: "./dist",
  target: "bun",
  packages: "external",
  define: {
    BADGE_SCENE: JSON.stringify(await browser("./src/renderer/capture.ts")),
    BADGE_VIEWER: JSON.stringify(await browser("./src/renderer/viewer.ts")),
  },
});
if (!result.success) throw new AggregateError(result.logs, "Badge service build failed.");
