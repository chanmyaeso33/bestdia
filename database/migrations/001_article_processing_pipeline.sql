-- Add article processing pipeline fields to news_articles.
-- This migration intentionally does not redesign existing tables.

alter table public.news_articles
  add column if not exists processing_status text not null default 'collected',
  add column if not exists processed_at timestamptz,
  add column if not exists last_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'news_articles_processing_status_check'
      and conrelid = 'public.news_articles'::regclass
  ) then
    alter table public.news_articles
      add constraint news_articles_processing_status_check
      check (
        processing_status in (
          'collected',
          'cleaned',
          'classified',
          'analyzed',
          'opportunity_created',
          'published',
          'archived',
          'failed'
        )
      );
  end if;
end $$;

-- Optimizes worker queries that fetch articles still moving through the pipeline.
create index if not exists idx_news_articles_processing_queue
  on public.news_articles (processing_status, collected_at)
  where processing_status in (
    'collected',
    'cleaned',
    'classified',
    'analyzed',
    'failed'
  );

-- Optimizes "next unprocessed article" queries by freshness when collected_at is tied
-- or when workers prioritize recently published items.
create index if not exists idx_news_articles_processing_queue_published
  on public.news_articles (processing_status, published_at desc nulls last)
  where processing_status in (
    'collected',
    'cleaned',
    'classified',
    'analyzed',
    'failed'
  );
