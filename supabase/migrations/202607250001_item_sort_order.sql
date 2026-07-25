-- 自訂品項排序:庫存摘要可拖曳調整順序,存於 products / flavors 的 sort_order,
-- 全店共用;POS 商品格與庫存品項清單同步套用(未設定者排後面、依名稱)。

alter table public.products add column sort_order integer;
alter table public.flavors add column sort_order integer;
