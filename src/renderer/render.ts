import { inspectSvg } from "../workflow/svg.ts";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

import type { DesignRenderInput } from "./types.ts";

declare const BADGE_SCENE: string;

export { viewerPage } from "./viewer-page.ts";

/** Each job uses a fresh browser profile; it never accesses a signed-in browser. */
export async function renderDesigns(
  input: DesignRenderInput,
): Promise<{ badge: Uint8Array; stamp: Uint8Array }> {
  const inspected = inspectSvg(input.svg, "badge");
  const stamp = inspectSvg(input.stampSvg, "stamp");
  if ([...inspected.checks, ...stamp.checks].some((check) => check.status !== "pass"))
    throw new Error("Check both SVGs before rendering the designs.");
  if (!Number.isFinite(input.thicknessMm) || input.thicknessMm <= 0 || input.thicknessMm > 100)
    throw new Error("Invalid preview thickness.");
  const localExecutable = process.env.BADGE_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;
  const browser = await puppeteer.launch({
    executablePath: localExecutable ?? (await chromium.executablePath()),
    args: localExecutable
      ? ["--enable-unsafe-swiftshader"]
      : chromium.args.filter(
          (arg) => !["--disable-web-security", "--allow-running-insecure-content"].includes(arg),
        ),
    headless: "shell",
    timeout: 20_000,
    protocolTimeout: 40_000,
  });
  // Close the browser even when triangulation or WebGL stops responding.
  const deadline = setTimeout(() => {
    browser.process()?.kill("SIGKILL");
  }, 45_000);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 640, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (["data:", "blob:", "about:"].some((prefix) => request.url().startsWith(prefix)))
        void request.continue();
      else void request.abort();
    });
    await page.setContent('<html><body style="margin:0"></body></html>');
    await page.addScriptTag({ content: BADGE_SCENE });
    const data = await page.evaluate((options) => window.renderDesigns(options), {
      ...input,
      svg: inspected.source,
      stampSvg: stamp.source,
    });
    function png(value: string) {
      if (!value.startsWith("data:image/png;base64,"))
        throw new Error("Design preview is not a PNG.");
      return Buffer.from(value.slice("data:image/png;base64,".length), "base64");
    }
    return { badge: png(data.badge), stamp: png(data.stamp) };
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}
