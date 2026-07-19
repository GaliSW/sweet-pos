-- 1) 抽成模式:每位員工可設日結(daily,現況)或月結(monthly,月總實收套個人級距)。
-- 2) 禮盒自選口味可於後台設定:gift_box_allowed_flavors(未設定 = 全部口味可選)。
-- 3) 組合價(量販):指定商品群任選 N 件 $X(bundles / bundle_products / bundle_tiers),
--    POS 依最划算組合計價,組合折抵記在 orders.bundle_discount_amount,
--    訂單折扣(如 9 折)以組合後金額計算。
-- 4) 補櫃位連同紀錄刪除、口味刪除所需 grants。

alter table public.profiles
  add column commission_mode text not null default 'daily'
  check (commission_mode in ('daily', 'monthly'));

create table public.gift_box_allowed_flavors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  flavor_id uuid not null references public.flavors(id) on delete cascade,
  unique (product_id, flavor_id)
);

alter table public.gift_box_allowed_flavors enable row level security;

create policy "allowed flavors readable by authenticated users" on public.gift_box_allowed_flavors
  for select using (auth.role() = 'authenticated');

grant select on table public.gift_box_allowed_flavors to anon, authenticated, service_role;
grant insert, delete on table public.gift_box_allowed_flavors to service_role;

create table public.bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.bundle_products (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.bundles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  unique (bundle_id, product_id)
);

create table public.bundle_tiers (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.bundles(id) on delete cascade,
  quantity integer not null check (quantity >= 2),
  price numeric(12,2) not null check (price > 0),
  unique (bundle_id, quantity)
);

alter table public.bundles enable row level security;
alter table public.bundle_products enable row level security;
alter table public.bundle_tiers enable row level security;

create policy "bundles readable by authenticated users" on public.bundles
  for select using (auth.role() = 'authenticated');
create policy "bundle products readable by authenticated users" on public.bundle_products
  for select using (auth.role() = 'authenticated');
create policy "bundle tiers readable by authenticated users" on public.bundle_tiers
  for select using (auth.role() = 'authenticated');

grant select on table public.bundles, public.bundle_products, public.bundle_tiers
  to anon, authenticated, service_role;
grant insert, update, delete on table public.bundles, public.bundle_products, public.bundle_tiers
  to service_role;

alter table public.orders
  add column bundle_discount_amount numeric(12,2) not null default 0;

grant delete on table public.orders to service_role;
grant delete on table public.flavors to service_role;

-- RPC:加 p_bundle_discount(由後端 API 依組合價規則計算),
-- 訂單折扣改以「組合後金額」計算,實收 = 銷售 - 組合折抵 - 折扣。
drop function public.create_pos_order(uuid, uuid, uuid, uuid, text, jsonb, uuid);

create function public.create_pos_order(
  p_counter_id uuid,
  p_seller_id uuid,
  p_cashier_id uuid,
  p_discount_id uuid,
  p_payment_method text,
  p_items jsonb,
  p_seller2_id uuid default null,
  p_bundle_discount numeric default 0
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
  v_bundle_discount := least(v_sales_amount, greatest(0, coalesce(p_bundle_discount, 0)));
  v_discount_amount := public.calculate_order_discount(
    greatest(0, v_sales_amount - v_bundle_discount), p_discount_id
  );
  v_receivable_amount := greatest(0, v_sales_amount - v_bundle_discount - v_discount_amount);

  update public.orders
    set sales_amount = v_sales_amount,
        bundle_discount_amount = v_bundle_discount,
        discount_amount = v_discount_amount,
        receivable_amount = v_receivable_amount,
        received_amount = v_receivable_amount
    where id = v_order_id;

  return v_order_id;
end;
$$;

drop function public.update_pos_order(uuid, uuid, uuid, text, jsonb, uuid, timestamptz, uuid);

create function public.update_pos_order(
  p_order_id uuid,
  p_seller_id uuid,
  p_discount_id uuid,
  p_payment_method text,
  p_items jsonb,
  p_edited_by uuid,
  p_created_at timestamptz,
  p_seller2_id uuid default null,
  p_bundle_discount numeric default 0
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
  v_receivable_amount := greatest(0, v_sales_amount - v_bundle_discount - v_discount_amount);

  update public.orders
    set seller_id = p_seller_id,
        seller2_id = p_seller2_id,
        discount_id = p_discount_id,
        payment_method = p_payment_method,
        sales_amount = v_sales_amount,
        bundle_discount_amount = v_bundle_discount,
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

grant execute on function public.create_pos_order(uuid, uuid, uuid, uuid, text, jsonb, uuid, numeric) to authenticated, service_role;
grant execute on function public.update_pos_order(uuid, uuid, uuid, text, jsonb, uuid, timestamptz, uuid, numeric) to authenticated, service_role;
