---
meta:
  contentType: Reference
---

# Configure the badge service

The Next.js deployment serves the viewer and badge API together. Wack Hacker calls its authenticated HTTP endpoints; the service never signs in to Discord. [The workflow architecture](workflow.md) explains the ownership and confirmation boundaries.

## Commands and processes

Run these commands from the repository root. The `postinstall` script builds the shared JavaScript client and tool schemas for Wack Hacker.

| Command                 | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `bun install`           | Install dependencies and build the client exports |
| `bun run dev`           | Run the Next.js viewer                            |
| `bun run build`         | Build the viewer and badge service                |
| `bun run start`         | Serve the built Next.js viewer                    |
| `bun run migrate`       | Apply badge table migrations                      |
| `bun run start:service` | Serve the built badge API, default port `30588`   |
| `bun run typecheck`     | Check TypeScript                                  |
| `bun run lint`          | Run lint with warnings denied                     |
| `bunx oxfmt --check .`  | Check formatting                                  |

Vercel runs the Next.js routes on Bun. The standalone Bun server is also available for local development. Both entry points use the same request handler. Linux rendering uses bundled Chromium; macOS needs an installed Chromium executable. Wack Hacker calls `/badges/work` after an interaction and once per minute to recover unfinished jobs.

## Service environment

Set these values in the badge service environment. Keep the API secret identical in the service, Wack Hacker bot, and badge Eve agent.

| Variable                                                                | Purpose                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `BADGES_API_SECRET`                                                     | Shared authentication secret, at least 32 characters        |
| `BADGES_PUBLIC_URL`                                                     | Public service origin for signed 3D preview links           |
| `TURSO_DATABASE_URL`                                                    | Badge database URL; local development also accepts `file:`  |
| `TURSO_AUTH_TOKEN`                                                      | Turso authentication token when required                    |
| `PAYLOAD_CMS_API_KEY`                                                   | Read event details and RSVP counts                          |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID` | GitHub App access to `purduehackers/badge-designs`          |
| `VERCEL_API_TOKEN`                                                      | Publish badge redirects for the configured phack.rs project |
| `PORT`                                                                  | Service port, default `30588`                               |
| `BADGES_CHANNEL_ID`                                                     | Optional Discord channel override for local testing         |
| `BADGE_CHROMIUM_EXECUTABLE_PATH`                                        | Local Chromium executable, required on macOS                |

Wack Hacker also needs `BADGES_API_URL` and `BADGE_AGENT_URL`. Those two URLs enable the feature together. The bot also needs `AI_GATEWAY_API_KEY` for initial Luna routing. `BADGES_API_URL` points to this service; `BADGE_AGENT_URL` points to Eve. Set the same `BADGES_CHANNEL_ID` override in all three processes when testing outside #p-badges.

## State and migrations

Use a dedicated Turso database for badges. Production connects to the `badges` Vercel Marketplace resource; preview and development connect to `badges-preview`. Run migrations against each environment before deploying. Wack Hacker accesses badge state through the API and does not need credentials for either database.

The database stores review state, content-addressed assets, observed Discord messages, audit events, leased jobs, material stock, reservations, inventory changes, and publication receipts. Keep this database durable. The migration runner records each applied file and uses a transaction for its statements. Preview inventory is separate from production stock.

## Materials and production policy

Edit `src/lib/materials.ts` to add or change acrylic options. The website, Discord preview, and stock suggestions read that catalog. Inventory commands track quantities separately.

Edit `src/workflow/policy.ts` for badge sizing and spacing. Edit `src/workflow/geometry.ts` for the sheet dimensions and edge margin. The current workflow uses ⅛-inch acrylic, one 12 × 12-inch sheet, and one 12 × 18-inch sheet. It tracks stamp rubber manually; publication deducts the acrylic sheets used in the layout.

## Integration endpoints

Every `POST /badges/*` endpoint requires the shared bearer secret. `GET /badges/view` instead requires a signed asset, material, and thickness tuple.

| Endpoint             | Caller and purpose                                                   |
| -------------------- | -------------------------------------------------------------------- |
| `lookup`             | Bot: check for a saved thread review                                 |
| `submit`, `continue` | Bot: record the observed message and accept its attachments          |
| `status`, `tool`     | Eve: discover available tools, read evidence, and execute an action  |
| `control`, `action`  | Bot: validate or execute a signed Discord interaction                |
| `inventory`          | Bot: execute a stock command with verified membership                |
| `work`, `ack`        | Bot: process a job, deliver the current card, and record its receipt |

Wack Hacker imports the client, contracts, presentation helpers, and tool schemas from this repository at a pinned Git commit. It does not import the renderer, database, or worker. The package install builds those client exports because Eve’s Node.js loader cannot execute TypeScript dependencies from `node_modules`.
