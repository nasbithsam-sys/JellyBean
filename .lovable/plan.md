
# CRM performance overhaul

Goal: fast login → fast route switches → responsive tables for 15–50 concurrent users, without changing any features, business logic, or visual design.

## Root causes (measured from the codebase)

1. Giant route files ship in the initial bundle:
   - `app.cs-leads.tsx` 3,455 lines, `app.raw-leads.tsx` 2,037, `app.browser-profiles.tsx` 1,367, `app.forwarded-leads.tsx` 1,124.
   - They aren't code-split, so opening `/login` still parses this JS.
2. Fonts loaded eagerly in `src/router.tsx`: 9 `@fontsource/*` CSS imports (5 Urbanist + 4 Epilogue) block first paint on every route, including login.
3. Realtime over-subscription in `useRealtimeSync`: admin/sub_admin/scraping/maturing all subscribe to `qualified_leads`, `incogniton_profiles`, `shared_state` INSERT/UPDATE/DELETE. Every write from any user invalidates 3 query keys — with 15–50 users this creates a refetch storm.
4. `AppShell` wraps `{children}` in `<div key={path}>` so the entire route tree unmounts/remounts on every navigation (`crm-route-enter` animation), throwing away query subscriptions and DOM.
5. Login page runs a `count(*)` on `profiles` on every mount just to decide whether to show the "first time setup" link. Non-critical, runs before auth.
6. Dashboard `useQuery` has no `staleTime` override → uses global 60s (OK) but re-runs `Date.now()` inside the queryFn on every mount; fine, but it also has no skeleton so the whole page looks blank while it loads.
7. Global `crm-motion` transitions applied to every sidebar item + icon + kbd on hover — cheap individually but adds up on low-end laptops.

## Changes (frontend / presentation + data-fetching only)

### 1. Cut initial JS by lazy-loading heavy routes
Split the 4 biggest route files with the `.lazy.tsx` pattern so `/login` and `/app` (dashboard) don't download them:
- `app.cs-leads.tsx` → keep `createFileRoute` shell + loader (if any) in `app.cs-leads.tsx`, move component into `app.cs-leads.lazy.tsx` using `createLazyFileRoute` + `getRouteApi`.
- Same treatment for `app.raw-leads.tsx`, `app.forwarded-leads.tsx`, `app.browser-profiles.tsx`.
- Also lazy-split `app.analytics.tsx`, `app.reports.tsx`, `app.cs-reports.tsx`, `app.map.tsx` (leaflet is heavy).
- Do NOT export component functions from the critical file (kills splitting).

Expected: initial JS on `/login` and `/app` drops significantly; each heavy page loads on demand.

### 2. Defer fonts, remove blocking CSS on login
- Remove the 9 `@fontsource/*` imports from `src/router.tsx`.
- Add a single `<link rel="preconnect">` + `<link rel="stylesheet">` to Google Fonts (or keep fontsource but load only 400 + 600 for Epilogue and 600 + 700 for Urbanist — 4 files instead of 9) inside `src/routes/__root.tsx` `head().links` with `media="print" onload="this.media='all'"` pattern for non-blocking load.
- Result: login paints without waiting for 9 font files.

### 3. Slim realtime subscriptions
In `src/hooks/use-realtime-sync.ts`:
- Filter to `event: "INSERT" | "UPDATE"` only (drop DELETE noise).
- Debounce invalidations per query key (200–400 ms trailing) so a burst of writes from many users triggers one refetch, not N.
- Only subscribe to tables whose data is actually on the currently visible route: gate by `useRouterState({ select: s => s.location.pathname })` and pass to the hook, or split into per-route subscriptions inside each list route instead of a global shell subscription.
- Keep `cs` role opted-out (already correct).

### 4. Stop remounting the route tree on navigation
In `src/components/app-shell.tsx`, drop `<div key={path}>` around `{children}`. Keep the fade animation on the page-level `PageHeader`/`PageBody` if desired via CSS only, no key remount. Route change becomes O(diff) instead of O(full tree).

### 5. Login page cleanup
- Remove the blocking profile-count query on mount. Decide "first-time setup" link via a lightweight `head: true` count wrapped in `useQuery` with `staleTime: Infinity` and rendered after the form (so it never blocks input).
- Keep session-check `getSession()` but skip the second `getUser()` round-trip after `signInWithPassword` — `signInWithPassword` already returns the user; use `data.user`.

### 6. Dashboard: instant skeleton + prefetch
- Show numeric tile skeletons while `stats` loads so the page never looks blank.
- Add `loader: ({ context }) => context.queryClient.prefetchQuery(...)` on `/app` for `admin-dashboard-stats` — non-blocking prefetch during navigation.

### 7. Micro-optimizations (cheap, high-signal)
- Drop `crm-motion` transitions on sidebar `kbd` shortcut chips and icons; keep on the link background only. Fewer style recalcs on hover.
- Set `defaultPreload: "intent"` in `src/router.tsx` so hovering a sidebar link starts prefetching the split chunk. (Currently `false`.)
- Keep `defaultPreloadStaleTime: 0` (correct for TanStack Query).
- Add `<meta name="theme-color">` and a stable `<link rel="icon">` in `__root.tsx` so mobile Chrome stops repainting.

## Files touched

- `src/router.tsx` — remove font imports, set `defaultPreload: "intent"`.
- `src/routes/__root.tsx` — font `<link>` tags in `head().links`.
- `src/routes/app.cs-leads.tsx` + new `src/routes/app.cs-leads.lazy.tsx`
- `src/routes/app.raw-leads.tsx` + new `.lazy.tsx`
- `src/routes/app.forwarded-leads.tsx` + new `.lazy.tsx`
- `src/routes/app.browser-profiles.tsx` + new `.lazy.tsx`
- `src/routes/app.analytics.tsx`, `app.reports.tsx`, `app.cs-reports.tsx`, `app.map.tsx` + `.lazy.tsx` counterparts
- `src/hooks/use-realtime-sync.ts` — INSERT/UPDATE only + debounce + route-scoped
- `src/components/app-shell.tsx` — remove `key={path}` remount
- `src/routes/login.tsx` — non-blocking setup check, single-round-trip sign-in
- `src/routes/app.index.tsx` — skeleton tiles + prefetch loader

## Explicit non-goals

- No database schema changes, no new indexes, no RPC changes.
- No visual redesign — Navy Trust theme, typography, and layout stay identical.
- No changes to business logic (lead statuses, forwarding, CS pipeline).

## Verification

- Build succeeds; `tsgo` clean.
- Playwright: measure `/login` first-paint and `/app` route-switch time before/after (Performance API + screenshot).
- Confirm sidebar navigation between Dashboard ↔ Raw Leads ↔ CS Pipeline no longer flashes.
- Confirm realtime still updates lists (insert a row via SQL, watch it appear).
