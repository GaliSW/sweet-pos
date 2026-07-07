-- 大禮盒等含蔥軋餅的自選禮盒:前端只送使用者選的口味,
-- 蔥軋餅由本函式依 gift_box_rules 自動補進 order_item_gift_flavors。
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
    end if;

    insert into public.inventory_movements (
      counter_id,
      product_id,
      movement_type,
      quantity,
      created_by,
      note
    ) values (
      p_counter_id,
      v_product.id,
      'sale',
      -v_quantity,
      p_cashier_id,
      'POS 訂單 ' || v_order_no
    );
  end loop;

  return v_order_id;
end;
$$;
