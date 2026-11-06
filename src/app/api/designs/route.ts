import { ZodError } from "zod";
import { designInput, packingInput, type CheckedDesign } from "@/lib/designs";
import { stockMaterial } from "@/lib/materials";
import { inspectSvg, renderSvg } from "@/workflow/svg";
import { physicalSvg } from "@/workflow/manufacturing";
import { findingGuidance, verificationLabels, failureGuidance } from "@/workflow/presentation";
import { pack } from "@/workflow/packing";
import { productionSettings } from "@/workflow/policy";
import { expandSheets, sheetFileNames } from "@/workflow/sheets";
import { createBadgeInventory } from "@/workflow/inventory";
import { getDb } from "@/server/db";
import { cms } from "@/server/cms";
import { hash } from "@/workflow/contracts";
import type { DesignRole, DesignUpload } from "@/lib/designs";

export const runtime = "nodejs";
export const maxDuration = 60;
const image = (bytes: Uint8Array) =>
  `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

function check(file: DesignUpload, role: DesignRole): CheckedDesign {
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
    const source = physicalSvg(badge.svg, "badge", 2.2, false);
    const result = await pack(
      source,
      inspectSvg(source, "badge").cuts,
      {
        ...productionSettings(),
        badgeSizeIn: Math.max(input.minSizeIn, Math.min(2.2, input.maxSizeIn)),
      },
      store,
      expandSheets(input.sheets),
      { target: input.target, minSizeIn: input.minSizeIn, maxSizeIn: input.maxSizeIn },
    );
    const layout = result.layouts[0]!;
    const names = sheetFileNames(layout.sheetSizes);
    const previewSvg = physicalSvg(badge.svg, "badge", layout.sizeIn, false);
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
        ...sheet,
        materialId: sheet.material!.materialId,
        count: layout.placements.filter((pose) => pose.sheet === index).length,
      })),
      files: [
        ...files,
        {
          name: "stamp.svg",
          svg: physicalSvg(stamp.svg, "stamp", 1.5, true),
          kind: "stamp",
          thicknessMm: 2.3,
          previewSvg: physicalSvg(stamp.svg, "stamp", 1.5, false),
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
