import type { NextConfig } from "next";
import { rendererDefines } from "./scripts/build-renderer.ts";

export default async function nextConfig(): Promise<NextConfig> {
  return {
    typedRoutes: true,
    reactCompiler: true,
    compiler: { defineServer: await rendererDefines() },
    serverExternalPackages: ["@sparticuz/chromium", "@resvg/resvg-js", "puppeteer-core"],
    outputFileTracingIncludes: {
      "/badges/*": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    },
  };
}
