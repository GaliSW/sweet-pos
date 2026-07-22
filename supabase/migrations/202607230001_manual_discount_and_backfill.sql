-- 1) POS 手動扣款與備註:臨時活動(如滿千送品項)可下單品項後手動扣掉金額,
--    備註記錄原因;實收 = 銷售 - 組合折抵 - 訂單折扣 - 手動扣款(最低 0)。
-- 2) 店長補單:create_pos_order 支援指定訂單時間(p_created_at),
--    API 層限店長使用並可指定銷售人員,業績/抽成/庫存照指定內容入帳。

alter table public.orders
  add column manual_discount_amount numeric(12,2) not null default 0,
  add column note text;

drop function public.create_pos_order(uuid, uuid, uuid, uuid, text, jsonb, uuid, numeric);

create function public.create_pos_order(
  p_counter_id uuid,
  p_seller_id uuid,
  p_cashier_id uuid,
  p_discount_id uuid,
  p_payment_method text,
  p_items jsonb,
  p_seller2_id uuid default null,
  p_bundle_discount numeric default 0,
  p_manual_discount numeric default 0,
  p_note text default null,
  p_created_at timestamptz default null
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
  v_bundle_discount numeric(12,2);
  v_discount_amount numeric(12,2);
  v_manual_discount numeric(12,2);
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
  v_order_no := 'POS-' || to_char(coalesce(p_created_at, now()), 'YYYYMMDDHH24MISS') || '-' || upper(substr(v_order_id::text, 1, 6));

  insert into public.orders (
    id, order_no, counter_id, seller_id, seller2_id, cashier_id, discount_id, payment_method,
    sales_amount, discount_amount, receivable_amount, received_amount, status, note, created_at
  ) values (
    v_order_id, v_order_no, p_counter_id, p_seller_id, p_seller2_id, p_cashier_id, p_discount_id,
    p_payment_method, 0, 0, 0, 0, 'completed', nullif(trim(coalesce(p_note, '')), ''),
    coalesce(p_created_at, now())
  );

  v_sales_amount := public.write_pos_order_items(
    v_order_id, v_order_no, p_counter_id, p_cashier_id, p_items
  );
  v_bundle_discount := least(v_sales_amount, greatest(0, coalesce(p_bundle_discount, 0)));
  v_discount_amount := public.calculate_order_discount(
    greatest(0, v_sales_amount - v_bundle_discount), p_discount_id
  );
  v_manual_discount := least(
    greatest(0, v_sales_amount - v_bundle_discount - v_discount_amount),
    greatest(0, coalesce(p_manual_discount, 0))
  );
  v_receivable_amount := greatest(
    0, v_sales_amount - v_bundle_discount - v_discount_amount - v_manual_discount
  );

  update public.orders
    set sales_amount = v_sales_amount,
        bundle_discount_amount = v_bundle_discount,
        discount_amount = v_discount_amount,
        manual_discount_amount = v_manual_discount,
        receivable_amount = v_receivable_amount,
        received_amount = v_receivable_amount
    where id = v_order_id;

  return v_order_id;
end;
$$;

drop function public.update_pos_order(uuid, uuid, uuid, text, jsonb, uuid, timestamptz, uuid, numeric);

create function public.update_pos_order(
  p_order_id uuid,
  p_seller_id uuid,
  p_discount_id uuid,
  p_payment_method text,
  p_items jsonb,
  p_edited_by uuid,
  p_created_at timestamptz,
  p_seller2_id uuid default null,
  p_bundle_discount numeric default 0,
  p_manual_discount numeric default 0,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_sales_amount numeric(12,2);
  v_bundle_discount numeric(12,2);
  v_discount_amount numeric(12,2);
  v_manual_discount numeric(12,2);
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
  v_bundle_discount := least(v_sales_amount, greatest(0, coalesce(p_bundle_discount, 0)));
  v_discount_amount := public.calculate_order_discount(
    greatest(0, v_sales_amount - v_bundle_discount), p_discount_id
  );
  v_manual_discount := least(
    greatest(0, v_sales_amount - v_bundle_discount - v_discount_amount),
    greatest(0, coalesce(p_manual_discount, 0))
  );
  v_receivable_amount := greatest(
    0, v_sales_amount - v_bundle_discount - v_discount_amount - v_manual_discount
  );

  update public.orders
    set seller_id = p_seller_id,
        seller2_id = p_seller2_id,
        discount_id = p_discount_id,
        payment_method = p_payment_method,
        sales_amount = v_sales_amount,
        bundle_discount_amount = v_bundle_discount,
        discount_amount = v_discount_amount,
        manual_discount_amount = v_manual_discount,
        receivable_amount = v_receivable_amount,
        received_amount = v_receivable_amount,
        note = nullif(trim(coalesce(p_note, '')), ''),
        created_at = coalesce(p_created_at, created_at),
        edited_by = p_edited_by,
        edited_at = now()
    where id = p_order_id;

  return p_order_id;
end;
$$;

grant execute on function public.create_pos_order(uuid, uuid, uuid, uuid, text, jsonb, uuid, numeric, numeric, text, timestamptz) to authenticated, service_role;
grant execute on function public.update_pos_order(uuid, uuid, uuid, text, jsonb, uuid, timestamptz, uuid, numeric, numeric, text) to authenticated, service_role;
