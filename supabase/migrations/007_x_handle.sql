-- 007: Add X / Twitter handle to accounts
alter table accounts add column if not exists x_handle varchar(60);