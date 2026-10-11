-- 叫蛋記帳：資料表、權限與修改紀錄
-- 金額一律以新台幣「元」的整數儲存。
-- 原則：
--   * 只有帳本成員能讀寫該帳本（RLS）。
--   * 操作人一律取自登入帳號 auth.uid()，由觸發器寫入，前端無法指定。
--   * 修改紀錄 audit_log 只能讀，一般使用者不能新增、修改或刪除。
--   * 付款與作廢只能透過資料庫函式進行，確保同一筆交易內完成並寫入紀錄。
--   * 每筆資料有 version，前端更新時帶上讀到的版本，版本不符代表對方已改過（衝突）。

-- ───────────────────────── 帳本與成員 ─────────────────────────

create table public.ledgers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  egg_unit_price integer not null default 15 check (egg_unit_price between 1 and 10000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.ledger_members (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers (id),
  user_id uuid not null unique references auth.users (id),
  display_name text not null,
  sort integer not null default 0,
  unique (ledger_id, display_name)
);

-- 目前登入者是否為該帳本成員（security definer 避免 RLS 遞迴）
create function public.is_member(p_ledger uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ledger_members m
    where m.ledger_id = p_ledger and m.user_id = auth.uid()
  );
$$;

-- 確認某成員屬於該帳本（叫蛋人、付款人、登記人必須是同帳本成員）
create function public.member_in_ledger(p_member uuid, p_ledger uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ledger_members m where m.id = p_member and m.ledger_id = p_ledger);
$$;

-- 台灣今天
create function public.taipei_today() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Asia/Taipei')::date; $$;

-- ───────────────────────── 叫蛋 ─────────────────────────

create table public.egg_orders (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers (id),
  ordered_on date not null,
  delivery_on date not null,
  boxes integer not null check (boxes between 1 and 999),
  price_per_box integer check (price_per_box is null or price_per_box between 0 and 1000000),
  ordered_by uuid not null references public.ledger_members (id),
  client_request_id uuid not null unique,
  voided_at timestamptz,
  voided_by uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (delivery_on >= ordered_on)
);
create index on public.egg_orders (ledger_id, delivery_on);

-- ───────────────────────── 付款 ─────────────────────────
-- 一次付款（payments）可以分配到多筆叫蛋（payment_allocations）。
-- 付款總額 = 尚未作廢的分配金額加總。

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers (id),
  paid_on date not null,
  payer uuid not null references public.ledger_members (id),
  client_request_id uuid not null unique,
  voided_at timestamptz,
  voided_by uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on public.payments (ledger_id, paid_on);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers (id),
  payment_id uuid not null references public.payments (id),
  order_id uuid not null references public.egg_orders (id),
  amount integer not null check (amount > 0 and amount <= 100000000),
  voided_at timestamptz,
  voided_by uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (payment_id, order_id)
);
create index on public.payment_allocations (order_id);

-- ───────────────────────── 每日賣蛋 ─────────────────────────

create table public.daily_sales (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers (id),
  sale_date date not null,
  mode text not null check (mode in ('income', 'count', 'rest')),
  income integer check (income is null or income between 0 and 100000000),
  egg_count integer check (egg_count is null or egg_count between 0 and 1000000),
  unit_price integer check (unit_price is null or unit_price between 1 and 10000),
  recorded_by uuid not null references public.ledger_members (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (ledger_id, sale_date),
  check (
    (mode = 'rest' and income is null and egg_count is null and unit_price is null)
    or (mode = 'income' and income is not null and unit_price is null)
    or (mode = 'count' and egg_count is not null and unit_price is not null
        and income = egg_count * unit_price)
  )
);

-- ───────────────────────── 修改紀錄 ─────────────────────────

create table public.audit_log (
  id bigint generated always as identity primary key,
  ledger_id uuid not null references public.ledgers (id),
  at timestamptz not null default now(),
  actor uuid,
  actor_name text not null,
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb
);
create index on public.audit_log (ledger_id, at desc);

create function public.actor_name(p_ledger uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select display_name from public.ledger_members where ledger_id = p_ledger and user_id = auth.uid()),
    case when auth.uid() is null then '系統管理（SQL）' else '未知帳號' end
  );
$$;

create function public.write_audit(
  p_ledger uuid, p_action text, p_entity text, p_entity_id uuid, p_before jsonb, p_after jsonb
) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log (ledger_id, actor, actor_name, action, entity, entity_id, before, after)
  values (p_ledger, auth.uid(), public.actor_name(p_ledger), p_action, p_entity, p_entity_id, p_before, p_after);
