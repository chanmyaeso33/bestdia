create table if not exists public.content_performance (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.content_calendar(id) on delete cascade,
  draft_id uuid references public.content_drafts(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  channel text not null check (channel in ('facebook', 'tiktok', 'telegram', 'website')),
  views integer not null default 0 check (views >= 0),
  likes integer not null default 0 check (likes >= 0),
  comments integer not null default 0 check (comments >= 0),
  shares integer not null default 0 check (shares >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  orders integer not null default 0 check (orders >= 0),
  revenue numeric(12,2) not null default 0 check (revenue >= 0),
  notes text,
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_performance_calendar_idx
  on public.content_performance (calendar_id, measured_at desc);

create index if not exists content_performance_opportunity_idx
  on public.content_performance (opportunity_id, measured_at desc);

create index if not exists content_performance_channel_measured_idx
  on public.content_performance (channel, measured_at desc);
