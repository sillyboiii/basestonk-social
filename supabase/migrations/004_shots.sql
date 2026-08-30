-- 004: Shots (calls) — tag a token and the entry price is locked in at post time
alter table posts
  add column if not exists kind text not null default 'post',
  add column if not exists token_address text,
  add column if not exists entry_price numeric;

alter table posts
  drop constraint if exists posts_kind_check;

alter table posts
  add constraint posts_kind_check check (kind in ('post', 'shot'));

create index if not exists posts_kind_created_idx on posts (kind, created_at desc);