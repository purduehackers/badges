import { handleBadgeRequest } from "../../../server/api.ts";

export const runtime = "nodejs";
export const maxDuration = 300;
export const GET = handleBadgeRequest;
export const POST = handleBadgeRequest;
