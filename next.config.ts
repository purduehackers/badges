import type { NextConfig } from "next";
import { rendererSources } from "./scripts/build-renderer.ts";
import { buildLab } from "./scripts/build-lab.ts";

export default async function nextConfig(): Promise<NextConfig> {
  await buildLab();
  return {
    typedRoutes: true,
    reactCompiler: true,
    compiler: { defineServer: await rendererSources() },
    serverExternalPackages: ["@sparticuz/chromium", "@resvg/resvg-js", "puppeteer-core"],
    outputFileTracingIncludes: {
      "/badges/*": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    },
    async rewrites() {
      return [{ source: "/lab", destination: "/lab/index.html" }];
    },
  };
}
