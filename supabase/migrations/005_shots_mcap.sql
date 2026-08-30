-- 005: Shots display by market cap (entry_mcap), plus guaranteed coin images
alter table posts add column if not exists entry_mcap numeric;

-- clean up the two throwaway test shots created during the 004 verification round
delete from posts where kind = 'shot' and author = '0x2222222222222222222222222222222222222222';