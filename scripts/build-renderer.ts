async function browser(entrypoint: string) {
  const bundle = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    format: "iife",
    minify: true,
  });
  if (!bundle.success || !bundle.outputs[0]) throw new Error("Badge browser build failed.");
  return JSON.stringify(await bundle.outputs[0].text());
}

export async function rendererDefines() {
  return {
    BADGE_SCENE: await browser("./src/renderer/capture.ts"),
    BADGE_VIEWER: await browser("./src/renderer/viewer.ts"),
  };
}
