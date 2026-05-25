// Incogniton Anti-Detect Browser local REST API helpers.
const BASE = "http://localhost:35000";
export const INCOG_UNREACHABLE =
  "Cannot connect to Incogniton. If the app is already open, your browser is blocking the connection. Click here to fix it.";

function wrapFetch(p: Promise<Response>): Promise<Response> {
  return p.catch((e) => {
    if (e instanceof TypeError) throw new Error(INCOG_UNREACHABLE);
    throw e;
  });
}

export async function launchIncognitonProfile(profileId: string): Promise<void> {
  const res = await wrapFetch(
    fetch(`${BASE}/api/v1/profile/start/${encodeURIComponent(profileId)}`, { method: "POST" }),
  );
  if (!res.ok) throw new Error(`Failed to launch profile (HTTP ${res.status})`);
}

export async function pingIncogniton(): Promise<boolean> {
  try {
    const res = await wrapFetch(fetch(`${BASE}/api/v1/profile/list`, { method: "GET" }));
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchIncognitonProfilesByGroup(groupName: string): Promise<Array<Record<string, unknown> & {
  profileName?: string; profile_name?: string; name?: string;
  profileGroup?: string; profile_group?: string; group?: string;
  profile_browser_id?: string; profileID?: string; id?: string;
  platform?: string;
}>> {
  // Try group-filtered endpoint first, fall back to full list and filter client-side.
  let json: unknown;
  try {
    const res = await wrapFetch(
      fetch(`${BASE}/api/v1/profile/list?groupName=${encodeURIComponent(groupName)}`, { method: "GET" }),
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch {
    const res = await wrapFetch(fetch(`${BASE}/api/v1/profile/list`, { method: "GET" }));
    if (!res.ok) throw new Error(`Failed to fetch profiles (HTTP ${res.status})`);
    json = await res.json();
  }
  const arr: any[] = Array.isArray(json)
    ? json
    : Array.isArray((json as any)?.profileData) ? (json as any).profileData
    : Array.isArray((json as any)?.data) ? (json as any).data
    : Array.isArray((json as any)?.profiles) ? (json as any).profiles
    : [];
  const target = groupName.trim().toLowerCase();
  return arr.filter((p) => {
    const g = (p.profileGroup || p.profile_group || p.group || "").toString().toLowerCase();
    return g === target;
  });
}
