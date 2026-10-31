import { z } from "zod";
import { RUBY_PROFILE_NAMES, type RubyConnection } from "./ruby-production";
import { fitsBed, overlaps, svgPhysicalSize, type BedPoint } from "./ruby-bed";

export const SIMULATOR_KEY = "ruby-simulator-v3";
export const SIMULATOR_CONNECTION_KEY = "ruby-simulator-connection-v3";
const simulatorSchema = z.object({
  id: z.uuid(),
  updatedAt: z.number(),
  playing: z.boolean(),
  jobs: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      trackingNumber: z.string(),
      availableAt: z.number(),
      duration: z.number(),
      elapsed: z.number(),
      kind: z.enum(["badge", "stamp"]),
      size: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
      origin: z.object({ x: z.number(), y: z.number() }).optional(),
      status: z.enum(["Ready", "Running", "Paused", "Finished", "NeedsAlignment"]),
    }),
  ),
});
export type RubySimulation = z.infer<typeof simulatorSchema>;
export type SimulationAction =
  | { type: "start" | "pause" | "newBatch" }
  | { type: "startStamp"; jobId: string; origin: BedPoint };
const profiles = [
  { id: "00000000-0000-4000-8000-000000000001", name: RUBY_PROFILE_NAMES.badge },
  { id: "00000000-0000-4000-8000-000000000002", name: RUBY_PROFILE_NAMES.stamp },
];

export function createSimulation(): RubyConnection {
  const existing = localStorage.getItem(SIMULATOR_KEY);
  const state = existing
    ? simulatorSchema.parse(JSON.parse(existing))
    : {
        id: crypto.randomUUID(),
        updatedAt: Date.now(),
        playing: false,
        jobs: [],
      };
  localStorage.setItem(SIMULATOR_KEY, JSON.stringify(state));
  return {
    simulated: true,
    baseUrl: "https://ruby-simulator.invalid",
    token: "simulation",
    targetDevice: `SIM-${state.id}`,
    displayName: "Simulated laser",
  };
}

export function readSimulation(connection: RubyConnection) {
  if (!connection.simulated) throw new Error("Choose a simulated laser first.");
  const state = simulatorSchema.parse(JSON.parse(localStorage.getItem(SIMULATOR_KEY) ?? "{}"));
  if (connection.targetDevice !== `SIM-${state.id}`)
    throw new Error("This simulated laser has changed. Connect again.");
  return state;
}

// Advance from wall time so reloads and background tabs agree.
function advance(state: RubySimulation) {
  const now = Math.max(Date.now(), state.updatedAt);
  let cursor = state.updatedAt;
  state.updatedAt = now;
  const next = state.jobs.find((job) => job.status !== "Finished");
  if (next?.kind === "stamp" && !next.origin && next.availableAt <= now) {
    next.status = "NeedsAlignment";
    state.playing = false;
  }
  if (!state.playing) return;
  for (const job of state.jobs) {
    if (job.status === "Finished") continue;
    cursor = Math.max(cursor, job.availableAt);
    if (cursor > now) return;
    if (job.kind === "stamp" && !job.origin) {
      job.status = "NeedsAlignment";
      state.playing = false;
      return;
    }
    const seconds = (now - cursor) / 1000;
    const elapsed = Math.min(seconds, job.duration - job.elapsed);
    job.elapsed += elapsed;
    cursor += elapsed * 1000;
    job.status = job.elapsed >= job.duration ? "Finished" : "Running";
    if (job.status === "Running") return;
  }
  state.playing = false;
}

async function updateSimulation<T>(
  connection: RubyConnection,
  update: (state: RubySimulation) => T,
) {
  return navigator.locks.request(SIMULATOR_KEY, () => {
    const state = readSimulation(connection);
    advance(state);
    const result = update(state);
    localStorage.setItem(SIMULATOR_KEY, JSON.stringify(state));
    return result;
  });
}

