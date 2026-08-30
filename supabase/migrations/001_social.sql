-- BaseStonk Terminal: follows table
-- Run this in Supabase SQL Editor: supabase.com/dashboard/project/<ref>/sql

create table if not exists follows (
  id bigint generated always as identity primary key,
  follower text not null,          -- wallet address of the follower
  target text not null,            -- wallet address being followed
  created_at timestamptz not null default now(),
  unique (follower, target)
);

-- RLS: give full access for now (public read/write on follows),
-- tighten to auth.uid() when SIWE auth is added.
alter table follows enable row level security;

create policy "public read follows" on follows for select using (true);
create policy "public insert follows" on follows for insert with check (true);
create policy "public delete follows" on follows for delete using (true);

create index if not exists idx_follows_follower on follows (follower);
