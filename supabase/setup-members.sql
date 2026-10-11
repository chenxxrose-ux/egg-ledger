-- 建立帳本並加入阿寶、草莓（只需執行一次）
-- 先在 Supabase → Authentication → Users → Add user 建好兩個帳號（勾選 Auto Confirm User），
-- 把下面兩個 email 換成實際帳號後，在 SQL Editor 執行。
with l as (
  insert into public.ledgers (name) values ('叫蛋記帳') returning id
)
insert into public.ledger_members (ledger_id, user_id, display_name, sort)
select l.id, u.id, m.name, m.sort
from l
join (values ('阿寶的email@example.com', '阿寶', 1), ('草莓的email@example.com', '草莓', 2)) as m(email, name, sort) on true
join auth.users u on lower(u.email) = lower(m.email)
returning display_name;
-- 應該回傳兩列（阿寶、草莓）。少一列代表 email 打錯或帳號還沒建立。