export function controlSimulation(connection: RubyConnection, action: SimulationAction) {
  return updateSimulation(connection, (state) => {
    switch (action.type) {
      case "start":
        if (state.jobs.some((job) => job.status === "NeedsAlignment"))
          throw new Error("Align the stamp before starting.");
        state.playing = state.jobs.some((job) => job.status !== "Finished");
        advance(state);
        break;
      case "startStamp": {
        const job = state.jobs.find((item) => item.status !== "Finished");
        if (!job || job.id !== action.jobId || job.status !== "NeedsAlignment" || state.playing)
          throw new Error("Align the next stamp while the simulator is stopped.");
        const size = job.size;
        if (!size)
          throw new Error("Set the stamp SVG’s width and height in inches or millimeters.");
        if (!fitsBed(action.origin, size)) throw new Error("Keep the entire stamp inside the bed.");
        if (
          state.jobs.some(
            (item) =>
              item.id !== job.id &&
              item.kind === "stamp" &&
              item.origin &&
              item.size &&
              overlaps(action.origin, size, item.origin, item.size),
          )
        )
          throw new Error("That area has already been used. Choose an empty spot.");
        job.origin = action.origin;
        job.status = "Running";
        state.playing = true;
        break;
      }
      case "pause":
        state.playing = false;
        break;
      case "newBatch":
        state.jobs = [];
        state.playing = false;
        break;
    }
    if (!state.playing)
      for (const job of state.jobs) if (job.status === "Running") job.status = "Paused";
    return state;
  });
}

/** Ruby's wire responses, consumed by the same client and queue reconciliation as a real device. */
export async function simulationRequest(
  connection: RubyConnection,
  path: string,
  body?: FormData | string,
) {
  const file = body instanceof FormData ? body.get("uploadedFiles") : undefined;
  const size = file instanceof File ? svgPhysicalSize(await file.text()) : undefined;
  return updateSimulation(connection, (state) => {
    const url = new URL(path, "https://ruby-simulator.invalid/");
    const queued = state.jobs.filter((job) => job.availableAt <= Date.now());
    const job = queued.find((item) => item.status !== "Finished");
    switch (url.pathname) {
      case "/GetDeviceStatus":
        return Response.json({
          serialNo: connection.targetDevice,
          model: "SIMULATED_SPEEDY_400",
          status: job?.status ?? "Ready",
          jobName: job?.name,
          progress: job ? (job.elapsed / job.duration) * 100 : 0,
          remainingTime: job ? job.duration - job.elapsed : 0,
        });
      case "/GetQueueElements":
        return Response.json(queued.filter((item) => item.status !== "Finished"));
      case "/GetJobsStatus":
        return Response.json(
          queued.filter((item) => item.trackingNumber === url.searchParams.get("trackingNumber")),
        );
      case "/GetImportProfiles":
        return Response.json(profiles);
      case "/GetWorkbenches":
        return Response.json(state.jobs);
      case "/UploadFromMany": {
        if (!profiles.some((profile) => profile.id === url.searchParams.get("importProfileId")))
          return Response.json({ code: "ERR_IMPORTPROFILE_002" }, { status: 400 });
        const trackingNumber = url.searchParams.get("trackingNumber");
        if (!(file instanceof File) || !trackingNumber)
          return Response.json({ code: "INVALID_FILE" }, { status: 400 });
        if (!state.jobs.some((item) => item.trackingNumber === trackingNumber))
          state.jobs.push({
            id: crypto.randomUUID(),
            name: file.name.replace(/\.svg$/i, ""),
            trackingNumber,
            availableAt: Date.now() + 750,
            duration: 60,
            elapsed: 0,
            kind: url.searchParams.get("importProfileId") === profiles[1].id ? "stamp" : "badge",
            size,
            status: "Ready",
          });
        return Response.json({});
      }
      case "/EnqueueWorkbench": {
        const ids = z.array(z.string()).parse(JSON.parse(typeof body === "string" ? body : "[]"));
        if (ids.some((id) => !state.jobs.some((item) => item.id === id)))
          return Response.json({ code: "UNKNOWN_WORKBENCH" }, { status: 400 });
        for (const item of state.jobs) if (ids.includes(item.id)) item.availableAt = Date.now();
        return Response.json({});
      }
      default:
        return Response.json({ code: "NOT_IMPLEMENTED" }, { status: 404 });
    }
  });
}
