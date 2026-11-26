-- 庫存異動類型改由資料表設定,店長可在後台新增 / 停用自訂類型。
--
-- direction 決定數量正負:increase 加庫存、decrease 扣庫存、count 盤點(帶實際數重設基準)。
-- is_system = true 的類型由程式邏輯直接引用(盤點、進貨批次、銷售、預購取貨),後台不可改,
-- 只能調整排序。試吃 / 報廢 / 轉調改為一般類型,可改名、停用、調整備註與覆核設定。
-- 庫存推估 RPC 只加總 quantity,不看類型,不需修改。

create table if not exists public.inventory_movement_types (
  code text primary key,
  name text not null check (length(trim(name)) > 0),
  direction text not null check (direction in ('increase', 'decrease', 'count')),
  note_required boolean not null default false,
  needs_review boolean not null default false,
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.inventory_movement_types
  (code, name, direction, note_required, needs_review, is_system, sort_order) values
  ('opening_count', '開班盤點', 'count', false, false, true, 10),
  ('handover_count', '交班盤點', 'count', false, false, true, 20),
  ('closing_count', '下班盤點', 'count', false, false, true, 30),
  ('purchase', '進貨', 'increase', false, false, true, 40),
  ('sampling', '試吃', 'decrease', true, true, false, 50),
  ('waste', '報廢', 'decrease', true, true, false, 60),
  ('adjustment', '轉調', 'decrease', true, true, false, 70),
  ('preorder_pickup', '預購取貨', 'decrease', false, false, true, 80),
  ('sale', '銷售', 'decrease', false, false, true, 900)
on conflict (code) do nothing;

-- 寫死的類型白名單與「試吃/報廢/轉調必填備註」改由類型表 + API 驗證
alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
  drop constraint if exists inventory_movements_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_fkey
  foreign key (movement_type) references public.inventory_movement_types(code);

alter table public.inventory_movement_types enable row level security;

create policy "inventory movement types readable" on public.inventory_movement_types
  for select using (auth.role() = 'authenticated');

create policy "managers manage inventory movement types" on public.inventory_movement_types
  for all using (public.is_manager()) with check (public.is_manager());

grant select on public.inventory_movement_types to authenticated;
grant all on public.inventory_movement_types to service_role;
