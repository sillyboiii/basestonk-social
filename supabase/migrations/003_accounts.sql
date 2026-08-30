-- BaseStonk social: accounts (lightweight identity: handle + avatar)
-- Run this in Supabase SQL Editor: supabase.com/dashboard/project/<ref>/sql

create table if not exists accounts (
  wallet text primary key,
  handle text,
  avatar text,
  created_at timestamptz not null default now()
);

alter table accounts enable row level security;

create policy "public read accounts" on accounts for select using (true);
create policy "public insert accounts" on accounts for insert with check (true);
create policy "public update accounts" on accounts for update using (true) with check (true);