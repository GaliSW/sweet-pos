create table if not exists public.payment_methods (
  code text primary key,
  name text not null check (length(trim(name)) > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.payment_methods (code, name, is_active, sort_order) values
  ('cash', '現金', true, 10),
  ('credit_card', '信用卡', true, 20),
  ('mobile_payment', '行動支付', true, 30),
  ('easycard', '悠遊卡', true, 40),
  ('transfer', '轉帳', true, 50),
  ('line_pay', '行動支付', false, 900),
  ('jkopay', '行動支付', false, 910)
on conflict (code) do nothing;

alter table public.orders drop constraint if exists orders_payment_method_check;

update public.orders
set payment_method = 'mobile_payment'
where payment_method in ('line_pay', 'jkopay');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_payment_method_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_payment_method_fkey
      foreign key (payment_method) references public.payment_methods(code);
  end if;
end
$$;

alter table public.payment_methods enable row level security;

drop policy if exists "payment methods readable" on public.payment_methods;
create policy "payment methods readable" on public.payment_methods
  for select using (is_active or public.is_manager());

drop policy if exists "managers manage payment methods" on public.payment_methods;
create policy "managers manage payment methods" on public.payment_methods
  for all using (public.is_manager()) with check (public.is_manager());

grant select on public.payment_methods to authenticated;
grant all on public.payment_methods to service_role;

create or replace function public.create_pos_order(
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
    raise exception '不可替其他員工建立訂單';
  end if;

  if not exists (
    select 1 from public.payment_methods
    where code = p_payment_method and is_active
  ) then
    raise exception '付款方式不存在或已停用';
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

create or replace function public.update_pos_order(
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
    raise exception '已作廢訂單不可修改';
  end if;

  if not exists (
    select 1 from public.payment_methods
    where code = p_payment_method and is_active
  ) then
    raise exception '付款方式不存在或已停用';
  end if;

  if p_seller2_id is not null and p_seller2_id = p_seller_id then
    p_seller2_id := null;
  end if;

  delete from public.inventory_movements
    where order_id = p_order_id and movement_type = 'sale';
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
