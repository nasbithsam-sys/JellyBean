
## Scope

A coordinated set of changes across CS pipeline, lead card, map, AI prompt, timezone, and reports. Will be delivered in this single plan but staged across migrations and code changes.

---

## 1. Wrong Lead bucket (CS pipeline)

- Add `"wrong"` value to the outcome enum on `qualified_leads` (DB migration).
- CS pipeline page: add **"Wrong lead"** option in the outcome dropdown (both inline picker and lead card).
- Hide `wrong` leads from active CS pipeline view; add a new **"Wrong leads"** tab/filter on the CS leads page that lists them with the option to restore.

## 2. Lead card enhancements (`app.cs-leads.tsx`)

On the lead detail/card view:
- New editable fields filled manually by the CS user:
  - **Customer name**
  - **Customer phone**
  - **Compose note** (multiline freeform message/script)
- Outcome dropdown rendered inside the card (in addition to row-level), so users can change outcome without leaving the card.
- Always show **Passed to** (the processor/handler name + free-text note) on the card.
- Persist these via new nullable columns on `qualified_leads`:
  - `cs_customer_name text`
  - `cs_customer_phone text`
  - `cs_compose_note text`

## 3. Map page (`app.map.tsx`, `leaflet-map.tsx`)

- Reorganize layout so **Coverage by area** sits side-by-side with the map (responsive: stacks on mobile), and the list is no longer in a tall scroll panel — it expands naturally beside the map.
- Remove fractional launch display (`1/2`, `1/4`). Show plain "1 launch" / "2 launches" instead.
- Progress bar becomes binary: 0% (no launch today) or 100% (at least one launch today). No partial fill.
- **PKT reset**: launch-today logic uses PKT (Asia/Karachi) day boundary, so it resets at 11:59 PM PKT.

## 4. Daily map snapshot

- New table `map_snapshots(snapshot_date date, captured_at timestamptz, image_url text, summary jsonb)`.
- New private storage bucket `map-snapshots`.
- New server route `/api/public/hooks/capture-map-snapshot` that:
  - Computes today's PKT coverage summary (placed accounts, covered, missing, per-area).
  - Renders a simple SVG/PNG report of the day's coverage (text + per-area breakdown — no live map tiles, since the worker runtime can't run Leaflet/canvas).
  - Uploads to the `map-snapshots` bucket and inserts a row.
- `pg_cron` job runs daily at **11:59 PM PKT** (`59 18 * * *` UTC) calling that route.
- Map page gains a **"Snapshots"** panel with a date-range picker that lists/downloads past snapshots.

> Note: a true rendered Leaflet screenshot requires a browser/canvas runtime that's not available in the Cloudflare Worker. The snapshot will be a high-quality coverage report image (per-area covered/missing + total). If you want a literal map raster, that has to be triggered from a logged-in admin browser session via a "Save snapshot" button — happy to add that as a follow-up.

## 5. PKT timezone across CRM

- Add `src/lib/timezone.ts` with `PKT_TZ = "Asia/Karachi"` and helpers `formatPKT(date)`, `pktDayKey(date)`, `pktDayBounds(date)`.
- Replace `new Date().toLocaleString()` / `dayKey()` calls in user-facing pages (map, raw leads, forwarded leads, reports, logs, analytics, cs-leads, lead card, popups) with PKT-formatted output.
- Date inputs/filters interpret user-selected dates as PKT midnight → midnight ranges.

## 6. Frozen AI prompt with REVIEW

- DB migration: extend `raw_lead_cache.lead` allowed values to include `'review'` (currently `'yes' | 'no' | null`); update any check constraint / type.
- Update `src/lib/raw-leads-ai.functions.ts`:
  - Replace system prompt with the exact frozen text you provided (home repair lead filter with YES/NO/REVIEW).
  - JSON schema enum becomes `["yes","no","review"]`.
  - Prompt constant marked `// FROZEN — do not edit` and the user-editable prompt textarea on Raw Leads is removed (or locked to read-only) so the prompt can't drift.
- Raw Leads UI: show a third "Review" badge/section alongside Yes/No, and a filter chip for it.

## 7. Processor forwarding report

- New section on `app.reports.tsx`: **"Leads forwarded per processor"**.
- New DB function `report_leads_forwarded_by_processor(_from, _to)` returning `processor_id, processor_name, forwarded_count` from `qualified_leads` grouped by `forwarded_by` (or equivalent — will confirm exact column when reading the table).
- Wired into a TanStack server fn (`requireSupabaseAuth` + admin role check) and rendered as a sortable table with the existing date-range filter on the Reports page.

---

## Technical notes

- DB migrations (in order):
  1. Add `'wrong'` to qualified_leads outcome enum + `cs_customer_name/phone/compose_note` columns.
  2. Add `'review'` to the raw_lead_cache lead constraint.
  3. Create `map_snapshots` table (+ GRANTs + RLS: admin read, service_role write).
  4. Create `report_leads_forwarded_by_processor` SQL function.
- Storage: create private `map-snapshots` bucket via storage tool; admins get signed URLs via a server fn.
- Cron: scheduled via `supabase--insert` (not migration) since it contains the project URL + anon key.

## Out of scope / follow-ups

- Literal Leaflet map raster screenshot (needs a browser runtime). I'll ship a coverage-report PNG and we can add a browser-side "Save snapshot" button later if you want the actual map tiles.
