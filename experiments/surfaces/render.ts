import { Resvg } from "@resvg/resvg-js";
import { rendererSources } from "../../scripts/build-renderer.ts";
import { getMaterial } from "../../src/lib/materials.ts";
import { DEFAULT_STAMP, type StampOptions } from "../../src/renderer/stamp.ts";

const output = process.argv[2] ?? "./dist/surface-experiments";
const build = await Bun.build({
  entrypoints: ["./src/renderer/render.ts"],
  outdir: "./dist/surface-renderer",
  target: "bun",
  packages: "external",
  define: Object.fromEntries(
    Object.entries(await rendererSources()).map(([name, source]) => [name, JSON.stringify(source)]),
  ),
});
if (!build.success) throw new AggregateError(build.logs, "Could not build the renderer.");
const moduleUrl = new URL("../../dist/surface-renderer/render.js", import.meta.url);
const { renderDesigns } = (await import(
  moduleUrl.href
)) as typeof import("../../src/renderer/render.ts");
const svg = await Bun.file(`${import.meta.dir}/assets/bottle.svg`).text();
const stampSvg = await Bun.file(`${import.meta.dir}/assets/stamp.svg`).text();
const runs: { name: string; material: string; settings: StampOptions }[] = [
  { name: "normal", material: "opaque-red", settings: DEFAULT_STAMP },
  {
    name: "dry",
    material: "opaque-black",
    settings: { ...DEFAULT_STAMP, ink: 0.3, pressure: 0.3 },
  },
  {
    name: "heavy",
    material: "transparent-light-blue",
    settings: { ...DEFAULT_STAMP, ink: 0.98, pressure: 0.98 },
  },
  {
    name: "textured",
    material: "pearlescent-arctic-white",
    settings: { ...DEFAULT_STAMP, pressure: 0.5, paper: "textured" },
  },
  {
    name: "tilted",
    material: "opaque-red",
    settings: { ...DEFAULT_STAMP, pressure: 0.38, tilt: 0.9 },
  },
  { name: "no-ink", material: "opaque-red", settings: { ...DEFAULT_STAMP, ink: 0 } },
  { name: "no-pressure", material: "opaque-red", settings: { ...DEFAULT_STAMP, pressure: 0 } },
  { name: "repeat", material: "opaque-red", settings: DEFAULT_STAMP },
];
const results = [];
for (const run of runs) {
  const start = performance.now();
  const result = await renderDesigns({
    svg,
    stampSvg,
    sizeIn: 2.2,
    thicknessMm: 3.175,
    material: getMaterial(run.material),
    stampSettings: run.settings,
  });
  await Bun.write(`${output}/stamp-${run.name}.png`, result.stamp);
  await Bun.write(`${output}/badge-${run.material}.png`, result.badge);
  const durationMs = Math.round(performance.now() - start);
  results.push({ ...run, durationMs });
  console.log(`${run.name}: ${durationMs} ms`);
}
function pixels(png: Buffer) {
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  return new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString("base64")}"/></svg>`,
  ).render().pixels;
}
const baseline = Buffer.from(await Bun.file(`${output}/stamp-no-ink.png`).arrayBuffer());
const empty = pixels(baseline);
const measurements = [];
for (const name of ["normal", "dry", "heavy"]) {
  const data = pixels(Buffer.from(await Bun.file(`${output}/stamp-${name}.png`).arrayBuffer()));
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) if (empty[i]! - data[i]! > 120) dark++;
  measurements.push({
    name,
    darkPixelPercent: Number(((dark / (data.length / 4)) * 100).toFixed(2)),
  });
}
const zeroPressure = Buffer.from(await Bun.file(`${output}/stamp-no-pressure.png`).arrayBuffer());
const normal = Buffer.from(await Bun.file(`${output}/stamp-normal.png`).arrayBuffer());
const repeat = Buffer.from(await Bun.file(`${output}/stamp-repeat.png`).arrayBuffer());
const evidence = {
  purpose: "Appearance comparison, not physical calibration or an accuracy score.",
  sources: { badge: "Hack Night 6.17", stamp: "Hack Night 6.3" },
  runs: results,
  measurements,
  zeroInkMatchesZeroPressure: baseline.equals(zeroPressure),
  sameSeedReproducesImage: normal.equals(repeat),
};
await Bun.write(`${output}/results.json`, JSON.stringify(evidence, undefined, 2));
console.log(JSON.stringify(evidence, undefined, 2));
