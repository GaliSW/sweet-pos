-- 固定口味禮盒(如發禮盒/財禮盒)視為獨立商品:售出扣「禮盒自身」庫存,
-- 不再扣口味庫存;只有自選口味禮盒(selection_mode = 'select')扣口味庫存。
-- 內容物(order_item_gift_flavors)仍照記供明細顯示。

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
  v_own_stock boolean;
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

    -- 袋裝與固定口味禮盒(或未設規則的禮盒)扣商品自身庫存
    v_own_stock := v_product.category = 'bag'
      or (v_product.category = 'gift_box' and coalesce(v_product.selection_mode, 'fixed') <> 'select');

    if v_own_stock then
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

      -- 只有自選禮盒扣口味庫存;固定禮盒的內容物僅作明細顯示
      if v_product.category = 'gift_box' and v_product.selection_mode = 'select' then
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