$$;
revoke execute on function public.write_audit(uuid, text, text, uuid, jsonb, jsonb) from public, anon, authenticated;

-- ───────────────────────── 共用觸發器 ─────────────────────────

-- 新增：操作人取自登入帳號；修改：版本 +1、記錄修改人與時間，且不可改帳本或建立資訊
create function public.stamp_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    if tg_table_name <> 'ledgers' then
      new.created_by := auth.uid();
    end if;
    new.updated_by := auth.uid();
  else
    if new.ledger_id is distinct from old.ledger_id then
      raise exception '不能變更帳本' using errcode = '42501';
    end if;
    if tg_table_name <> 'ledgers' then
      new.created_by := old.created_by;
      new.created_at := old.created_at;
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

-- ledgers 用 id 當 ledger_id
create function public.stamp_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then raise exception '不能變更帳本' using errcode = '42501'; end if;
    new.version := old.version + 1;
    new.created_at := old.created_at;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- 一般新增/修改自動寫入修改紀錄；付款函式會自行寫一筆完整紀錄並略過這裡
create function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ledger uuid;
  v_action text;
  v_before jsonb;
  v_after jsonb := to_jsonb(new);
begin
  if coalesce(current_setting('egg.skip_audit', true), '') = 'on' then
    return null;
  end if;
  v_ledger := coalesce((v_after ->> 'ledger_id')::uuid, (v_after ->> 'id')::uuid);
  if tg_op = 'INSERT' then
    v_action := 'create';
  else
    v_before := to_jsonb(old);
    if v_before - 'version' - 'updated_at' - 'updated_by' = v_after - 'version' - 'updated_at' - 'updated_by' then
      return null; -- 沒有實際變更
    end if;
    v_action := 'update';
  end if;
  perform public.write_audit(v_ledger, v_action, tg_table_name, new.id, v_before, v_after);
  return null;
end $$;

create function public.check_order_refs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.member_in_ledger(new.ordered_by, new.ledger_id) then
    raise exception '叫蛋人不是此帳本成員' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.voided_at is not null and new.voided_at is not null then
    raise exception '這筆叫蛋已作廢，不能修改' using errcode = '23514';
  end if;
  return new;
end $$;

create function public.check_payment_refs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.member_in_ledger(new.payer, new.ledger_id) then
    raise exception '付款人不是此帳本成員' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.voided_at is not null and new.voided_at is not null then
    raise exception '這筆付款已作廢，不能修改' using errcode = '23514';
  end if;
  if new.paid_on > public.taipei_today() then
    raise exception '付款日期不能是未來' using errcode = '23514';
  end if;
  return new;
end $$;

create function public.check_allocation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.payment_id is distinct from old.payment_id or new.order_id is distinct from old.order_id then
      raise exception '不能變更付款對應的叫蛋' using errcode = '42501';
    end if;
    if old.voided_at is not null and new.voided_at is not null then
      raise exception '這筆付款分配已作廢，不能修改' using errcode = '23514';
    end if;
    if new.voided_at is null and exists (select 1 from public.payments p where p.id = new.payment_id and p.voided_at is not null) then
      raise exception '這筆付款已復原，不能修改' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create function public.check_sale() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sale_date > public.taipei_today() then
    raise exception '未來日期不能登記銷售' using errcode = '23514';
  end if;
  if not public.member_in_ledger(new.recorded_by, new.ledger_id) then
    raise exception '登記人不是此帳本成員' using errcode = '23514';
  end if;
  -- 按顆數：收入一律由顆數 × 當次售價計算
  if new.mode = 'count' then
    new.income := new.egg_count * new.unit_price;
  end if;
  return new;
end $$;

create trigger stamp before insert or update on public.ledgers for each row execute function public.stamp_ledger();
create trigger stamp before insert or update on public.egg_orders for each row execute function public.stamp_row();
create trigger stamp before insert or update on public.payments for each row execute function public.stamp_row();
create trigger stamp before insert or update on public.payment_allocations for each row execute function public.stamp_row();
create trigger stamp before insert or update on public.daily_sales for each row execute function public.stamp_row();

create trigger check_refs before insert or update on public.egg_orders for each row execute function public.check_order_refs();
create trigger check_refs before insert or update on public.payments for each row execute function public.check_payment_refs();
create trigger check_refs before insert or update on public.payment_allocations for each row execute function public.check_allocation();
create trigger check_refs before insert or update on public.daily_sales for each row execute function public.check_sale();

