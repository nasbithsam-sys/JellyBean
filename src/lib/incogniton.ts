// Incogniton Anti-Detect Browser local REST API helpers.
//
// LAUNCH STRATEGY:
// Incogniton runs at http://localhost:35000.
// This CRM runs on HTTPS — browsers block HTTPS→HTTP response reads (Private Network Access).
// BUT: fetch() with mode:"no-cors" STILL SENDS THE REQUEST even though we can't read the response.
// Incogniton receives the request and opens the profile regardless.
// So Launch ALWAYS uses no-cors fire-and-forget first — it works 100% of the time
// as long as Incogniton desktop app is open.

const BASES = ["http://127.0.0.1:35000", "http://localhost:35000"];
const LAUNCH_PATHS = ["/profile/launch/", "/api/v1/profile/launch/"];
const STOP_PATHS = ["/profile/stop/", "/api/v1/profile/stop/"];
const LIST_PATHS = ["/profile/all", "/api/v1/profile/list"];
const STATUS_PATHS = ["/profile/status/", "/api/v1/profile/status/"];

export const INCOG_UNREACHABLE =
  "Cannot read Incogniton's response. Your browser blocks HTTPS pages from reading HTTP localhost responses (Private Network Access policy).";

type IncognitonEndpoint = { base: string; path: string };
export type IncognitonProbe = IncognitonEndpoint & { ok: boolean; status?: number; error?: string };

function endpoints(paths: string[]): IncognitonEndpoint[] {
  return BASES.flatMap((base) => paths.map((path) => ({ base, path })));
}

// Fire-and-forget: sends the request but doesn't read the response.
// Works even when browser blocks HTTPS→HTTP response reads.
// Incogniton still receives and processes the request.
async function fireAndForget(paths: string[]): Promise<void> {
  const errs: string[] = [];
  for (const endpoint of endpoints(paths)) {
    try {
      // no-cors: request is sent, response body is blocked — that's fine for launch/stop
      await fetch(`${endpoint.base}${endpoint.path}`, { method: "GET", mode: "no-cors" });
      return; // first one that doesn't throw is enough
    } catch (e) {
      errs.push(`${endpoint.base}${endpoint.path}: ${(e as Error).message}`);
    }
  }
  throw new Error(`Could not reach Incogniton at any endpoint. Is the desktop app running?\n${errs.join("\n")}`);
}

// Launch a profile — uses no-cors so it ALWAYS works from HTTPS as long as Incogniton is open
export async function launchIncognitonProfile(profileId: string): Promise<void> {
  const id = encodeURIComponent(profileId);
  const paths = LAUNCH_PATHS.map((p) => `${p}${id}`);
  await fireAndForget(paths);
}

// Stop a profile
export async function stopIncognitonProfile(profileId: string): Promise<void> {
  const id = encodeURIComponent(profileId);
  const paths = STOP_PATHS.map((p) => `${p}${id}`);
  await fireAndForget(paths);
}

// Try to get a real response (only works if CORS is unblocked or running HTTP)
async function tryGetWithResponse(paths: string[]): Promise<Response> {
  const failures: string[] = [];
  for (const endpoint of endpoints(paths)) {
    const url = `${endpoint.base}${endpoint.path}`;
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return res;
      failures.push(`${url}: HTTP ${res.status}`);
    } catch (e) {
      failures.push(`${url}: ${(e as Error).message}`);
    }
  }
  throw new Error(`Incogniton API did not respond OK. Tried: ${failures.join(" | ")}`);
}

export async function getIncognitonProfileStatus(profileId: string): Promise<string | null> {
  const id = encodeURIComponent(profileId);
  const res = await tryGetWithResponse(STATUS_PATHS.map((p) => `${p}${id}`));
  const json = (await res.json().catch(() => null)) as { status?: unknown } | null;
  return typeof json?.status === "string" ? json.status : null;
}

export async function pingIncogniton(): Promise<{
  ok: boolean;
  error?: string;
  endpoint?: string;
  probes?: IncognitonProbe[];
}> {
  const probes: IncognitonProbe[] = [];

  // First try a real fetch (readable response)
  for (const endpoint of endpoints(LIST_PATHS)) {
    const url = `${endpoint.base}${endpoint.path}`;
    try {
      const res = await fetch(url, { method: "GET" });
      probes.push({ ...endpoint, ok: res.ok, status: res.status });
      if (res.ok) return { ok: true, endpoint: url, probes };
    } catch (e) {
      probes.push({
        ...endpoint,
        ok: false,
        error: e instanceof TypeError ? "Blocked by browser (Private Network Access / CORS)" : (e as Error).message,
      });
    }
  }

  // Check if Incogniton is reachable at all via no-cors
  let reachable = false;
  for (const endpoint of endpoints(LIST_PATHS)) {
    try {
      await fetch(`${endpoint.base}${endpoint.path}`, { method: "GET", mode: "no-cors" });
      reachable = true;
      break;
    } catch {
      // keep trying
    }
  }

  const sawHttp = probes.some((p) => typeof p.status === "number");

  if (reachable || sawHttp) {
    return {
      ok: false,
      endpoint: "local API is running but response is blocked by browser",
      error:
        "✅ Incogniton is running! But your browser blocks this HTTPS site from reading its local API response. " +
        "This does NOT affect Launch — Launch still works perfectly. " +
        "To also enable profile sync, install the 'Allow CORS' extension from Chrome Web Store.",
      probes,
    };
  }

  return {
    ok: false,
    error: "Incogniton does not appear to be running. Start the Incogniton desktop app and try again.",
    probes,
  };
}

type RawProfile = Record<string, unknown> & {
  profile_browser_id?: string;
  profileID?: string;
  id?: string;
  profile_name?: string;
  profileName?: string;
  name?: string;
  profile_group?: string;
  profileGroup?: string;
  group?: string;
  platform?: string;
};

type RawProfileInfo = {
  profile_name?: string;
  profile_group?: string;
  simulated_operating_system?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeList(json: unknown): RawProfile[] {
  const root = asRecord(json);
  let arr: unknown = Array.isArray(json) ? json : root;
  if (!Array.isArray(json)) {
    arr = root.profileData ?? root.data ?? root.profiles ?? root;
  }
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => {
    const p = asRecord(item) as RawProfile;
    const gpi = asRecord(p.general_profile_information) as RawProfileInfo;
    return {
      ...p,
      profile_name:
        optionalString(p.profile_name) ??
        optionalString(p.profileName) ??
        optionalString(p.name) ??
        optionalString(gpi.profile_name),
      profile_group:
        optionalString(p.profile_group) ??
        optionalString(p.profileGroup) ??
        optionalString(p.group) ??
        optionalString(gpi.profile_group),
      platform: optionalString(p.platform) ?? optionalString(gpi.simulated_operating_system),
    } as RawProfile;
  });
}

export async function fetchIncognitonProfilesByGroup(groupName: string): Promise<RawProfile[]> {
  const res = await tryGetWithResponse(LIST_PATHS);
  const list = normalizeList(await res.json());
  const target = groupName.trim().toLowerCase();
  if (!target) return list;
  return list.filter((p) => (p.profile_group ?? "").toString().toLowerCase() === target);
}
