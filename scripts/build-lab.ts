export async function buildLab() {
  const result = await Bun.build({
    entrypoints: ["./experiments/surfaces/index.html"],
    outdir: "./public/lab",
    publicPath: "/lab/",
    target: "browser",
    minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, "Badge lab build failed.");
  for await (const file of new Bun.Glob("*").scan("./experiments/surfaces/assets"))
    await Bun.write(
      `./public/lab/assets/${file}`,
      Bun.file(`./experiments/surfaces/assets/${file}`),
    );
  await Bun.write("./public/lab/paper.png", Bun.file("./src/renderer/assets/paper-height.png"));
}
