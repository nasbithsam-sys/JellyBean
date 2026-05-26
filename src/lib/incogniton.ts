// Incogniton Anti-Detect Browser local REST API helpers.
//
// ROOT CAUSE OF "browser not working":
// ─────────────────────────────────────
// Incogniton runs a local API at http://localhost:35000.
// This CRM is served over HTTPS. Modern browsers enforce the
// "Private Network Access" spec and block HTTPS pages from reading
// responses from HTTP localhost — even if CORS headers were present.
// The fetch() call itself may succeed (the request is sent) but the
// browser refuses to give you the response body, so it looks like
// the connection failed.
//
// SOLUTIONS (pick one):
// 1. Install a CORS/private-network unblock extension in Chrome (easiest).
// 2. Use the Incogniton Chromium build — it ships with web-security disabled.
// 3. Run a tiny local proxy (see proxy instructions in the help dialog).
// 4. Launch → still works via mode:"no-cors" fire-and-forget.
//
// This file tries all known API endpoints and gives the user a clear,
// actionable error when everything fails.

const BASES = ["http://127.0.0.1:35000", "http://localhost:35000"];

export const INCOG_UNREACHABLE =
  "Cannot read Incogniton's response. Your browser blocks HTTPS pages from reading HTTP localhost responses (Private Network Access policy). See the fix instructions in the help dialog.";

const LIST_PATHS = ["/profile/all", "/api/v1/profile/list"];
const LAUNCH_PATHS = ["/profile/launch/", "/api/v1/profile/launch/"];
const STOP_PATHS = ["/profile/stop/", "/api/v1/profile/stop/"];
const STATUS_PATHS = ["/profile/status/", "/api/v1/profile/status/"];

type IncognitonEndpoint = { base: string; path: string };
export type IncognitonProbe = IncognitonEndpoint & { ok: boolean; status?: number; error?: string };

function endpoints(paths: string[]): IncognitonEndpoint[] {
  return BASES.flatMap((base) => paths.map((path) => ({ base, path })));
}

async function tryGet({ base, path }: IncognitonEndpoint): Promise<Response> {
  try {
    return await fetch(`${base}${path}`, { method: "GET" });
  } catch (e) {
    if (e instanceof TypeError) throw new Error(INCOG_UNREACHABLE);
    throw e;
  }
}

async function getFirstOk(paths: string[]): Promise<Response> {
  const failures: string[] = [];
  for (const endpoint of endpoints(paths)) {
    const url = `${endpoint.base}${endpoint.path}`;
    let res: Response;
    try {
      res = await tryGet(endpoint);
    } catch (e) {
      failures.push(`${url}: ${(e as Error).message}`);
      continue;
    }
    if (res.ok) return res;
    failures.push(`${url}: HTTP ${res.status}`);
  }
  throw new Error(`Incogniton API did not respond OK. Tried: ${failures.join(" | ")}`);
}

// fire-and-forget for launch/stop — works even without CORS
async function sendWithoutReading(paths: string[]): Promise<void> {
  for (const endpoint of endpoints(paths)) {
    try {
      await fetch(`${endpoint.base}${endpoint.path}`, { method: "GET", mode: "no-cors" });
      return;
    } catch {
      // try next
    }
  }
  throw new Error(INCOG_UNREACHABLE);
}

export async function launchIncognitonProfile(profileId: string): Promise<void> {
  const id = encodeURIComponent(profileId);
  const paths = LAUNCH_PATHS.map((p) => `${p}${id}`);
  try {
    await getFirstOk(paths);
  } catch {
    // fallback: fire-and-forget works even when browser blocks the response read
    await sendWithoutReading(paths);
  }
}

export async function stopIncognitonProfile(profileId: string): Promise<void> {
  const id = encodeURIComponent(profileId);
  const paths = STOP_PATHS.map((p) => `${p}${id}`);
  try {
    await getFirstOk(paths);
  } catch {
    await sendWithoutReading(paths);
  }
}

async function canReachLocalApiWithoutReading(): Promise<boolean> {
  for (const endpoint of endpoints(LIST_PATHS)) {
    try {
      await fetch(`${endpoint.base}${endpoint.path}`, { method: "GET", mode: "no-cors" });
      return true;
    } catch {
      // keep probing
    }
  }
  return false;
}

export async function getIncognitonProfileStatus(profileId: string): Promise<string | null> {
  const id = encodeURIComponent(profileId);
  const res = await getFirstOk(STATUS_PATHS.map((p) => `${p}${id}`));
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

  // Check if Incogniton is actually running (even if we can't read the response)
  const sawHttp = probes.some((p) => typeof p.status === "number");
  const reachableNoCors = !sawHttp && (await canReachLocalApiWithoutReading());

  if (reachableNoCors) {
    return {
      ok: false, // can't fully use it without CORS fix
      endpoint: "local API is running but response is blocked by browser",
      error:
        "✅ Incogniton is running! But your browser blocks this HTTPS site from reading its response (Private Network Access policy). " +
        "Fix: install a CORS unblock extension (e.g. 'Allow CORS' from Chrome Web Store) and enable it, then reload. " +
        "Launch buttons still work without the fix.",
      probes,
    };
  }

  return {
    ok: false,
    error: sawHttp
      ? "Incogniton answered but none of the profile-list endpoints returned OK. Check the diagnostics below."
      : "Incogniton does not appear to be running, or it's running on a different port. Start the Incogniton desktop app and try again.",
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
  const res = await getFirstOk(LIST_PATHS);
  const list = normalizeList(await res.json());
  const target = groupName.trim().toLowerCase();
  if (!target) return list;
  return list.filter((p) => (p.profile_group ?? "").toString().toLowerCase() === target);
}
