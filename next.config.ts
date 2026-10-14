import type { NextConfig } from "next";
import { rendererSources } from "./scripts/build-renderer.ts";

export default async function nextConfig(): Promise<NextConfig> {
  return {
    typedRoutes: true,
    reactCompiler: true,
    compiler: { defineServer: await rendererSources() },
    serverExternalPackages: ["@sparticuz/chromium", "@resvg/resvg-js", "puppeteer-core"],
    outputFileTracingIncludes: {
      "/badges/*": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    },
  };
}
