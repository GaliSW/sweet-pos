-- 1) 共班:同櫃同班段可排多人(API 限 2 人),訂單新增第二銷售人員 seller2_id,
--    業績/抽成由 API 端各半計算。
-- 2) 付款方式新增「轉帳」(transfer)。
-- 3) 庫存異動新增「交班盤點」(handover_count),行為同開班/下班盤點(帶實際盤點數重設基準)。
-- 4) 抽成級距支援個人覆寫:commission_tiers.staff_id(null = 全域預設)。
-- 5) create_pos_order / update_pos_order 加 p_seller2_id,付款白名單加 transfer。

-- 共班:一人不可重複排同班段,但同班段可排多人
alter table public.shifts
  drop constraint shifts_counter_id_shift_date_shift_code_key;

alter table public.shifts
  add constraint shifts_counter_date_code_staff_key unique (counter_id, shift_date, shift_code, staff_id);

-- 訂單第二銷售人員(共班)
alter table public.orders
  add column seller2_id uuid references public.profiles(id);

-- 付款方式加轉帳
alter table public.orders
  drop constraint orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('cash', 'credit_card', 'line_pay', 'jkopay', 'transfer'));

-- 庫存異動加交班盤點
alter table public.inventory_movements
  drop constraint inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (
    movement_type in ('opening_count', 'closing_count', 'handover_count', 'purchase', 'sampling', 'waste', 'adjustment', 'sale')
  );

-- 抽成級距個人覆寫:staff_id null = 全域預設
alter table public.commission_tiers
  drop constraint commission_tiers_min_daily_sales_key;

alter table public.commission_tiers
  add column staff_id uuid references public.profiles(id) on delete cascade;

create unique index commission_tiers_global_min_key
  on public.commission_tiers (min_daily_sales)
  where staff_id is null;

create unique index commission_tiers_staff_min_key
  on public.commission_tiers (staff_id, min_daily_sales)
  where staff_id is not null;

-- RPC:加 p_seller2_id(簽名改變需先 drop 舊版),付款白名單加 transfer
drop function public.create_pos_order(uuid, uuid, uuid, uuid, text, jsonb);

create function public.create_pos_order(
  p_counter_id uuid,
  p_seller_id uuid,
  p_cashier_id uuid,
  p_discount_id uuid,
  p_payment_method text,
  p_items jsonb,
  p_seller2_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_no text;
  v_sales_amount numeric(12,2);
  v_discount_amount numeric(12,2);
  v_receivable_amount numeric(12,2);
begin
  if auth.role() = 'authenticated' and p_cashier_id <> auth.uid() and not public.is_manager() then
    raise exception '不可用其他人員身份建立訂單';
  end if;

  if p_payment_method not in ('cash', 'credit_card', 'line_pay', 'jkopay', 'transfer') then
    raise exception '不支援的付款方式';
  end if;

  if p_seller2_id is not null and p_seller2_id = p_seller_id then
    p_seller2_id := null;
  end if;

  v_order_id := gen_random_uuid();
  v_order_no := 'POS-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(v_order_id::text, 1, 6));

  insert into public.orders (
    id, order_no, counter_id, seller_id, seller2_id, cashier_id, discount_id, payment_method,
    sales_amount, discount_amount, receivable_amount, received_amount, status
  ) values (
    v_order_id, v_order_no, p_counter_id, p_seller_id, p_seller2_id, p_cashier_id, p_discount_id,
    p_payment_method, 0, 0, 0, 0, 'completed'
  );

  v_sales_amount := public.write_pos_order_items(
    v_order_id, v_order_no, p_counter_id, p_cashier_id, p_items
  );
  v_discount_amount := public.calculate_order_discount(v_sales_amount, p_discount_id);
  v_receivable_amount := greatest(0, v_sales_amount - v_discount_amount);

  update public.orders
    set sales_amount = v_sales_amount,
        discount_amount = v_discount_amount,
        receivable_amount = v_receivable_amount,
        received_amount = v_receivable_amount
    where id = v_order_id;

  return v_order_id;
end;
$$;

drop function public.update_pos_order(uuid, uuid, uuid, text, jsonb, uuid, timestamptz);

create function public.update_pos_order(
  p_order_id uuid,
  p_seller_id uuid,
  p_discount_id uuid,
  p_payment_method text,
  p_items jsonb,
  p_edited_by uuid,
  p_created_at timestamptz,
  p_seller2_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_sales_amount numeric(12,2);
  v_discount_amount numeric(12,2);
  v_receivable_amount numeric(12,2);
begin
  select * into v_order from public.orders where id = p_order_id;

  if not found then
    raise exception '找不到訂單';
  end if;

  if v_order.status <> 'completed' then
    raise exception '已作廢的訂單不可修改';
  end if;

  if p_payment_method not in ('cash', 'credit_card', 'line_pay', 'jkopay', 'transfer') then
    raise exception '不支援的付款方式';
  end if;

  if p_seller2_id is not null and p_seller2_id = p_seller_id then
    p_seller2_id := null;
  end if;

  delete from public.inventory_movements
    where order_id = p_order_id
      and movement_type = 'sale';
  delete from public.order_preorder_items where order_id = p_order_id;
  delete from public.order_items where order_id = p_order_id;

  v_sales_amount := public.write_pos_order_items(
    p_order_id, v_order.order_no, v_order.counter_id, p_edited_by, p_items
  );
  v_discount_amount := public.calculate_order_discount(v_sales_amount, p_discount_id);
  v_receivable_amount := greatest(0, v_sales_amount - v_discount_amount);

  update public.orders
    set seller_id = p_seller_id,
        seller2_id = p_seller2_id,
        discount_id = p_discount_id,
        payment_method = p_payment_method,
        sales_amount = v_sales_amount,
        discount_amount = v_discount_amount,
        receivable_amount = v_receivable_amount,
        received_amount = v_receivable_amount,
        created_at = coalesce(p_created_at, created_at),
        edited_by = p_edited_by,
        edited_at = now()
    where id = p_order_id;

  return p_order_id;
end;
$$;

grant execute on function public.create_pos_order(uuid, uuid, uuid, uuid, text, jsonb, uuid) to authenticated, service_role;
grant execute on function public.update_pos_order(uuid, uuid, uuid, text, jsonb, uuid, timestamptz, uuid) to authenticated, service_role;
