async function browser(entrypoint: string, define?: Record<string, string>) {
  const bundle = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    format: "iife",
    minify: true,
    define,
  });
  if (!bundle.success || !bundle.outputs[0]) throw new Error("Badge browser build failed.");
  return bundle.outputs[0].text();
}

export async function rendererSources() {
  const paper = Buffer.from(
    await Bun.file("./src/renderer/assets/paper-height.png").arrayBuffer(),
  ).toString("base64");
  return {
    BADGE_SCENE: await browser("./src/renderer/capture.ts", {
      STAMP_PAPER: JSON.stringify(`data:image/png;base64,${paper}`),
    }),
    BADGE_VIEWER: await browser("./src/renderer/viewer.ts"),
  };
}
