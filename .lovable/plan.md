# Plan

## 1. Manual refresh on Raw Leads & CS Leads

- Remove any auto-polling / realtime subscriptions on `app.raw-leads.tsx` and `app.cs-leads.tsx`.
- Add a visible **Refresh** button (icon + label) that calls `queryClient.invalidateQueries`.
- No interval timers; the page only updates when the user clicks Refresh or performs a mutation.

## 2. Map page — real interactive map

Replace the inline-SVG USA "drawing" in `app.map.tsx` with a real slippy map:

- Use **react-leaflet + leaflet** (lightweight, no API key, OpenStreetMap tiles).
- Default center: continental USA, zoom 4.
- Keep the existing **Map visuals** toggle (off by default, persisted in localStorage):
  - OFF → base tile map only with simple markers
  - ON → markers + coverage circles + popups
- Sidebar list of area coverage stays.
- Install `leaflet` and `react-leaflet`; import `leaflet/dist/leaflet.css` in `styles.css`.

## 3. Incogniton integration

### 3a. Schema (migration)

New table `public.incogniton_profiles`:

- `id uuid pk default gen_random_uuid()`
- `profile_name text not null`
- `incogniton_profile_id text not null unique`
- `group_name text`
- `platform text`
- `linked_lead_id uuid` — FK to `qualified_leads(id) on delete set null` ← I'm using `qualified_leads` as "leads" since this project's CS leads live there; raw_leads are pre-qualification feed
- `last_launched_at timestamptz`
- `created_at timestamptz default now()`
- `created_by uuid`

RLS: admin + marketing full access; cs read + update `last_launched_at` only (so CS can launch profiles from their pipeline).

### 3b. Launch button in CS Leads (`app.cs-leads.tsx`)

- Add 🌐 Globe icon button in each lead's row / drawer actions.
- On click:
  1. Look up `incogniton_profiles` where `linked_lead_id = lead.id`.
  2. If found → `POST http://localhost:35000/api/v1/profile/start/{id}` → toast success, update `last_launched_at`.
  3. If not found → open **Link Profile** modal:
     - Input: Incogniton Profile ID
     - Dropdown: Group Name (distinct values from existing rows)
     - Input: Platform
     - Save → insert row linked to this lead → immediately launch.
- Error: if `fetch` rejects ("Failed to fetch") → toast: _"Incogniton is not running. Please open the Incogniton app on this PC."_

### 3c. New page `src/routes/app.browser-profiles.tsx`

- Sidebar entry **Browser Profiles** (Globe icon), admin + marketing only.
- Top bar:
  - Search (profile name / platform)
  - Group filter dropdown (All + distinct groups)
  - **Sync from Incogniton** button → `GET /api/v1/profile/list` → upsert by `incogniton_profile_id`. Loading spinner while running.
  - **Export Group** button → modal (group dropdown + CSV/JSON radio + Export → triggers blob download).
- Table: Profile Name · Incogniton ID · Group · Platform · Linked Lead (joined name from `qualified_leads.customer_name`) · Status (`Active` if `last_launched_at` within last 30 min, else `Idle`) · Actions: 🚀 Launch · 🔗 Link to Lead (modal with searchable lead picker) · 🗑 Delete.

### 3d. Sidebar (`app-shell.tsx`)

- Add Browser Profiles nav for admin + marketing.

## 4. Files

- migration: new table + RLS + index on `group_name`
- `src/routes/app.raw-leads.tsx` — remove auto-refresh, add Refresh button
- `src/routes/app.cs-leads.tsx` — remove auto-refresh, add Refresh button + Launch action + LinkProfile modal
- `src/routes/app.map.tsx` — rewrite with react-leaflet
- `src/routes/app.browser-profiles.tsx` — new
- `src/components/app-shell.tsx` — sidebar entry
- `src/styles.css` — `@import "leaflet/dist/leaflet.css";`
- `package.json` — add `leaflet`, `react-leaflet`, `@types/leaflet`

## Notes / assumptions

1. "Leads" in the spec = `qualified_leads` (the CS-facing pipeline). Linking to `raw_leads` instead would be trivial to swap — say the word.
2. Incogniton path: spec lists both `/profile/get` (used by earlier import) and `/api/v1/profile/*`. The new endpoints use `/api/v1/` exactly as documented in this message.
3. All Incogniton calls run in the browser (localhost-only) — no server proxy.
