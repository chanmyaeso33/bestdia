create table if not exists public.content_calendar (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  channel text not null check (channel in ('facebook', 'tiktok', 'telegram', 'website')),
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'published', 'cancelled', 'missed')),
  published_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_calendar_scheduled_idx
  on public.content_calendar (status, scheduled_for asc);

create index if not exists content_calendar_draft_idx
  on public.content_calendar (draft_id);

create index if not exists content_calendar_opportunity_idx
  on public.content_calendar (opportunity_id, scheduled_for desc);
