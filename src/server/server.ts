import { handleBadgeRequest } from "./api.ts";
import { ingressSecret } from "./env.ts";
ingressSecret();
const server = Bun.serve({
  port: Number(process.env.PORT ?? 30588),
  idleTimeout: 120,
  maxRequestBodySize: 2_000_000,
  fetch: handleBadgeRequest,
});
console.log(`Badge service listening on ${server.url}`);
