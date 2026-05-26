// Incogniton Anti-Detect Browser local REST API helpers.
// Official endpoints (per https://incogniton.com/api/):
//   GET http://localhost:35000/profile/all                 -> list profiles
//   GET http://localhost:35000/profile/launch/<profileID>  -> launch
//   GET http://localhost:35000/profile/stop/<profileID>    -> stop
const BASE = "http://localhost:35000";

export const INCOG_UNREACHABLE =
  "Cannot reach Incogniton at http://localhost:35000. Make sure the Incogniton desktop app is running and your browser allows insecure content for this site.";

function wrapFetch(p: Promise<Response>): Promise<Response> {
  return p.catch((e) => {
    if (e instanceof TypeError) throw new Error(INCOG_UNREACHABLE);
    throw e;
  });
}

export async function launchIncognitonProfile(profileId: string): Promise<void> {
  const res = await wrapFetch(
    fetch(`${BASE}/profile/launch/${encodeURIComponent(profileId)}`, { method: "GET" }),
  );
  if (!res.ok) throw new Error(`Failed to launch profile (HTTP ${res.status})`);
}

export async function stopIncognitonProfile(profileId: string): Promise<void> {
  const res = await wrapFetch(
    fetch(`${BASE}/profile/stop/${encodeURIComponent(profileId)}`, { method: "GET" }),
  );
  if (!res.ok) throw new Error(`Failed to stop profile (HTTP ${res.status})`);
}

export async function pingIncogniton(): Promise<boolean> {
  try {
    const res = await wrapFetch(fetch(`${BASE}/profile/all`, { method: "GET" }));
    return res.ok;
  } catch {
    return false;
  }
}

type RawProfile = Record<string, unknown> & {
  profileName?: string; profile_name?: string; name?: string;
  profileGroup?: string; profile_group?: string; group?: string;
  profile_browser_id?: string; profileID?: string; id?: string;
  platform?: string;
  general_profile_information?: { profile_name?: string; profile_group?: string; simulated_operating_system?: string };
};

function normalizeList(json: unknown): RawProfile[] {
  // Incogniton sometimes returns { status: 'ok', profileData: "[{...}]" } (string!)
  // or { profileData: [...] }, or { data: [...] }, or a raw array.
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
  const res = await wrapFetch(fetch(`${BASE}/profile/all`, { method: "GET" }));
  if (!res.ok) throw new Error(`Failed to fetch profiles (HTTP ${res.status})`);
  const list = normalizeList(await res.json());
  const target = groupName.trim().toLowerCase();
  if (!target) return list;
  return list.filter((p) => (p.profile_group ?? "").toString().toLowerCase() === target);
}
