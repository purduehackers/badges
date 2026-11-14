import { ZodError } from "zod";
import { designInput, packingInput, type CheckedDesign } from "@/lib/designs";
import { stockMaterial } from "@/lib/materials";
import { inspectSvg, renderSvg } from "@/workflow/svg";
import { prepareDesign } from "@/workflow/manufacturing";
import { findingGuidance, verificationLabels, failureGuidance } from "@/workflow/presentation";
import { pack } from "@/workflow/packing";
import {
  productionSettings,
  DEFAULT_BADGE_SIZE_IN,
  STAMP_SIZE_IN,
  STAMP_THICKNESS_MM,
} from "@/workflow/policy";
import { expandSheets, sheetFileNames } from "@/workflow/sheets";
import { createBadgeInventory } from "@/workflow/inventory";
import { getDb } from "@/server/db";
import { cms } from "@/server/cms";
import { hash } from "@/workflow/review";

import type { DesignUpload } from "@/lib/designs";
import type { Criterion } from "@/workflow/contracts";

export const runtime = "nodejs";
export const maxDuration = 60;
const image = (bytes: Uint8Array) =>
  `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

function check(file: DesignUpload, role: Criterion): CheckedDesign {
  try {
    const result = inspectSvg(file.svg, role);
    const labels = verificationLabels(role);
    return {
      name: file.name,
      svg: result.source,
      preview: image(renderSvg(result.source)),
      passed: result.checks.every((item) => item.status === "pass"),
      checks: result.checks.map((item) => ({
        id: item.id,
        label: labels[item.id],
        status: item.status,
        guidance: item.status === "pass" ? "" : findingGuidance(item),
      })),
    };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Invalid SVG.";
    return {
      name: file.name,
      svg: "",
      preview: "",
      passed: false,
      checks: [
        {
          id: "supported",
          label: "Readable vector SVG",
          status: "fail",
          guidance: failureGuidance(detail),
        },
      ],
    };
  }
}

export async function GET() {
  const [events, stock] = await Promise.allSettled([
    cms.events(),
    Promise.resolve().then(() => createBadgeInventory(getDb()).acrylic()),
  ]);
  return Response.json(
    {
      events: events.status === "fulfilled" ? events.value : [],
      stock: stock.status === "fulfilled" ? stock.value : [],
      notices: [
        ...(events.status === "rejected"
          ? ["Hack Nights could not load. Enter the version and date below."]
          : []),
        ...(stock.status === "rejected"
          ? ["Inventory could not load. Enter the sheets you have."]
          : []),
      ],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const pair = designInput.parse(body);
    const badge = check(pair.badge, "badge"),
      stamp = check(pair.stamp, "stamp");
    if (!(body && typeof body === "object" && "target" in body))
      return Response.json({ badge, stamp });
    const input = packingInput.parse(body);
    if (!badge.passed || !stamp.passed)
      throw new Error("Fix the highlighted file checks before arranging your badges.");
    for (const sheet of input.sheets) {
      const material = stockMaterial(sheet.material.materialId);
      if (!material || material.id === "stamp-rubber")
        throw new Error("Choose acrylic for each sheet.");
    }
    const assets = new Map<string, Uint8Array>();
    const store = {
      putAsset: async (bytes: Uint8Array) => {
        const id = hash(bytes);
        assets.set(id, bytes);
        return id;
      },
    };
    const source = badge.svg;
    const result = await pack(
      source,
      inspectSvg(source, "badge").cuts,
      {
        ...productionSettings(),
        badgeSizeIn: Math.max(input.minSizeIn, Math.min(DEFAULT_BADGE_SIZE_IN, input.maxSizeIn)),
      },
      store,
      expandSheets(input.sheets),
      { target: input.target, minSizeIn: input.minSizeIn, maxSizeIn: input.maxSizeIn },
    );
    const layout = result.layouts[0]!;
    const names = sheetFileNames(layout.sheetSizes);
    const { previewSvg } = prepareDesign(badge.svg, "badge", layout.sizeIn);
    const stampFile = prepareDesign(stamp.svg, "stamp", STAMP_SIZE_IN);
    const files = layout.sheets.map((id, index) => ({
      name: names[index]!,
      svg: Buffer.from(assets.get(id)!).toString("utf8"),
      kind: "badge" as const,
      materialId: layout.sheetSizes[index]!.material!.materialId,
      thicknessMm: layout.sheetSizes[index]!.material!.thicknessMm,
      previewSvg,
    }));
    return Response.json({
      count: layout.count,
      sizeIn: layout.sizeIn,
      widthIn: layout.widthIn,
      heightIn: layout.heightIn,
      preview: image(assets.get(layout.preview)!),
      shortfall: result.shortfall,
      sheets: layout.sheetSizes.map((sheet, index) => ({
        widthIn: sheet.widthIn,
        heightIn: sheet.heightIn,
        materialId: sheet.material!.materialId,
        count: layout.placements.filter((pose) => pose.sheet === index).length,
      })),
      files: [
        ...files,
        {
          name: "stamp.svg",
          svg: stampFile.svg,
          kind: "stamp",
          thicknessMm: STAMP_THICKNESS_MM,
          previewSvg: stampFile.previewSvg,
        },
      ],
    });
  } catch (cause) {
    const error =
      cause instanceof ZodError
        ? cause.issues[0]?.path[0] === "target"
          ? "Enter a whole number of badges between 1 and 500."
          : "Check your SVG files, sheet quantities, and size range, then try again."
        : cause instanceof Error
          ? cause.message
          : "Could not read these designs.";
    return Response.json({ error }, { status: 400 });
  }
}
