import { inspectSvg } from "../workflow/svg.ts";

export async function inspectPreview(request: Request) {
  try {
    const role = new URL(request.url).searchParams.get("role");
    if (role !== "stamp" && role !== "badge")
      return Response.json({ error: "Choose a badge or stamp SVG." }, { status: 400 });
    const result = inspectSvg(await request.text(), role);
    const failed = result.checks.filter((check) => check.status !== "pass");
    if (failed.length)
      return Response.json(
        { error: failed.map((check) => check.detail).join(" ") },
        { status: 400 },
      );
    return Response.json({ svg: result.source });
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : "Could not read the SVG." },
      { status: 400 },
    );
  }
}
