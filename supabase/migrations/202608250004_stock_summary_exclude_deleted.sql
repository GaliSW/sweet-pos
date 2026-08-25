-- 庫存摘要排除已軟刪除的商品與口味。
--
-- 摘要是從 inventory_movements 推導的,不看商品/口味目前的狀態,
-- 因此被軟刪除、但有歷史異動的品項會繼續出現在庫存頁(通常庫存 0),造成困惑。
-- 這裡在最後的組裝查詢加上過濾。
--
-- 取捨:已刪除品項若還有實體殘留庫存,從此不會顯示。刪除即代表不再追蹤它的庫存。

create or replace function public.inventory_stock_summary(p_counter_id uuid default null)
returns table (
  counter_id uuid,
  counter_name text,
  product_id uuid,
  flavor_id uuid,
  item_name text,
  item_spec text,
  item_sort_order integer,
  stock integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with last_counts as (
    select distinct on (im.counter_id, im.product_id, im.flavor_id)
      im.counter_id,
      im.product_id,
      im.flavor_id,
      im.counted_quantity,
      im.created_at
    from public.inventory_movements im
    where im.counted_quantity is not null
      and (p_counter_id is null or im.counter_id = p_counter_id)
    order by im.counter_id, im.product_id, im.flavor_id, im.created_at desc
  ),
  stock_totals as (
    select
      im.counter_id,
      im.product_id,
      im.flavor_id,
      (
        coalesce(lc.counted_quantity, 0)
        + coalesce(
          sum(im.quantity) filter (
            where lc.created_at is null or im.created_at > lc.created_at
          ),
          0
        )
      )::integer as stock
    from public.inventory_movements im
    left join last_counts lc
      on lc.counter_id = im.counter_id
      and lc.product_id is not distinct from im.product_id
      and lc.flavor_id is not distinct from im.flavor_id
    where p_counter_id is null or im.counter_id = p_counter_id
    group by
      im.counter_id,
      im.product_id,
      im.flavor_id,
      lc.counted_quantity,
      lc.created_at
  )
  select
    st.counter_id,
    c.name as counter_name,
    st.product_id,
    st.flavor_id,
    coalesce(f.name, p.name) as item_name,
    coalesce(f.spec, p.spec) as item_spec,
    coalesce(f.sort_order, p.sort_order) as item_sort_order,
    st.stock
  from stock_totals st
  join public.counters c on c.id = st.counter_id
  left join public.products p on p.id = st.product_id
  left join public.flavors f on f.id = st.flavor_id
  -- 排除已軟刪除的商品與口味。left join 未命中時 deleted_at 同樣是 null,
  -- 所以這個條件對「商品列」與「口味列」都成立,不會誤殺對方那一半。
  where p.deleted_at is null
    and f.deleted_at is null
  order by
    c.name,
    coalesce(f.sort_order, p.sort_order) nulls last,
    coalesce(f.name, p.name);
$$;

revoke execute on function public.inventory_stock_summary(uuid) from public, anon, authenticated;
grant execute on function public.inventory_stock_summary(uuid) to service_role;
