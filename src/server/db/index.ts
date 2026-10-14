import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as reviews from "./badge-reviews.ts";
import * as inventory from "./badge-inventory.ts";
export * from "./badge-reviews.ts";
export * from "./badge-inventory.ts";
const schema = { ...reviews, ...inventory };
export type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db | undefined;
export function getDb(): Db {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is required.");
  return (db ??= drizzle(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }), {
    schema,
  }));
}
