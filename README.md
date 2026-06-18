# Lead Flow CRM

Internal lead operations dashboard for managing home services leads scraped from Nextdoor.

## What this does

A custom Chrome extension scrapes relevant posts from Nextdoor and sends them to this CRM dashboard via a webhook endpoint. The backend automatically classifies these leads using AI as yes/no/review based on criteria. CRM processors then review these classifications, forwarding qualified leads to the customer service pipeline, where the CS team contacts customers and records the outcomes.

## Roles

| Role        | Access                                             |
| ----------- | -------------------------------------------------- |
| admin       | Full access — user management, all pages, settings |
| sub_admin   | Same as admin minus user deletion                  |
| scraping    | Raw leads page only                                |
| processor   | Raw leads + forwarded leads + submit lead          |
| cs          | CS pipeline dashboard only                         |
| acc_handler | Browser profiles + map                             |
| facebook    | Submit lead page                                   |
| seo         | Submit lead page                                   |

## Tech stack

- **Frontend**: React 19, TanStack Router, TanStack Start (SSR)
- **Backend**: TanStack Start server functions, Nitro
- **Database**: Supabase (PostgreSQL + Auth + Realtime)
- **AI**: OpenAI (gpt-5-nano) for lead classification
- **Styling**: Tailwind CSS v4, shadcn/ui
- **Deployment**: Lovable

## Environment variables

| Variable                      | Required    | Description                                  |
| ----------------------------- | ----------- | -------------------------------------------- |
| SUPABASE_URL                  | Yes         | Your Supabase project URL                    |
| SUPABASE_PUBLISHABLE_KEY      | Yes         | Supabase anon/public key                     |
| SUPABASE_SERVICE_ROLE_KEY     | Yes         | Supabase service role key (server only)      |
| VITE_SUPABASE_URL             | Yes         | Same as SUPABASE_URL (client-side)           |
| VITE_SUPABASE_PUBLISHABLE_KEY | Yes         | Same as publishable key (client-side)        |
| OPENAI_API_KEY                | Yes         | OpenAI API key for AI lead classification    |
| WEBHOOK_SECRET                | Recommended | Secret header value for the Nextdoor webhook |

## Data flow

1. Chrome extension scrapes Nextdoor posts → POST `/api/public/nextdoor-leads`
2. Webhook stores raw posts in `raw_lead_cache` table
3. Processors open Raw Leads page → run AI classification (OpenAI)
4. AI marks each post: yes / no / review
5. Processor reviews AI decisions → forwards qualified leads to CS pipeline
6. CS team sees new leads in their dashboard → contacts customers → logs outcome

## Local development

```bash
bun install
cp .env.example .env  # fill in your Supabase and OpenAI credentials
bun dev
```

## Database migrations

Migrations live in `supabase/migrations/`. Run them via the Supabase CLI:

```bash
supabase db push
```

## First-time setup

If starting from scratch with a new Supabase project, visit `/setup` to create the first admin account.

## CI

GitHub Actions runs TypeScript and ESLint checks on every push to main.
![CI](https://github.com/nasbithsam-sys/lead-flow-crm-by-accboost/actions/workflows/ci.yml/badge.svg)
