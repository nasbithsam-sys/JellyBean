// Incogniton Anti-Detect Browser local REST API helpers.
// All calls go to http://localhost:35000 on the user's PC. No auth required.

const BASE = "http://localhost:35000";
export const INCOG_UNREACHABLE = "Incogniton is not running. Please open the Incogniton app on this PC.";

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

// Returns array of profile objects from Incogniton. Shape varies — caller normalizes.
export async function fetchAllIncognitonProfiles(): Promise<Array<Record<string, unknown> & {
  profileName?: string; profile_name?: string; name?: string;
  profileGroup?: string; profile_group?: string; group?: string;
  profile_browser_id?: string; profileID?: string; id?: string;
  platform?: string;
}>> {
  const res = await wrapFetch(fetch(`${BASE}/api/v1/profile/list`, { method: "GET" }));
  if (!res.ok) throw new Error(`Failed to fetch profiles (HTTP ${res.status})`);
  const json = await res.json();
  // Common shapes: { profileData: [...] }, { data: [...] }, or [...] directly.
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.profileData)) return json.profileData;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.profiles)) return json.profiles;
  return [];
}
