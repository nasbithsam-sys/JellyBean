// Incogniton Anti-Detect Browser local REST API helpers.
// Incogniton has shipped a few different local API shapes across versions:
//   - GET /profile/all                        (older)
//   - GET /api/v1/profile/list                (newer)
//   - GET /profile/launch/<id>  or  /api/v1/profile/launch/<id>
//   - GET /profile/stop/<id>    or  /api/v1/profile/stop/<id>
// We try both so the app works regardless of which Incogniton build is installed.

const BASES = ["http://127.0.0.1:35000", "http://localhost:35000"];

export const INCOG_UNREACHABLE =
  "Cannot reach Incogniton at 127.0.0.1:35000 or localhost:35000. If Incogniton is open, the browser is likely blocking the local API or Incogniton's developer API is not listening on port 35000.";

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
  throw new Error(`Incogniton API did not respond OK. Tried ${failures.join(" | ")}`);
}

async function sendWithoutReading(paths: string[]): Promise<void> {
  for (const endpoint of endpoints(paths)) {
    try {
      await fetch(`${endpoint.base}${endpoint.path}`, { method: "GET", mode: "no-cors" });
      return;
    } catch {
      // Try the next host/path. This fallback is only for launch/stop where reading the response is not required.
    }
  }
  throw new Error(INCOG_UNREACHABLE);
}

export async function launchIncognitonProfile(profileId: string): Promise<void> {
  const id = encodeURIComponent(profileId);
  const paths = LAUNCH_PATHS.map((p) => `${p}${id}`);
  try {
    await getFirstOk(paths);
  } catch (e) {
    if ((e as Error).message.includes("Cannot reach Incogniton")) await sendWithoutReading(paths);
    else throw e;
  }
}

export async function stopIncognitonProfile(profileId: string): Promise<void> {
  const id = encodeURIComponent(profileId);
  const paths = STOP_PATHS.map((p) => `${p}${id}`);
  try {
    await getFirstOk(paths);
  } catch (e) {
    if ((e as Error).message.includes("Cannot reach Incogniton")) await sendWithoutReading(paths);
    else throw e;
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
  const json = await res.json().catch(() => null) as { status?: unknown } | null;
  return typeof json?.status === "string" ? json.status : null;
}

export async function pingIncogniton(): Promise<{ ok: boolean; error?: string; endpoint?: string; probes?: IncognitonProbe[] }> {
  const probes: IncognitonProbe[] = [];
  for (const endpoint of endpoints(LIST_PATHS)) {
    const url = `${endpoint.base}${endpoint.path}`;
    try {
      const res = await fetch(url, { method: "GET" });
      probes.push({ ...endpoint, ok: res.ok, status: res.status });
      if (res.ok) return { ok: true, endpoint: url, probes };
    } catch (e) {
      probes.push({ ...endpoint, ok: false, error: e instanceof TypeError ? "Browser blocked or connection refused" : (e as Error).message });
    }
  }
  const sawHttp = probes.some((p) => typeof p.status === "number");
  const reachableNoCors = !sawHttp && (await canReachLocalApiWithoutReading());
  return {
    ok: reachableNoCors,
    endpoint: reachableNoCors ? "local API reachable; response blocked by browser CORS" : undefined,
    error: sawHttp
      ? "Incogniton answered, but none of the known profile list endpoints returned OK. See diagnostics below."
      : reachableNoCors
      ? "Incogniton is reachable, but the browser blocks reading the profile list response (CORS/private-network rules). Launch requests can be sent; full sync needs Incogniton to allow this site or a local proxy."
      : INCOG_UNREACHABLE,
    probes,
  };
}

type RawProfile = Record<string, unknown> & {
  profile_name?: string;
  profile_group?: string;
  platform?: string;
};

function normalizeList(json: unknown): RawProfile[] {
  const root: any = json;
  let arr: any = root;
  if (root && typeof root === "object") {
    arr = root.profileData ?? root.data ?? root.profiles ?? root;
  }
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr); } catch { arr = []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((p: any) => {
    const gpi = p?.general_profile_information ?? {};
    return {
      ...p,
      profile_name: p.profile_name ?? p.profileName ?? p.name ?? gpi.profile_name,
      profile_group: p.profile_group ?? p.profileGroup ?? p.group ?? gpi.profile_group,
      platform: p.platform ?? gpi.simulated_operating_system,
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