create trigger audit after insert or update on public.ledgers for each row execute function public.audit_row();
create trigger audit after insert or update on public.egg_orders for each row execute function public.audit_row();
create trigger audit after insert or update on public.payments for each row execute function public.audit_row();
create trigger audit after insert or update on public.payment_allocations for each row execute function public.audit_row();
create trigger audit after insert or update on public.daily_sales for each row execute function public.audit_row();

-- 帳務不可刪除（包含管理者以外的所有角色；修正一律用更正或作廢）
create function public.forbid_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception '紀錄不能刪除，請用修改或作廢' using errcode = '42501';
end $$;
create trigger no_delete before delete on public.egg_orders for each row execute function public.forbid_delete();
create trigger no_delete before delete on public.payments for each row execute function public.forbid_delete();
create trigger no_delete before delete on public.payment_allocations for each row execute function public.forbid_delete();
create trigger no_delete before delete on public.daily_sales for each row execute function public.forbid_delete();
create trigger no_delete before delete on public.audit_log for each row execute function public.forbid_delete();

create function public.forbid_audit_update() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception '修改紀錄不能變更' using errcode = '42501';
end $$;
create trigger no_update before update on public.audit_log for each row execute function public.forbid_audit_update();

-- ───────────────────────── 付款函式 ─────────────────────────

