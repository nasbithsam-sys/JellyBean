# JellyBean database I/O optimization

## Scope

This change set prepares application and migration changes only. Opening or
merging the pull request does not change the production Supabase project.
Database migrations run only when the normal production deployment process
applies them.

The production audit was read-only and observed:

| Finding | Measured evidence |
| --- | ---: |
| Database size | 898 MB |
| Public relations | 878 MB |
| `raw_lead_cache` size | 672 MB |
| `raw_lead_cache` live rows | 22,642 |
| Estimated live row payload | 44 MB |
| Heap-to-live-payload ratio | 8.75x |
| Raw-count MV refreshes since August 7 | 2,097 |
| Physical reads from those refreshes | 297 GB |
| Historical old counter reads | 5.8 TB across 104,217 calls |
| Same-day bulk-delete reads | 865 MB across 44 batches |
| Same-day bulk-delete WAL | 348 MB across 44 batches |
| `user_roles` index scans | 3.6 billion |

## Included changes

1. Unschedule the two unused 15-minute materialized-view refresh jobs. The
   materialized views are preserved for rollback and dependency inspection.
2. Remove `raw_lead_cache` and `activity_logs` from the Supabase Realtime
   publication. The current repository does not subscribe to Postgres Changes
   for either table; raw-lead bulk moves already use Realtime Broadcast.
3. Make `cs_leads_status_counts()` scan visible qualified leads once instead
   of twice.
4. Cache the hot `qualified_leads` RLS role checks once per statement while
   preserving the existing authorization expressions.
5. Batch up to 50 AI lead decisions into one service-role RPC transaction.
6. Reduce the default raw-lead page from 500 rows to 200 rows.
7. Fold the CS new-lead counter into the existing page subscription, removing
   one duplicate Realtime channel while preserving notifications and automatic
   rephrasing.
8. Lower autovacuum/analyze thresholds for the two high-churn lead tables.

## Consequences and mitigations

| Change | Positive consequence | Risk or negative consequence | Mitigation / rollback |
| --- | --- | --- | --- |
| Stop MV refresh jobs | Removes repeated full scans and recurring WAL | An unknown external consumer could see stale MV data | Views remain present. Recreate the two cron schedules if a consumer is found |
| Remove two Realtime publication tables | Less logical-decoding work for high-churn writes | An undiscovered external Postgres Changes subscriber stops receiving those rows | Re-add the required table with `ALTER PUBLICATION supabase_realtime ADD TABLE ...` |
| One-pass CS counts | Roughly halves base-table work for the RPC | A function error affects CS badge totals | Verify totals against exact grouped counts before and after deployment |
| RLS initialization plans | Avoids role-table probes per candidate lead row | Incorrect policy transcription could change access | Deploy to a branch/staging database and test every application role before production |
| Batch AI updates | Up to 50 updates share one request/transaction | One invalid batch fails as a unit instead of partially succeeding | Validate the payload and preserve the existing UI error path |
| 200-row default page | Smaller responses and fewer buffer reads | Users see fewer leads per page | 500 remains an explicit page-size option |
| Fewer CS subscriptions | Less duplicated invalidation and Realtime work | Counter logic now depends on the remaining page channel | The same channel already handles every qualified-lead INSERT |
| More frequent autovacuum/analyze | Limits future dead-tuple accumulation and keeps plans current | More frequent small background maintenance runs | Monitor autovacuum duration and I/O; revert table storage parameters if needed |

## Deliberately excluded from automatic migrations

### Table repack

`raw_lead_cache` needs an off-peak `pg_repack`, but it must not run as part of
an application deployment. A full repack may need about twice the current table
plus index size in free disk (plan for at least 1.3–1.5 GB), temporarily raises
I/O, and takes brief locks at startup and final swap. Run it only after the I/O
budget has recovered, after a fresh backup, and after verifying free disk.

Expected result: reclaim approximately 450–550 MB, subject to the actual
post-repack size.

### Index removal

No index is dropped automatically. Several indexes overlap, but production
statistics must be observed after the repack because cumulative `idx_scan`
counts do not prove that an index is unnecessary today. Test candidate removals
in a Supabase branch with representative `EXPLAIN (ANALYZE, BUFFERS)` plans.

Initial candidates for branch testing:

- `idx_raw_lead_cache_captured_at` versus
  `idx_raw_lead_cache_captured_id_desc`
- `idx_raw_lead_cache_captured_at_category` versus the category-first and
  queue-specific indexes
- Full and partial canonical-link/post-ID indexes on `qualified_leads`
- Low-use standalone boolean indexes on `qualified_leads`

### Activity-log retention

The 340,809-row activity log needs an agreed retention period before any data
is archived or deleted. This PR does not assume whether the business requires
90, 180, or more days of audit history.

## Production rollout

1. Wait for Disk I/O budget and I/O wait to return to normal.
2. Create a fresh backup and a Supabase branch/staging copy.
3. Apply the three migrations to staging.
4. Test raw lead reads/writes, CS reads/writes, AI classification, counts, and
   all nine application roles.
5. Run Supabase security and performance advisors.
6. Compare exact counts with both RPC outputs.
7. Deploy during low traffic.
8. Observe IOPS, WAL, temporary files, API latency, autovacuum, Realtime errors,
   and `pg_stat_statements` for 24 hours.
9. Schedule the separate repack only after the deployment is stable.

## Verification SQL

```sql
-- Recurring jobs should be absent.
select jobid, schedule, command
from cron.job
where command like '%lead%counts%';

-- High-churn non-subscribed tables should not be published.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename in ('raw_lead_cache', 'activity_logs');

-- Compare raw trigger-maintained counters with exact current totals.
select category_key, assigned_to, total
from public.raw_lead_cache_counts
order by category_key, assigned_to;

select
  count(*) filter (where category is null and assigned_myself_at is null) as new,
  count(*) filter (where category = 'forwarded') as forwarded,
  count(*) filter (where category = 'not_found') as not_found,
  count(*) filter (where category = 'wrong') as wrong,
  count(*) filter (where category = 'duplicate') as duplicate
from public.raw_lead_cache;

-- Verify the one-pass CS function returns the expected shape.
select public.cs_leads_status_counts();
```

## Rollback snippets

Use only when the corresponding dependency is confirmed.

```sql
-- Restore the two Realtime publication entries.
alter publication supabase_realtime add table public.raw_lead_cache;
alter publication supabase_realtime add table public.activity_logs;

-- Restore the previous refresh cadence.
select cron.schedule(
  'refresh-raw-lead-counts',
  '*/15 * * * *',
  'refresh materialized view concurrently public.mv_raw_lead_cache_counts;'
);
select cron.schedule(
  'refresh-qualified-lead-counts',
  '7,22,37,52 * * * *',
  'refresh materialized view concurrently public.mv_qualified_leads_status_counts;'
);
```
