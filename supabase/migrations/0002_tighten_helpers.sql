-- 只在資料庫內部使用的輔助函式，不開放前端直接呼叫
revoke execute on function public.member_in_ledger(uuid, uuid) from authenticated;
revoke execute on function public.actor_name(uuid) from authenticated;
