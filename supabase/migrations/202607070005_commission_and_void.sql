-- 1) 可設定的抽成級距(後台可調);2) 訂單作廢:不可直接改單,只能作廢重開。
--    作廢保留原單與作廢者/時間/原因,並自動回補庫存;報表只計 completed 訂單。

create table public.commission_tiers (
  id uuid primary key default gen_random_uuid(),
  min_daily_sales numeric(12,2) not null unique check (min_daily_sales >= 0),
  rate numeric(6,4) not null check (rate > 0 and rate < 1)
);

alter table public.commission_tiers enable row level security;

create policy "commission tiers readable by authenticated users" on public.commission_tiers
  for select using (auth.role() = 'authenticated');

create policy "managers manage commission tiers" on public.commission_tiers
  for all using (public.is_manager()) with check (public.is_manager());

grant select on table public.commission_tiers to authenticated, service_role;
grant insert, update, delete on table public.commission_tiers to service_role;

insert into public.commission_tiers (min_daily_sales, rate) values
  (3000, 0.01),
  (5001, 0.02);

alter table public.orders
  add column voided_by uuid references public.profiles(id),
  add column voided_at timestamptz,
  add column void_reason text;

alter table public.inventory_movements
  add column order_id uuid references public.orders(id);

create or replace function public.void_pos_order(
  p_order_id uuid,
  p_voided_by uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_movement record;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception '作廢需要填寫原因';
  end if;

  select * into v_order from public.orders where id = p_order_id;

  if not found then
    raise exception '找不到訂單';
  end if;

  if v_order.status <> 'completed' then
    raise exception '訂單已作廢,不可重複作廢';
  end if;

  update public.orders
    set status = 'voided',
        voided_by = p_voided_by,
        voided_at = now(),
        void_reason = trim(p_reason)
    where id = p_order_id;

  for v_movement in
    select * from public.inventory_movements
      where order_id = p_order_id
        and movement_type = 'sale'
  loop
    insert into public.inventory_movements (
      counter_id, product_id, flavor_id, movement_type, quantity, created_by, note, order_id
    ) values (
      v_movement.counter_id,
      v_movement.product_id,
      v_movement.flavor_id,
      'adjustment',
      -v_movement.quantity,
      p_voided_by,
      '訂單作廢回補 ' || v_order.order_no || '：' || trim(p_reason),
      p_order_id
    );
  end loop;

  return p_order_id;
end;
$$;

grant execute on function public.void_pos_order(uuid, uuid, text) to authenticated, service_role;

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
  v_sales_amount numeric(12,2) := 0;
  v_discount_amount numeric(12,2) := 0;
  v_receivable_amount numeric(12,2) := 0;
  v_discount record;
  v_item jsonb;
  v_product record;
  v_order_item_id uuid;
  v_quantity integer;
  v_gift_count integer;
  v_line_total numeric(12,2);
  v_gift jsonb;
  v_stock integer;
  v_flavor_id uuid;
  v_gift_quantity integer;
  v_cracker record;
begin
  if auth.role() = 'authenticated' and p_cashier_id <> auth.uid() and not public.is_manager() then
    raise exception '不可用其他人員身份建立訂單';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '訂單至少需要一個商品';
  end if;

  if p_payment_method not in ('cash', 'credit_card', 'line_pay', 'jkopay') then
    raise exception '不支援的付款方式';
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
  end loop;

  if p_discount_id is not null then
    select * into v_discount
      from public.discounts
      where id = p_discount_id
        and is_active = true;

    if found and (v_discount.min_order_amount is null or v_sales_amount >= v_discount.min_order_amount) then
      if v_discount.discount_type = 'percentage' then
        v_discount_amount := round(v_sales_amount * (1 - v_discount.value), 2);
      else
        v_discount_amount := least(v_sales_amount, v_discount.value);
      end if;
    end if;
  end if;

  v_receivable_amount := greatest(0, v_sales_amount - v_discount_amount);
  v_order_id := gen_random_uuid();
  v_order_no := 'POS-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(v_order_id::text, 1, 6));

  insert into public.orders (
    id,
    order_no,
    counter_id,
    seller_id,
    cashier_id,
    discount_id,
    payment_method,
    sales_amount,
    discount_amount,
    receivable_amount,
    received_amount,
    status
  ) values (
    v_order_id,
    v_order_no,
    p_counter_id,
    p_seller_id,
    p_cashier_id,
    p_discount_id,
    p_payment_method,
    v_sales_amount,
    v_discount_amount,
    v_receivable_amount,
    v_receivable_amount,
    'completed'
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item ->> 'quantity')::integer;

    select products.*, gift_box_rules.selection_mode, gift_box_rules.required_flavor_count,
           gift_box_rules.includes_scallion_cracker
      into v_product
      from public.products
      left join public.gift_box_rules on gift_box_rules.product_id = products.id
      where products.id = (v_item ->> 'productId')::uuid;

    v_line_total := v_product.price * v_quantity;

    insert into public.order_items (
      order_id,
      product_id,
      product_name,
      spec,
      unit_price,
      quantity,
      line_total
    ) values (
      v_order_id,
      v_product.id,
      v_product.name,
      v_product.spec,
      v_product.price,
      v_quantity,
      v_line_total
    ) returning id into v_order_item_id;

    if v_product.category = 'bag' then
      v_stock := public.current_stock(p_counter_id, v_product.id, null);

      if v_stock < v_quantity then
        raise exception '% 庫存不足（剩 %）', v_product.name, v_stock;
      end if;

      insert into public.inventory_movements (
        counter_id, product_id, movement_type, quantity, created_by, note, order_id
      ) values (
        p_counter_id, v_product.id, 'sale', -v_quantity, p_cashier_id, 'POS 訂單 ' || v_order_no, v_order_id
      );
    end if;

    for v_gift in select * from jsonb_array_elements(coalesce(v_item -> 'giftFlavors', '[]'::jsonb))
    loop
      insert into public.order_item_gift_flavors (
        order_item_id,
        flavor_id,
        flavor_name,
        spec,
        quantity
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

        if v_stock < v_gift_quantity then
          raise exception '% 庫存不足（剩 %）', v_gift ->> 'flavorName', v_stock;
        end if;

        insert into public.inventory_movements (
          counter_id, flavor_id, movement_type, quantity, created_by, note, order_id
        ) values (
          p_counter_id, v_flavor_id, 'sale', -v_gift_quantity, p_cashier_id,
          'POS 訂單 ' || v_order_no || '（' || v_product.name || '）', v_order_id
        );
      end if;
    end loop;

    if v_product.category = 'gift_box' and coalesce(v_product.includes_scallion_cracker, false) then
      insert into public.order_item_gift_flavors (
        order_item_id,
        flavor_id,
        flavor_name,
        spec,
        quantity
      ) values (
        v_order_item_id,
        null,
        '經典原味蔥軋餅',
        '9入/袋',
        1
      );

      select id, name into v_cracker
        from public.products
        where name = '經典原味蔥軋餅'
          and is_active = true
        limit 1;

      if found then
        v_stock := public.current_stock(p_counter_id, v_cracker.id, null);

        if v_stock < v_quantity then
          raise exception '% 庫存不足（剩 %）', v_cracker.name, v_stock;
        end if;

        insert into public.inventory_movements (
          counter_id, product_id, movement_type, quantity, created_by, note, order_id
        ) values (
          p_counter_id, v_cracker.id, 'sale', -v_quantity, p_cashier_id,
          'POS 訂單 ' || v_order_no || '（' || v_product.name || ' 附贈）', v_order_id
        );
      end if;
    end if;
  end loop;

  return v_order_id;
end;
$$;
