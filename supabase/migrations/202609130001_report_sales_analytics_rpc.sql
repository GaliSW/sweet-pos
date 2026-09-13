-- 商品銷售彙總改由資料庫計算。
--
-- 原本的做法是把區間內所有 order_items 撈回 Node 再彙總,但 PostgREST 的
-- max_rows = 1000 會靜默截斷:七月到九月中的區間有 1,653 筆品項,只回得到 1,000 筆,
-- 商品銷售表因此少算約四成,而且不會報錯。
--
-- 彙總後的列數只跟「商品種類數」有關(數十列),不隨訂單量成長,從此不會再撞到上限。
-- 回傳 jsonb 一次帶回四組結果,省下多次往返。
-- 營收佔比與排序後的四捨五入仍交給 Node(沿用既有的 roundCurrency),避免兩邊算法分歧。
create or replace function public.report_sales_analytics(
  p_from date,
  p_to date,
  p_counter_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped_orders as (
    select o.id
    from public.orders o
    where o.status = 'completed'
      -- 與 Node 端的 taipeiDayStart(from) / taipeiDayStart(nextDay(to)) 完全一致
      and o.created_at >= (p_from::timestamp at time zone 'Asia/Taipei')
      and o.created_at <  ((p_to + 1)::timestamp at time zone 'Asia/Taipei')
      and (p_counter_id is null or o.counter_id = p_counter_id)
  ),
  items as (
    select
      oi.id,
      oi.product_name,
      oi.spec,
      oi.quantity,
      oi.line_total,
      -- 商品可能已被刪除;沿用 Node 端 relationCategory 找不到時退回 'bag' 的行為
      coalesce(p.category, 'bag') as category
    from public.order_items oi
    join scoped_orders so on so.id = oi.order_id
    left join public.products p on p.id = oi.product_id
  ),
  product_rows as (
    select
      i.product_name,
      i.spec,
      -- 同一個 名稱|規格 理論上只對應一種類型;真的分歧時取字典序最小者(確保結果穩定)
      min(i.category) as category,
      sum(i.quantity)::integer as quantity,
      round(sum(i.line_total), 2) as revenue
    from items i
    group by i.product_name, i.spec
  ),
  category_rows as (
    select
      i.category,
      sum(i.quantity)::integer as quantity,
      round(sum(i.line_total), 2) as revenue
    from items i
    group by i.category
  ),
  flavor_rows as (
    select
      g.flavor_name,
      g.spec,
      -- 禮盒內的口味數量要乘上該筆品項的盒數
      sum(g.quantity * i.quantity)::integer as quantity
    from public.order_item_gift_flavors g
    join items i on i.id = g.order_item_id
    group by g.flavor_name, g.spec
  ),
  preorder_rows as (
    select
      pi.item_name,
      pi.spec,
      sum(pi.quantity)::integer as quantity,
      count(distinct pi.order_id)::integer as order_count
    from public.order_preorder_items pi
    join scoped_orders so on so.id = pi.order_id
    group by pi.item_name, pi.spec
  )
  select jsonb_build_object(
    'totalRevenue', coalesce((select round(sum(i.line_total), 2) from items i), 0),
    'productSales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productName', r.product_name,
        'spec', r.spec,
        'category', r.category,
        'quantity', r.quantity,
        'revenue', r.revenue
      ) order by r.revenue desc, r.product_name)
      from product_rows r
    ), '[]'::jsonb),
    'categorySales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', r.category,
        'quantity', r.quantity,
        'revenue', r.revenue
      ) order by r.revenue desc, r.category)
      from category_rows r
    ), '[]'::jsonb),
    'flavorSales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'flavorName', r.flavor_name,
        'spec', r.spec,
        'quantity', r.quantity
      ) order by r.quantity desc, r.flavor_name)
      from flavor_rows r
    ), '[]'::jsonb),
    'preorders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemName', r.item_name,
        'spec', r.spec,
        'quantity', r.quantity,
        'orderCount', r.order_count
      ) order by r.quantity desc, r.item_name)
      from preorder_rows r
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.report_sales_analytics(date, date, uuid)
  from public, anon, authenticated;
grant execute on function public.report_sales_analytics(date, date, uuid) to service_role;
