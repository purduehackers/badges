import { createClient } from "@libsql/client";
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL is required.");
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
try {
  await client.execute("CREATE TABLE IF NOT EXISTS badge_migrations (name TEXT PRIMARY KEY)");
  for (const name of [...new Bun.Glob("*.sql").scanSync("migrations")].sort()) {
    const existing = await client.execute({
      sql: "SELECT name FROM badge_migrations WHERE name = ?",
      args: [name],
    });
    if (existing.rows.length) continue;
    const sql = await Bun.file(`migrations/${name}`).text();
    await client.batch(
      [
        ...sql
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean),
        { sql: "INSERT INTO badge_migrations VALUES (?)", args: [name] },
      ],
      "write",
    );
    console.log(`Applied ${name}`);
  }
} finally {
  client.close();
}
