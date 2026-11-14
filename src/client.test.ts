import { afterAll, expect, test } from "bun:test";
import { BadgeApiError, createBadgeClient } from "./client.ts";
import { badgeEndpoints } from "./workflow/api.ts";

const latest = "https://discord.com/channels/1/2/3";
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (request.headers.get("authorization") !== "Bearer test-secret")
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    const path = new URL(request.url).pathname;
    if (path === "/badges/status") {
      badgeEndpoints.status.request.parse(await request.json());
      return Response.json({
        tools: ["get_review"],
        next: "Confirm designs.",
        step: "qa",
        quantity: 90,
      });
    }
    const { threadId } = badgeEndpoints.lookup.request.parse(await request.json());
    if (threadId === "stale")
      return Response.json({ error: "Use the latest step.", url: latest }, { status: 409 });
    if (threadId === "invalid") return Response.json({ exists: "yes" });
    return Response.json({ exists: true });
  },
});
afterAll(() => server.stop(true));
const client = createBadgeClient(server.url.origin, "test-secret");

test("the shared client validates responses and preserves agent evidence", async () => {
  expect(await client.post("lookup", { threadId: "current" })).toEqual({ exists: true });
  expect(
    await client.post("status", { threadId: "current", messageId: "message", userId: "designer" }),
  ).toEqual({
    tools: ["get_review"],
    next: "Confirm designs.",
    step: "qa",
    quantity: 90,
  });
  await expect(client.post("lookup", { threadId: "invalid" })).rejects.toThrow();
});

test("stale controls retain the link used by Discord recovery", async () => {
  const error = await client.post("lookup", { threadId: "stale" }).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(BadgeApiError);
  expect(error).toMatchObject({ message: "Use the latest step.", url: latest });
  await expect(
    createBadgeClient(server.url.origin, "wrong").post("lookup", { threadId: "current" }),
  ).rejects.toThrow("Unauthorized");
});
