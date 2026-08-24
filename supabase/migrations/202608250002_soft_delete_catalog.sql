-- 商品/口味/組合價改為軟刪除,讓「刪除」與「停用」成為兩個並存的狀態。
--
-- 關鍵:刪除時應用層會同時寫 deleted_at 與 is_active = false。
-- 因為 POS 端每一處查詢本來就有 is_active 過濾(訂單 RPC、/api/catalog、組合價計算),
-- 已刪除項目會自動從 POS 消失,這些查詢一行都不用改。
--
-- 表都只有數十列,不加索引。RLS policy 也不動,理由同上。
alter table public.products add column if not exists deleted_at timestamptz;
alter table public.flavors  add column if not exists deleted_at timestamptz;
alter table public.bundles  add column if not exists deleted_at timestamptz;
