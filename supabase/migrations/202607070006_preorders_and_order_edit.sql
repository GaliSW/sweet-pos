-- 1) 預購:庫存不足不再擋單,超出庫存的數量轉為預購(order_preorder_items),
--    現貨部分照常扣庫存(最多扣到 0)。預購不入庫存,報表可依區間統計。
-- 2) 店長改單:update_pos_order 直接修改訂單品項/折扣/付款/歸屬與日期,
--    與 create_pos_order 共用 write_pos_order_items 寫入邏輯,金額與庫存重算。
-- 3) 補櫃位刪除所需 grants。

create table public.order_preorder_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete cascade,
  counter_id uuid not null references public.counters(id),
  product_id uuid references public.products(id),
  flavor_id uuid references public.flavors(id),
  item_name text not null,
  spec text not null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  check (((product_id is not null)::int + (flavor_id is not null)::int) = 1)
);

alter table public.order_preorder_items enable row level security;

create policy "managers read preorders" on public.order_preorder_items
  for select using (public.is_manager());

grant select, insert, delete on table public.order_preorder_items to service_role;
grant delete on table public.counters, public.counter_monthly_targets to service_role;
grant delete on table public.order_items, public.order_item_gift_flavors to service_role;

alter table public.orders
  add column edited_by uuid references public.profiles(id),
  add column edited_at timestamptz;

