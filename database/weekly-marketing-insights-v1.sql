create table if not exists public.weekly_marketing_insights (
  id uuid primary key default gen_random_uuid(),
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  title text not null,
  summary text not null,
  what_worked jsonb not null default '[]'::jsonb,
  what_failed jsonb not null default '[]'::jsonb,
  channel_insights jsonb not null default '[]'::jsonb,
  product_insights jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  scoring_adjustments jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) not null default 0 check (confidence >= 0 and confidence <= 1),
  source_metrics_count integer not null default 0 check (source_metrics_count >= 0),
  total_views integer not null default 0 check (total_views >= 0),
  total_orders integer not null default 0 check (total_orders >= 0),
  total_revenue numeric(12,2) not null default 0 check (total_revenue >= 0),
  prompt_version text not null default 'analyst-agent-v1',
  model text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists weekly_marketing_insights_created_idx
  on public.weekly_marketing_insights (created_at desc);

create index if not exists weekly_marketing_insights_period_idx
  on public.weekly_marketing_insights (period_start desc, period_end desc);
