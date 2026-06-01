/**
 * Incogniton Bridge client
 *
 * Instead of calling Incogniton's localhost:35000 directly (which Chrome blocks
 * from HTTPS pages), we call the Incogniton Bridge running on localhost:27842.
 *
 * The Bridge is a tiny Node.js program installed on the marketing PC that:
 * - Runs silently in the background (auto-starts with Windows)
 * - Accepts commands ONLY from lead-flow-crm-by-accboost.lovable.app
 * - Forwards them to Incogniton on localhost:35000
 * - Returns the result back to the CRM
 *
 * Why port 27842 instead of 35000?
 * The bridge adds proper CORS headers that Chrome requires.
 * Incogniton itself doesn't add those headers, so Chrome blocks it.
 * The bridge acts as a middleman that speaks Chrome's language.
 */

const BRIDGE_URL = "http://127.0.0.1:27842";

export const INCOG_UNREACHABLE =
  "Could not reach the Incogniton Bridge. Make sure: (1) Incogniton is open, (2) the Bridge is installed and running on this PC.";

async function bridgeGet(path: string): Promise<Response> {
  try {
    const res = await fetch(`${BRIDGE_URL}${path}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    return res;
  } catch (e) {
    throw new Error(INCOG_UNREACHABLE);
  }
}

export async function launchIncognitonProfile(profileId: string): Promise<void> {
  const res = await bridgeGet(`/launch/${encodeURIComponent(profileId)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Launch failed (HTTP ${res.status})`);
  }
}

export async function stopIncognitonProfile(profileId: string): Promise<void> {
  const res = await bridgeGet(`/stop/${encodeURIComponent(profileId)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Stop failed (HTTP ${res.status})`);
  }
}

export async function getIncognitonProfileStatus(profileId: string): Promise<string | null> {
  const res = await bridgeGet(`/status/${encodeURIComponent(profileId)}`);
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { status?: unknown } | null;
  return typeof json?.status === "string" ? json.status : null;
}

export async function pingIncogniton(): Promise<{
  ok: boolean;
  error?: string;
  endpoint?: string;
}> {
  try {
    const res = await bridgeGet("/ping");
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; incogniton?: string };
    if (json.ok) {
      return { ok: true, endpoint: `${BRIDGE_URL}/ping` };
    }
    return {
      ok: false,
      error: "Bridge is running but cannot reach Incogniton. Make sure Incogniton desktop app is open.",
      endpoint: `${BRIDGE_URL}/ping`,
    };
  } catch {
    return {
      ok: false,
      error: "Incogniton Bridge is not running on this PC. Please run install.bat from the bridge folder.",
    };
  }
}

// Not needed anymore (bridge handles it) but kept for compatibility
export type IncognitonProbe = { base: string; path: string; ok: boolean; status?: number; error?: string };