create or replace function public.calculate_order_discount(
  p_sales_amount numeric,
  p_discount_id uuid
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_discount record;
begin
  if p_discount_id is null then
    return 0;
  end if;

  select * into v_discount
    from public.discounts
    where id = p_discount_id
      and is_active = true;

  if not found then
    return 0;
  end if;

  if v_discount.min_order_amount is not null and p_sales_amount < v_discount.min_order_amount then
    return 0;
  end if;

  if v_discount.discount_type = 'percentage' then
    return round(p_sales_amount * (1 - v_discount.value), 2);
  end if;

  return least(p_sales_amount, v_discount.value);
end;
$$;

-- 寫入訂單品項:驗證、order_items / 口味明細、庫存扣減(含預購拆分)。回傳原價小計。
create or replace function public.write_pos_order_items(
  p_order_id uuid,
  p_order_no text,
  p_counter_id uuid,
  p_actor_id uuid,
  p_items jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sales_amount numeric(12,2) := 0;
  v_item jsonb;
  v_product record;
  v_quantity integer;
  v_gift_count integer;
  v_order_item_id uuid;
  v_gift jsonb;
  v_flavor_id uuid;
  v_gift_quantity integer;
  v_stock integer;
  v_sale_qty integer;
  v_preorder_qty integer;
  v_cracker record;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '訂單至少需要一個商品';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := coalesce((v_item ->> 'quantity')::integer, 0);

    if v_quantity <= 0 then
      raise exception '商品數量必須大於 0';
    end if;

    select products.*, gift_box_rules.selection_mode, gift_box_rules.required_flavor_count,
           gift_box_rules.includes_scallion_cracker
      into v_product
      from public.products
      left join public.gift_box_rules on gift_box_rules.product_id = products.id
      where products.id = (v_item ->> 'productId')::uuid
        and products.is_active = true;

    if not found then
      raise exception '找不到商品 %', v_item ->> 'productId';
    end if;

    if v_product.category = 'gift_box' and v_product.selection_mode = 'select' then
      select coalesce(sum((gift ->> 'quantity')::integer), 0)
        into v_gift_count
        from jsonb_array_elements(coalesce(v_item -> 'giftFlavors', '[]'::jsonb)) gift;

      if v_gift_count <> v_product.required_flavor_count then
        raise exception '% 需要選擇 % 個口味', v_product.name, v_product.required_flavor_count;
      end if;
    end if;

    v_sales_amount := v_sales_amount + (v_product.price * v_quantity);

    insert into public.order_items (
      order_id, product_id, product_name, spec, unit_price, quantity, line_total
    ) values (
      p_order_id, v_product.id, v_product.name, v_product.spec, v_product.price,
      v_quantity, v_product.price * v_quantity
    ) returning id into v_order_item_id;

    if v_product.category = 'bag' then
      v_stock := public.current_stock(p_counter_id, v_product.id, null);
      v_sale_qty := least(v_quantity, greatest(v_stock, 0));
      v_preorder_qty := v_quantity - v_sale_qty;

      if v_sale_qty > 0 then
        insert into public.inventory_movements (
          counter_id, product_id, movement_type, quantity, created_by, note, order_id
        ) values (
          p_counter_id, v_product.id, 'sale', -v_sale_qty, p_actor_id,
          'POS 訂單 ' || p_order_no, p_order_id
        );
      end if;

      if v_preorder_qty > 0 then
        insert into public.order_preorder_items (
          order_id, order_item_id, counter_id, product_id, item_name, spec, quantity
        ) values (
          p_order_id, v_order_item_id, p_counter_id, v_product.id,
          v_product.name, v_product.spec, v_preorder_qty
        );
      end if;
    end if;

    for v_gift in select * from jsonb_array_elements(coalesce(v_item -> 'giftFlavors', '[]'::jsonb))
    loop
      insert into public.order_item_gift_flavors (
        order_item_id, flavor_id, flavor_name, spec, quantity
      ) values (
        v_order_item_id,
        nullif(v_gift ->> 'flavorId', '')::uuid,
        v_gift ->> 'flavorName',
        coalesce(v_gift ->> 'spec', '6入/袋'),
        coalesce((v_gift ->> 'quantity')::integer, 1)
      );

      if v_product.category = 'gift_box' then
        v_flavor_id := nullif(v_gift ->> 'flavorId', '')::uuid;

        if v_flavor_id is null then
          select id into v_flavor_id
            from public.flavors
            where name = v_gift ->> 'flavorName'
            limit 1;
        end if;

        if v_flavor_id is null then
          raise exception '找不到口味「%」，請重新整理頁面後再試', v_gift ->> 'flavorName';
        end if;

        v_gift_quantity := coalesce((v_gift ->> 'quantity')::integer, 1) * v_quantity;
        v_stock := public.current_stock(p_counter_id, null, v_flavor_id);
        v_sale_qty := least(v_gift_quantity, greatest(v_stock, 0));
        v_preorder_qty := v_gift_quantity - v_sale_qty;

        if v_sale_qty > 0 then
          insert into public.inventory_movements (
            counter_id, flavor_id, movement_type, quantity, created_by, note, order_id
          ) values (
            p_counter_id, v_flavor_id, 'sale', -v_sale_qty, p_actor_id,
            'POS 訂單 ' || p_order_no || '（' || v_product.name || '）', p_order_id
          );
        end if;

        if v_preorder_qty > 0 then
          insert into public.order_preorder_items (
            order_id, order_item_id, counter_id, flavor_id, item_name, spec, quantity
          ) values (
            p_order_id, v_order_item_id, p_counter_id, v_flavor_id,
            v_gift ->> 'flavorName', coalesce(v_gift ->> 'spec', '6入/袋'), v_preorder_qty
          );
        end if;
      end if;
    end loop;

    if v_product.category = 'gift_box' and coalesce(v_product.includes_scallion_cracker, false) then
      insert into public.order_item_gift_flavors (
        order_item_id, flavor_id, flavor_name, spec, quantity
      ) values (
        v_order_item_id, null, '經典原味蔥軋餅', '9入/袋', 1
      );

      select id, name into v_cracker
        from public.products
        where name = '經典原味蔥軋餅'
          and is_active = true
        limit 1;

      if found then
        v_stock := public.current_stock(p_counter_id, v_cracker.id, null);
        v_sale_qty := least(v_quantity, greatest(v_stock, 0));
        v_preorder_qty := v_quantity - v_sale_qty;

        if v_sale_qty > 0 then
          insert into public.inventory_movements (
            counter_id, product_id, movement_type, quantity, created_by, note, order_id
          ) values (
            p_counter_id, v_cracker.id, 'sale', -v_sale_qty, p_actor_id,
            'POS 訂單 ' || p_order_no || '（' || v_product.name || ' 附贈）', p_order_id
          );
        end if;

        if v_preorder_qty > 0 then
          insert into public.order_preorder_items (
            order_id, order_item_id, counter_id, product_id, item_name, spec, quantity
          ) values (
            p_order_id, v_order_item_id, p_counter_id, v_cracker.id,
            v_cracker.name, '9入/袋', v_preorder_qty
          );
        end if;
      end if;
    end if;
  end loop;

  return v_sales_amount;
end;
$$;

create or replace function public.create_pos_order(
  p_counter_id uuid,
  p_seller_id uuid,
  p_cashier_id uuid,
  p_discount_id uuid,
  p_payment_method text,
  p_items jsonb
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

  if p_payment_method not in ('cash', 'credit_card', 'line_pay', 'jkopay') then
    raise exception '不支援的付款方式';
  end if;

  v_order_id := gen_random_uuid();
  v_order_no := 'POS-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(v_order_id::text, 1, 6));

  insert into public.orders (
    id, order_no, counter_id, seller_id, cashier_id, discount_id, payment_method,
    sales_amount, discount_amount, receivable_amount, received_amount, status
  ) values (
    v_order_id, v_order_no, p_counter_id, p_seller_id, p_cashier_id, p_discount_id,
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

-- 店長直接修改訂單:重寫品項、重算金額與庫存(原銷售異動刪除重建),
-- 可修正業績歸屬與訂單日期。已作廢訂單不可修改。
create or replace function public.update_pos_order(
  p_order_id uuid,
  p_seller_id uuid,
  p_discount_id uuid,
  p_payment_method text,
  p_items jsonb,
  p_edited_by uuid,
  p_created_at timestamptz
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

  if p_payment_method not in ('cash', 'credit_card', 'line_pay', 'jkopay') then
    raise exception '不支援的付款方式';
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

grant execute on function public.calculate_order_discount(numeric, uuid) to authenticated, service_role;
grant execute on function public.write_pos_order_items(uuid, text, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_pos_order(uuid, uuid, uuid, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.update_pos_order(uuid, uuid, uuid, text, jsonb, uuid, timestamptz) to authenticated, service_role;
