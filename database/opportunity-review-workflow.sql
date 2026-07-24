create table if not exists public.opportunity_reviews (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  decision text not null check (decision in ('reviewed', 'approved', 'rejected', 'used')),
  selected_channel text,
  published_url text,
  notes text,
  feedback_label text check (feedback_label in ('good', 'neutral', 'bad')),
  metadata jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists opportunity_reviews_opportunity_created_idx
  on public.opportunity_reviews (opportunity_id, created_at desc);

create index if not exists opportunity_reviews_decision_reviewed_idx
  on public.opportunity_reviews (decision, reviewed_at desc);
