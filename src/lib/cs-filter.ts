/**
 * Helper to identify Customer Support (CS) and CS Admin accounts
 * so they can be excluded from forwarders lists, maturing reports, etc.
 */
export function isCsUser(
  user: {
    user_id?: string | null;
    full_name?: string | null;
    email?: string | null;
    role?: string | null;
  },
  csIds?: Set<string>,
): boolean {
  if (!user) return false;

  // Direct role check
  if (user.role === "cs" || user.role === "cs_admin") return true;

  // Check against known CS user IDs if provided
  if (user.user_id && csIds?.has(user.user_id)) return true;

  const name = (user.full_name || "").trim().toLowerCase();
  const email = (user.email || "").trim().toLowerCase();

  // Name patterns matching CS team members (e.g. "ARS CS", "ArslanCSADMIN", "ASAD CS", "cs", "CS admin")
  if (
    name === "cs" ||
    name === "cs admin" ||
    name === "csadmin" ||
    /\bcs\b/i.test(name) ||
    name.includes("csadmin") ||
    name.includes("cs_admin") ||
    name.includes("customer support") ||
    name.endsWith(" cs") ||
    name.startsWith("cs ")
  ) {
    return true;
  }

  // Email patterns matching CS accounts (e.g. arscs1@, asadcs@, cs11@, arslancsadmin@, csadmin@)
  const prefix = email.split("@")[0] || "";
  if (
    prefix === "cs" ||
    prefix.includes("csadmin") ||
    prefix.includes("cs_admin") ||
    /(?:^|[._-])cs(?:\d*|[._-]|$)/i.test(prefix) ||
    /^[a-z]+cs\d*$/i.test(prefix)
  ) {
    return true;
  }

  return false;
}
