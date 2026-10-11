-- 移除開發時建立的兩個 E2E 測試帳號與測試帳本（已停用，不能登入）。可選擇性執行。
alter table public.audit_log disable trigger no_delete;
delete from public.audit_log where ledger_id in (select id from public.ledgers where name = 'E2E 測試帳本');
alter table public.audit_log enable trigger no_delete;
delete from public.ledger_members where ledger_id in (select id from public.ledgers where name = 'E2E 測試帳本');
delete from public.ledgers where name = 'E2E 測試帳本';
delete from auth.users where email like 'e2e-%@egg-ledger.test';
