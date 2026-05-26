// Incogniton Anti-Detect Browser local REST API helpers.
// Incogniton has shipped a few different local API shapes across versions:
//   - GET /profile/all                        (older)
//   - GET /api/v1/profile/list                (newer)
//   - GET /profile/launch/<id>  or  /api/v1/profile/launch/<id>
//   - GET /profile/stop/<id>    or  /api/v1/profile/stop/<id>
// We try both so the app works regardless of which Incogniton build is installed.

const BASE = "http://localhost:35000";

export const INCOG_UNREACHABLE =
  "Cannot reach Incogniton at http://localhost:35000. Make sure the Incogniton desktop app is running and that this site is allowed to load insecure content (see Fix Connection).";

const LIST_PATHS = ["/profile/all", "/api/v1/profile/list"];
const LAUNCH_PATHS = ["/profile/launch/", "/api/v1/profile/launch/"];
const STOP_PATHS = ["/profile/stop/", "/api/v1/profile/stop/"];

async function tryGet(path: string): Promise<Response> {
  try {
    return await fetch(`${BASE}${path}`, { method: "GET" });
  } catch (e) {
    if (e instanceof TypeError) throw new Error(INCOG_UNREACHABLE);
    throw e;
  }
}

async function getFirstOk(paths: string[]): Promise<Response> {
  let lastStatus = 0;
  for (const p of paths) {
    const res = await tryGet(p);
    if (res.ok) return res;
    lastStatus = res.status;
  }
  throw new Error(`Incogniton API responded with HTTP ${lastStatus}`);
}

export async function launchIncognitonProfile(profileId: string): Promise<void> {
  const id = encodeURIComponent(profileId);
  await getFirstOk(LAUNCH_PATHS.map((p) => `${p}${id}`));
}

export async function stopIncognitonProfile(profileId: string): Promise<void> {
  const id = encodeURIComponent(profileId);
  await getFirstOk(STOP_PATHS.map((p) => `${p}${id}`));
}

export async function pingIncogniton(): Promise<{ ok: boolean; error?: string; endpoint?: string }> {
  for (const p of LIST_PATHS) {
    try {
      const res = await fetch(`${BASE}${p}`, { method: "GET" });
      if (res.ok) return { ok: true, endpoint: p };
    } catch (e) {
      if (e instanceof TypeError) {
        return { ok: false, error: INCOG_UNREACHABLE };
      }
      return { ok: false, error: (e as Error).message };
    }
  }
  return { ok: false, error: "Incogniton is reachable but no known endpoint responded OK." };
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
