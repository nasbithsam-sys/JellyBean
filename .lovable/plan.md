## Scope

Multiple changes across role-based navigation, Map page, Accounts page (Incogniton import), and reframing the CRM as a lead-routing (not closing) tool.

---

## 1. Role-based navigation & page access

Update `src/components/app-shell.tsx` sidebar + `src/routes/app.tsx` access:

- **CS role**: only sees one item labeled **"Dashboard"** which routes to `/app/cs-leads` (the CS pipeline). No other sections visible.
- **Marketing role**: only sees **Raw Leads** and **Accounts**. No dashboard, analytics, map, reports, logs, settings.
- **Admin role**: sees everything (current full nav) plus Map and Settings.
- Remove standalone **Users** entry from sidebar. Move user management into **Settings → Users** tab (admin-only).

Update `RoleGate` usage on each route to reflect the new matrix. Redirect CS landing from `/app` → `/app/cs-leads`, Marketing → `/app/raw-leads`.

---

## 2. CRM reframing (lead routing, not closing)

The CS pipeline is a hand-off + follow-up tracker, not a sales closer. Update `src/routes/app.cs-leads.tsx`:

- Rename pipeline statuses to reflect routing semantics. Use existing `cs_status` enum values but relabel in UI:
  - `new` → "New (to contact)"
  - statuses for: **Messaged**, **Interested**, **Not Interested**, **Already Done**, **No Response**, **Closed**
- Each lead row gets a **manually-written comment field** (textarea) appended to `cs_notes` jsonb array with timestamp + author. No preset templates — free text only.
- Quick-status buttons + a "Add comment" inline action.

If current enum lacks values (Messaged / Interested / Already Done / No Response), add via migration extending the `cs_status` enum.

---

## 3. Map page — USA map + visuals toggle

Rewrite `src/routes/app.map.tsx`:

- Default view: full continental USA SVG map (inline SVG of US states outline, no external lib).
- **Visuals toggle** (Switch) at top: "Map visuals" — **OFF by default**.
  - When OFF: render a lightweight placeholder (state outlines only, no pins/glows/coverage circles/grid). Keep area-coverage sidebar list.
  - When ON: render pins, coverage circles, glow effects, grid, hover tooltips (current rich visuals).
- Projection: simple equirectangular over USA bbox (lng -125..-66, lat 24..50). Clip pins to bbox; pins outside still shown but clamped with badge.
- Persist toggle in `localStorage`.

---

## 4. Accounts — Import from Incogniton

### Schema migration

Extend `accounts` table:
- `incogniton_profile_id text unique` (nullable)
- `profile_group text` (nullable)
- `imported_at timestamptz` (nullable)
- `status text default 'active'`

### UI in `src/routes/app.accounts.tsx`

Add **"Import from Incogniton"** button (admin + marketing). Opens modal:

- Textarea: "Paste Incogniton Profile IDs (one per line)"
- **Import** + **Cancel** buttons
- Loading state per-profile
- After import: result table inside modal showing per-ID status: Imported / Already Imported / Failed (with reason)

### Fetch logic (client-side, browser → localhost)

For each pasted ID:
1. Check Supabase: if `incogniton_profile_id` already exists → mark "Already Imported", skip.
2. Otherwise `GET http://localhost:35000/profile/get?profileID=<id>` (Incogniton Local API).
3. Extract: profile name, profile group.
4. Insert row into `accounts` with `name`, `incogniton_profile_id`, `profile_group`, `area=''`, `lat=0`, `lng=0`, `imported_at=now()`, `status='active'`, `created_by=auth.uid()`.
5. User edits area/lat/lng later via existing edit dialog.

No bulk `/profile/all` call. Only the pasted IDs are requested.

Add columns to accounts table view: **Profile ID**, **Group**, **Status** alongside existing columns.

---

## 5. Files touched

- `src/components/app-shell.tsx` — role-filtered nav
- `src/routes/app.tsx` — landing redirect per role
- `src/routes/app.users.tsx` — delete (moved into settings)
- `src/routes/app.settings.tsx` — add Users tab
- `src/routes/app.map.tsx` — USA map + visuals toggle
- `src/routes/app.accounts.tsx` — import modal + new columns
- `src/routes/app.cs-leads.tsx` — relabel + manual comment field
- DB migration: extend `accounts` columns; possibly extend `cs_status` enum

---

## Open questions

1. **Incogniton API endpoint shape** — I'll use `GET http://localhost:35000/profile/get?profileID=<id>` per their public docs. If the local API differs, the call will error and surface in the per-row result.
2. **CS status values** — should I add `messaged`, `interested`, `not_interested`, `already_done`, `no_response`, `closed` to the existing `cs_status` enum? Need approval since this is a schema change.
3. **Marketing access to Map** — your message says marketing sees only Raw Leads + Accounts (so no Map). Confirming Map becomes admin-only.