import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as reviews from "../server/db/badge-reviews.ts";
import * as stock from "../server/db/badge-inventory.ts";
import { publicationFiles } from "../server/publisher.ts";
import { previewFiles } from "../server/previews.ts";
import { availableTools } from "../server/tools.ts";
import { DISCORD_GUILD_ID } from "../server/platform.ts";
import { reviewSchema, RUBRIC_VERSION } from "./contracts.ts";
import { createBadgeInventory } from "./inventory.ts";
import { productionSettings } from "./policy.ts";
import { reviewPrompt, reviewStep } from "./presentation.ts";
import { contextHash, remainingCriteria, staticPassed } from "./review.ts";
import { assertControl, createBadgeService } from "./service.ts";
import { createBadgeStore } from "./store.ts";
import { renderSvg } from "./svg.ts";
import { createWorker } from "./worker.ts";
import type { Action } from "./wire.ts";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
  <rect x="1" y="1" width="98" height="48" fill="none" stroke="red" stroke-width="0.01"/>
  <rect x="10" y="10" width="20" height="30" fill="black"/>
</svg>`;

test("badge-only reviews require an explicit choice and publish no stamp artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "badge-only-"));
  const client = createClient({ url: `file:${directory}/badges.db` });
  try {
    const migrations = `${import.meta.dir}/../../migrations`;
    for (const name of [...new Bun.Glob("*.sql").scanSync(migrations)].sort())
      await client.executeMultiple(await Bun.file(`${migrations}/${name}`).text());
    const db = drizzle(client, { schema: { ...reviews, ...stock } });
    const store = createBadgeStore(db);
    const inventory = createBadgeInventory(db);
    const material = { materialId: "opaque-red", thicknessMm: 3.175 };
    const sheet = { widthIn: 4, heightIn: 4, material, quantity: 1 };
    await db.insert(stock.badgeStock).values({
      id: "a".repeat(24),
      ...material,
      widthIn: 4,
      heightIn: 4,
      quantity: 1,
      updatedAt: Date.now(),
    });
    const event = {
      id: "event",
      slug: "hack-night-7-10",
      name: "Hack Night 7.10",
      version: "7.10",
      date: "2026-11-20",
    };
    const cms = { events: async () => [event], event: async () => event };
    const author = { id: "designer", username: "designer" };
    const actor = {
      person: author,
      threadId: "thread",
      guildId: DISCORD_GUILD_ID,
      canManufacture: true,
    };
    const badge = {
      name: "badge.svg",
      hash: await store.putAsset(Buffer.from(svg), "image/svg+xml"),
    };
    const initial = reviewSchema.parse({
      id: crypto.randomUUID(),
      threadId: actor.threadId,
      sourceMessageId: "upload",
      author,
      generation: 0,
      rubric: RUBRIC_VERSION,
      uploads: [badge],
      badge,
      rolesConfirmed: true,
      event,
      materials: [material],
      sheetBatch: [sheet],
      settings: productionSettings(),
      checks: [],
      previews: [],
      layouts: [],
      decisions: [],
    });
    await store.save({ review: initial, actorId: author.id, eventId: "upload", jobs: [] });
    const service = createBadgeService(store, cms, inventory);
    const act = async (action: Action) => {
      const current = await service.read(actor.threadId);
      return service.action(current.review.id, current.version, actor, action, crypto.randomUUID());
    };
    expect(reviewStep(initial)).toBe("missing");
    expect(availableTools({ review: initial, version: 0 }, actor)).toContain("skip_stamp");
    expect(() =>
      assertControl(
        initial,
        { ...actor, person: { id: "other", username: "other" } },
        { kind: "skip-stamp" },
      ),
    ).toThrow();
    expect(() =>
      assertControl({ ...initial, stamp: badge }, actor, { kind: "skip-stamp" }),
    ).toThrow();
    const skipped = await act({ kind: "skip-stamp" });
    expect(skipped.review.stampSkipped).toBe(true);
    expect(contextHash(skipped.review)).not.toBe(contextHash(initial));
    expect(availableTools(skipped, actor)).not.toContain("skip_stamp");
    await expect(
      service.action(initial.id, 0, actor, { kind: "skip-stamp" }, "stale"),
    ).rejects.toThrow();

    const worker = createWorker(
      store,
      cms,
      {
        archive: async (review) => {
          const files = await publicationFiles(review, store);
          expect([...files.keys()].some((name) => name.includes("stamp"))).toBe(false);
          expect(files.has("badge.svg")).toBe(true);
          expect(files.has("badge-source.svg")).toBe(true);
          expect(new TextDecoder().decode(files.get("README.md"))).not.toContain("Stamp");
          return { commit: "a".repeat(40), url: "https://example.test/badge" };
        },
        publish: async () => {
          throw new Error("Already archived at the publication commit.");
        },
        link: async () => "https://example.test/badge-link",
      },
      async (badgeSvg, stampSvg) => {
        expect(stampSvg).toBeUndefined();
        return { badge: renderSvg(badgeSvg) };
      },
      inventory,
    );
    const drain = async () => {
      for (let i = 0; i < 12; i++) if (!(await worker.process())) return;
      throw new Error("Badge jobs did not settle.");
    };
    await drain();
    const checked = await service.read(actor.threadId);
    expect(checked.review.failure).toBeUndefined();
    expect(reviewStep(checked.review)).toBe("qa");
    expect(checked.review.checks).toHaveLength(6);
    expect(staticPassed(checked.review)).toBe(true);
    expect(staticPassed({ ...checked.review, stampSkipped: false })).toBe(false);
    expect(remainingCriteria(checked.review)).toEqual(["badge"]);
    expect(checked.review.manufacturing?.stamp).toBeUndefined();
    expect((await previewFiles(checked.review, store))[0]?.name).toBe("quality-check.png");
    expect(reviewPrompt(checked.review)).not.toContain("stamp");
    await expect(act({ kind: "publish" })).rejects.toThrow();
    await act({ kind: "confirm" });
    await act({ kind: "quantity", count: 2 });
    await drain();
    const arranged = await service.read(actor.threadId);
    expect(arranged.review.failure).toBeUndefined();
    expect(reviewStep(arranged.review)).toBe("layout");
    await act({ kind: "publish" });
    await drain();
    const published = await service.read(actor.threadId);
    expect(published.review.failure).toBeUndefined();
    expect(reviewStep(published.review)).toBe("done");
    expect(reviewPrompt(published.review)).toBe("Your badge and cutting sheets are saved.");
    expect((await db.select().from(stock.badgeStock))[0]?.quantity).toBe(0);
    expect(await db.select().from(stock.badgeStockPublications)).toHaveLength(1);
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
