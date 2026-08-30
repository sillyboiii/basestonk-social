-- 006: Add bio to accounts
alter table accounts add column if not exists bio text;