-- BaseStonk social: posts table (user-generated content)
-- Run this in Supabase SQL Editor: supabase.com/dashboard/project/<ref>/sql

create table if not exists posts (
  id bigint generated always as identity primary key,
  author text not null,               -- wallet address of the author
  body text not null check (char_length(body) between 1 and 280),
  token_symbol text,                  -- optional attached token ticker
  token_image text,                   -- attached token image url
  likes int not null default 0,
  created_at timestamptz not null default now()
);

alter table posts enable row level security;

create policy "public read posts" on posts for select using (true);
create policy "public insert posts" on posts for insert with check (true);
create policy "public like posts" on posts for update using (true) with check (true);

create index if not exists idx_posts_created_at on posts (created_at desc);