-- 登記付款。p_allocations = [{"order_id": "...", "amount": 123}, ...]
-- p_client_request_id 防止連按：同一個請求編號只會登記一次，重送回傳原本的付款。
create function public.record_payment(
  p_ledger uuid,
  p_paid_on date,
  p_payer uuid,
  p_allocations jsonb,
  p_client_request_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_payment uuid;
  v_item jsonb;
  v_order public.egg_orders;
  v_amount integer;
  v_paid integer;
  v_total integer := 0;
  v_count integer := 0;
begin
  if not public.is_member(p_ledger) then
    raise exception '沒有這本帳的權限' using errcode = '42501';
  end if;

  select id into v_payment from public.payments where client_request_id = p_client_request_id;
  if v_payment is not null then
    return v_payment; -- 重複送出，不再登記
  end if;

  if p_paid_on is null or p_paid_on > public.taipei_today() then
    raise exception '付款日期不能是未來' using errcode = '23514';
  end if;
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception '請選擇要付款的叫蛋' using errcode = '23514';
  end if;

  perform set_config('egg.skip_audit', 'on', true);

  insert into public.payments (ledger_id, paid_on, payer, client_request_id)
  values (p_ledger, p_paid_on, p_payer, p_client_request_id)
  returning id into v_payment;

  for v_item in select * from jsonb_array_elements(p_allocations) loop
    v_amount := (v_item ->> 'amount')::integer;
    -- 鎖住該筆叫蛋，避免兩人同時付款超付
    select * into v_order from public.egg_orders
      where id = (v_item ->> 'order_id')::uuid and ledger_id = p_ledger
      for update;
    if not found or v_order.voided_at is not null then
      raise exception '找不到這筆叫蛋，可能已被作廢' using errcode = '23514';
    end if;
    if v_order.price_per_box is null then
      raise exception '%/% 送的叫蛋還沒有價格，請先補價格再付款',
        extract(month from v_order.delivery_on), extract(day from v_order.delivery_on)
        using errcode = '23514';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception '付款金額必須大於 0' using errcode = '23514';
    end if;
    select coalesce(sum(a.amount), 0) into v_paid
      from public.payment_allocations a join public.payments p on p.id = a.payment_id
      where a.order_id = v_order.id and a.voided_at is null and p.voided_at is null;
    if v_paid + v_amount > v_order.price_per_box * v_order.boxes then
      raise exception '付款金額超過 %/% 這筆的尚欠金額（對方可能剛付過款，請重新整理）',
        extract(month from v_order.delivery_on), extract(day from v_order.delivery_on)
        using errcode = 'P0001', hint = 'conflict';
    end if;
    insert into public.payment_allocations (ledger_id, payment_id, order_id, amount)
    values (p_ledger, v_payment, v_order.id, v_amount);
    v_total := v_total + v_amount;
    v_count := v_count + 1;
  end loop;

  perform set_config('egg.skip_audit', 'off', true);

  perform public.write_audit(p_ledger, 'pay', 'payments', v_payment, null,
    jsonb_build_object(
      'paid_on', p_paid_on, 'payer', p_payer, 'total', v_total,
      'allocations', p_allocations
    ));
  return v_payment;
end $$;

-- 作廢整筆付款（復原）。歷史保留，付款標記為作廢。
create function public.void_payment(p_payment uuid, p_expected_version integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_payment public.payments;
  v_allocs jsonb;
begin
  select * into v_payment from public.payments where id = p_payment for update;
  if not found or not public.is_member(v_payment.ledger_id) then
    raise exception '找不到這筆付款' using errcode = '42501';
  end if;
  if v_payment.voided_at is not null then
    raise exception '這筆付款已經復原過了' using errcode = 'P0001', hint = 'conflict';
  end if;
  if p_expected_version is not null and v_payment.version <> p_expected_version then
    raise exception '這筆付款剛被修改過，請重新確認' using errcode = 'P0001', hint = 'conflict';
  end if;

  select jsonb_agg(jsonb_build_object('order_id', order_id, 'amount', amount))
    into v_allocs from public.payment_allocations
    where payment_id = p_payment and voided_at is null;

  perform set_config('egg.skip_audit', 'on', true);
  update public.payments set voided_at = now(), voided_by = auth.uid() where id = p_payment;
  perform set_config('egg.skip_audit', 'off', true);

  perform public.write_audit(v_payment.ledger_id, 'void_payment', 'payments', p_payment,
    jsonb_build_object('paid_on', v_payment.paid_on, 'payer', v_payment.payer, 'allocations', v_allocs),
    null);
end $$;

-- 把某筆叫蛋改回未付款：作廢這筆叫蛋所有有效的付款分配。
-- 若某次付款因此沒有任何有效分配，整筆付款也一併作廢。
create function public.revert_order_payments(p_order uuid, p_expected_version integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.egg_orders;
  v_allocs jsonb;
begin
  select * into v_order from public.egg_orders where id = p_order for update;
  if not found or not public.is_member(v_order.ledger_id) then
    raise exception '找不到這筆叫蛋' using errcode = '42501';
  end if;
  if p_expected_version is not null and v_order.version <> p_expected_version then
    raise exception '這筆叫蛋剛被修改過，請重新確認' using errcode = 'P0001', hint = 'conflict';
  end if;

  select jsonb_agg(jsonb_build_object('allocation_id', a.id, 'payment_id', a.payment_id, 'amount', a.amount,
                                      'paid_on', p.paid_on, 'payer', p.payer))
    into v_allocs
    from public.payment_allocations a join public.payments p on p.id = a.payment_id
    where a.order_id = p_order and a.voided_at is null and p.voided_at is null;

  if v_allocs is null then
    raise exception '這筆叫蛋目前沒有付款紀錄' using errcode = 'P0001', hint = 'conflict';
  end if;

  perform set_config('egg.skip_audit', 'on', true);
  update public.payment_allocations a set voided_at = now(), voided_by = auth.uid()
    from public.payments p
    where p.id = a.payment_id and a.order_id = p_order and a.voided_at is null and p.voided_at is null;
  update public.payments p set voided_at = now(), voided_by = auth.uid()
    where p.voided_at is null
      and p.id in (select (x ->> 'payment_id')::uuid from jsonb_array_elements(v_allocs) x)
      and not exists (select 1 from public.payment_allocations a where a.payment_id = p.id and a.voided_at is null);
  perform set_config('egg.skip_audit', 'off', true);

  perform public.write_audit(v_order.ledger_id, 'revert_order', 'egg_orders', p_order,
    jsonb_build_object('allocations', v_allocs), null);
end $$;

-- 作廢叫蛋（記錯時使用；已有付款的需先改回未付款）
create function public.void_order(p_order uuid, p_expected_version integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.egg_orders;
begin
  select * into v_order from public.egg_orders where id = p_order for update;
  if not found or not public.is_member(v_order.ledger_id) then
    raise exception '找不到這筆叫蛋' using errcode = '42501';
  end if;
  if v_order.voided_at is not null then
    raise exception '這筆叫蛋已經作廢' using errcode = 'P0001', hint = 'conflict';
  end if;
  if p_expected_version is not null and v_order.version <> p_expected_version then
    raise exception '這筆叫蛋剛被修改過，請重新確認' using errcode = 'P0001', hint = 'conflict';
  end if;
  if exists (select 1 from public.payment_allocations a join public.payments p on p.id = a.payment_id
             where a.order_id = p_order and a.voided_at is null and p.voided_at is null) then
    raise exception '這筆已有付款，請先改回未付款再作廢' using errcode = '23514';
  end if;
  perform set_config('egg.skip_audit', 'on', true);
  update public.egg_orders set voided_at = now(), voided_by = auth.uid() where id = p_order;
  perform set_config('egg.skip_audit', 'off', true);
  perform public.write_audit(v_order.ledger_id, 'void_order', 'egg_orders', p_order, to_jsonb(v_order), null);
end $$;

-- 復原作廢的叫蛋
create function public.restore_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.egg_orders;
begin
  select * into v_order from public.egg_orders where id = p_order for update;
  if not found or not public.is_member(v_order.ledger_id) then
    raise exception '找不到這筆叫蛋' using errcode = '42501';
  end if;
  if v_order.voided_at is null then
    raise exception '這筆叫蛋沒有作廢' using errcode = 'P0001', hint = 'conflict';
  end if;
  perform set_config('egg.skip_audit', 'on', true);
  update public.egg_orders set voided_at = null, voided_by = null where id = p_order;
  perform set_config('egg.skip_audit', 'off', true);
  perform public.write_audit(v_order.ledger_id, 'restore_order', 'egg_orders', p_order, null, null);
end $$;

-- ───────────────────────── 權限 ─────────────────────────

alter table public.ledgers enable row level security;
alter table public.ledger_members enable row level security;
alter table public.egg_orders enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.daily_sales enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.ledgers, public.ledger_members, public.egg_orders, public.payments,
  public.payment_allocations, public.daily_sales, public.audit_log from anon, authenticated;

grant select on public.ledgers, public.ledger_members, public.egg_orders, public.payments,
  public.payment_allocations, public.daily_sales, public.audit_log to authenticated;

-- 只開放可更正的欄位
grant update (egg_unit_price, name) on public.ledgers to authenticated;
grant insert (ledger_id, ordered_on, delivery_on, boxes, price_per_box, ordered_by, client_request_id)
  on public.egg_orders to authenticated;
grant update (ordered_on, delivery_on, boxes, price_per_box, ordered_by) on public.egg_orders to authenticated;
grant update (paid_on, payer) on public.payments to authenticated;
grant update (amount) on public.payment_allocations to authenticated;
grant insert (ledger_id, sale_date, mode, income, egg_count, unit_price, recorded_by) on public.daily_sales to authenticated;
grant update (sale_date, mode, income, egg_count, unit_price, recorded_by) on public.daily_sales to authenticated;

create policy member_read on public.ledgers for select to authenticated using (public.is_member(id));
create policy member_update on public.ledgers for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

create policy member_read on public.ledger_members for select to authenticated using (public.is_member(ledger_id));

create policy member_read on public.egg_orders for select to authenticated using (public.is_member(ledger_id));
create policy member_insert on public.egg_orders for insert to authenticated with check (public.is_member(ledger_id));
create policy member_update on public.egg_orders for update to authenticated using (public.is_member(ledger_id)) with check (public.is_member(ledger_id));

create policy member_read on public.payments for select to authenticated using (public.is_member(ledger_id));
create policy member_update on public.payments for update to authenticated using (public.is_member(ledger_id)) with check (public.is_member(ledger_id));

create policy member_read on public.payment_allocations for select to authenticated using (public.is_member(ledger_id));
create policy member_update on public.payment_allocations for update to authenticated using (public.is_member(ledger_id)) with check (public.is_member(ledger_id));

create policy member_read on public.daily_sales for select to authenticated using (public.is_member(ledger_id));
create policy member_insert on public.daily_sales for insert to authenticated with check (public.is_member(ledger_id));
create policy member_update on public.daily_sales for update to authenticated using (public.is_member(ledger_id)) with check (public.is_member(ledger_id));

create policy member_read on public.audit_log for select to authenticated using (public.is_member(ledger_id));

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.record_payment(uuid, date, uuid, jsonb, uuid) to authenticated;
grant execute on function public.void_payment(uuid, integer) to authenticated;
grant execute on function public.revert_order_payments(uuid, integer) to authenticated;
grant execute on function public.void_order(uuid, integer) to authenticated;
grant execute on function public.restore_order(uuid) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.member_in_ledger(uuid, uuid) to authenticated;
grant execute on function public.taipei_today() to authenticated;
grant execute on function public.actor_name(uuid) to authenticated;

-- 即時同步：兩支手機任一方修改，另一方自動更新
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.egg_orders, public.payments,
      public.payment_allocations, public.daily_sales, public.ledgers, public.audit_log;
  end if;
end $$;
