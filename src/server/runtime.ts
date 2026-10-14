import { renderBadge } from "../renderer/render.ts";
import { createBadgeService, createBadgeStore, createWorker } from "../workflow/index.ts";
import { createBadgeInventory } from "../workflow/inventory.ts";
import { stockMaterial } from "../lib/materials.ts";
import { getDb } from "./db/index.ts";
import { cms } from "./cms.ts";
import { createPublisher } from "./publisher.ts";

export function runtime() {
  const store = createBadgeStore(getDb());
  const inventory = createBadgeInventory(getDb());
  return {
    store,
    inventory,
    service: createBadgeService(store, cms, inventory),
    worker: createWorker(
      store,
      cms,
      createPublisher(store),
      async (svg, selection) => {
        const material = stockMaterial(selection.materialId);
        if (!material || material.id === "stamp-rubber")
          throw new Error("Choose an acrylic material.");
        return renderBadge({ svg, material, thicknessMm: selection.thicknessMm });
      },
      inventory,
    ),
  };
}
