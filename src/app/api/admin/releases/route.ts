import { z } from "zod";

const repository = "purduehackers/badge-designs";
const entry = z.object({ path: z.string(), type: z.string() });

async function github(path: string) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    headers: { Accept: "application/vnd.github+json" },
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error("Could not read the published badge files. Try local files instead.");
  return response.json();
}

export async function GET() {
  try {
    const commit = z
      .object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
      .parse(await github("commits/main"));
    const tree = z
      .object({ tree: z.array(entry), truncated: z.boolean() })
      .parse(await github(`git/trees/${commit.sha}?recursive=1`));
    if (tree.truncated)
      throw new Error("The published file list is incomplete. Use local files instead.");
    const releases = new Map<string, { name: string; url: string }[]>();
    for (const item of tree.tree) {
      const match = /^badges\/([^/]+)\/([^/]+\.svg)$/.exec(item.path);
      if (item.type !== "blob" || !match) continue;
      const [, version, name] = match;
      if (name !== "stamp.svg" && !/^\d+(?:\.\d+)?x\d+(?:\.\d+)?-/.test(name)) continue;
      const files = releases.get(version) ?? [];
      files.push({
        name,
        url: `https://raw.githubusercontent.com/${repository}/${commit.sha}/${item.path.split("/").map(encodeURIComponent).join("/")}`,
      });
      releases.set(version, files);
    }
    return Response.json(
      [...releases]
        .map(([version, files]) => ({ version, files }))
        .sort((a, b) => b.version.localeCompare(a.version, "en", { numeric: true })),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load published files." },
      { status: 502 },
    );
  }
}
