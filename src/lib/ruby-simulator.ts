import { z } from "zod";
import { RUBY_PROFILE_NAMES, type RubyConnection } from "./ruby-production";
import { fitsBed, overlaps, svgPhysicalSize, type BedPoint, type BedSize } from "./ruby-bed";

export const SIMULATOR_KEY = "ruby-simulator-v1";
export const SIMULATOR_CONNECTION_KEY = "ruby-simulator-connection-v1";
const simulatorSchema = z.object({
  id: z.uuid(),
  updatedAt: z.number(),
  playing: z.boolean(),
  speed: z.union([z.literal(1), z.literal(10), z.literal(60)]),
  jobSeconds: z.number().int().min(5).max(3600),
  lidOpen: z.boolean(),
  offline: z.boolean(),
  rejectNextUpload: z.boolean(),
  jobs: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      trackingNumber: z.string(),
      availableAt: z.number(),
      duration: z.number(),
      elapsed: z.number(),
      kind: z.enum(["badge", "stamp"]).optional(),
      size: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
      origin: z.object({ x: z.number(), y: z.number() }).optional(),
      status: z.enum(["Ready", "Running", "Paused", "Finished", "NeedsAlignment"]),
    }),
  ),
});
export type RubySimulation = z.infer<typeof simulatorSchema>;
export type SimulationAction =
  | { type: "start" | "pause" | "reset" }
  | { type: "speed"; value: RubySimulation["speed"] }
  | { type: "jobSeconds"; value: number }
  | { type: "align"; jobId: string; origin: BedPoint; size?: BedSize }
  | { type: "lidOpen" | "offline" | "rejectNextUpload"; value: boolean };
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
        speed: 1,
        jobSeconds: 60,
        lidOpen: false,
        offline: false,
        rejectNextUpload: false,
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
  for (const job of state.jobs)
    job.kind ??= /(?:^|-)stamp(?:--[a-f\d]+)?$/i.test(job.name) ? "stamp" : "badge";
  return state;
}

// Advance from wall time so reloads, background tabs and faster playback agree.
function advance(state: RubySimulation) {
  const now = Math.max(Date.now(), state.updatedAt);
  let cursor = state.updatedAt;
  state.updatedAt = now;
  const next = state.jobs.find((job) => job.status !== "Finished");
  if (next?.kind === "stamp" && !next.origin && next.availableAt <= now) {
    next.status = "NeedsAlignment";
    state.playing = false;
  }
  if (!state.playing || state.lidOpen) return;
  for (const job of state.jobs) {
    if (job.status === "Finished") continue;
    cursor = Math.max(cursor, job.availableAt);
    if (cursor > now) return;
    if (job.kind === "stamp" && !job.origin) {
      job.status = "NeedsAlignment";
      state.playing = false;
      return;
    }
    const seconds = ((now - cursor) / 1000) * state.speed;
    const elapsed = Math.min(seconds, job.duration - job.elapsed);
    job.elapsed += elapsed;
    cursor += (elapsed / state.speed) * 1000;
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
        if (state.lidOpen) throw new Error("Close the simulated lid before starting.");
        if (state.offline) throw new Error("Reconnect the simulated laser before starting.");
        if (state.jobs.some((job) => job.status === "NeedsAlignment"))
          throw new Error("Align the stamp before starting.");
        state.playing = state.jobs.some((job) => job.status !== "Finished");
        advance(state);
        break;
      case "align": {
        const job = state.jobs.find((item) => item.status !== "Finished");
        if (!job || job.id !== action.jobId || job.status !== "NeedsAlignment" || state.playing)
          throw new Error("Align the next stamp while the simulator is stopped.");
        const size = job.size ?? action.size;
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
        job.size = size;
        job.status = "Ready";
        break;
      }
      case "pause":
        state.playing = false;
        break;
      case "reset":
        state.jobs = [];
        state.playing = false;
        state.lidOpen = false;
        state.offline = false;
        state.rejectNextUpload = false;
        break;
      case "speed":
        state.speed = action.value;
        break;
      case "jobSeconds":
        state.jobSeconds = simulatorSchema.shape.jobSeconds.parse(action.value);
        break;
      case "lidOpen":
        state.lidOpen = action.value;
        if (action.value) state.playing = false;
        break;
      case "offline":
        state.offline = action.value;
        break;
      case "rejectNextUpload":
        state.rejectNextUpload = action.value;
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
    if (state.offline) throw new TypeError("Simulated connection lost.");
    const url = new URL(path, "https://ruby-simulator.invalid/");
    const queued = state.jobs
      .filter((job) => job.availableAt <= Date.now())
      .map((job) => ({ ...job, simulatedOrigin: job.origin }));
    const job = queued.find((item) => item.status !== "Finished");
    switch (url.pathname) {
      case "/GetDeviceStatus":
        return Response.json({
          serialNo: connection.targetDevice,
          model: "SIMULATED_SPEEDY_400",
          status: state.lidOpen ? "LidOpen" : (job?.status ?? "Ready"),
          jobName: job?.name,
          progress: job ? (job.elapsed / job.duration) * 100 : 0,
          remainingTime: job ? job.duration - job.elapsed : 0,
          issues: state.lidOpen
            ? [
                {
                  code: "LID_OPEN",
                  extraInfo: "Simulated lid is open. Close it to resume.",
                  active: true,
                },
              ]
            : [],
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
        if (state.rejectNextUpload) {
          state.rejectNextUpload = false;
          return Response.json({ code: "SIMULATED_UPLOAD_REJECTED" }, { status: 400 });
        }
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
            duration: state.jobSeconds,
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
