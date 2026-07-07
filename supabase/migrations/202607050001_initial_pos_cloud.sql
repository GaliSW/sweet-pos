create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id),
  display_name text not null,
  role text not null check (role in ('staff', 'manager')),
  hourly_wage numeric(10,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.counters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.counter_monthly_targets (
  id uuid primary key default gen_random_uuid(),
  counter_id uuid not null references public.counters(id),
  month date not null,
  target_amount numeric(12,2) not null,
  unique (counter_id, month)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('bag', 'gift_box')),
  name text not null,
  spec text not null,
  price numeric(10,2) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.gift_box_rules (
  product_id uuid primary key references public.products(id) on delete cascade,
  selection_mode text not null check (selection_mode in ('select', 'fixed')),
  required_flavor_count integer not null default 0,
  includes_scallion_cracker boolean not null default false
);

create table public.flavors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  spec text not null default '6入/袋',
  is_active boolean not null default true
);

create table public.gift_box_fixed_flavors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  flavor_id uuid not null references public.flavors(id),
  quantity integer not null default 1,
  unique (product_id, flavor_id)
);

create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  discount_type text not null check (discount_type in ('percentage', 'fixed_amount')),
  value numeric(10,2) not null,
  min_order_amount numeric(10,2),
  is_active boolean not null default true
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  counter_id uuid not null references public.counters(id),
  seller_id uuid not null references public.profiles(id),
  cashier_id uuid not null references public.profiles(id),
  discount_id uuid references public.discounts(id),
  payment_method text not null check (payment_method in ('cash', 'credit_card', 'line_pay', 'jkopay')),
  sales_amount numeric(12,2) not null,
  discount_amount numeric(12,2) not null default 0,
  receivable_amount numeric(12,2) not null,
  received_amount numeric(12,2) not null,
  status text not null check (status in ('completed', 'voided')),
  created_at timestamptz not null default now(),
  check (received_amount = receivable_amount)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  spec text not null,
  unit_price numeric(10,2) not null,
  quantity integer not null check (quantity > 0),
  line_total numeric(12,2) not null
);

create table public.order_item_gift_flavors (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  flavor_id uuid references public.flavors(id),
  flavor_name text not null,
  spec text not null,
  quantity integer not null default 1
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  counter_id uuid not null references public.counters(id),
  staff_id uuid not null references public.profiles(id),
  shift_date date not null,
  shift_code text not null check (shift_code in ('morning', 'evening')),
  starts_at time not null,
  ends_at time not null,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (counter_id, shift_date, shift_code)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  counter_id uuid not null references public.counters(id),
  product_id uuid not null references public.products(id),
  movement_type text not null check (
    movement_type in ('opening_count', 'closing_count', 'purchase', 'sampling', 'waste', 'adjustment', 'sale')
  ),
  quantity integer not null,
  counted_quantity integer,
  note text,
  created_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (movement_type not in ('sampling', 'waste', 'adjustment') or nullif(trim(note), '') is not null)
);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'manager', false)
$$;

alter table public.profiles enable row level security;
alter table public.counters enable row level security;
alter table public.counter_monthly_targets enable row level security;
alter table public.products enable row level security;
alter table public.gift_box_rules enable row level security;
alter table public.flavors enable row level security;
alter table public.gift_box_fixed_flavors enable row level security;
alter table public.discounts enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_gift_flavors enable row level security;
alter table public.shifts enable row level security;
alter table public.inventory_movements enable row level security;

create policy "profiles read own or manager" on public.profiles
  for select using (id = auth.uid() or public.is_manager());

create policy "managers manage profiles" on public.profiles
  for all using (public.is_manager()) with check (public.is_manager());

create policy "active catalog readable by authenticated users" on public.products
  for select using (auth.role() = 'authenticated' and is_active);

create policy "active flavors readable by authenticated users" on public.flavors
  for select using (auth.role() = 'authenticated' and is_active);

create policy "active discounts readable by authenticated users" on public.discounts
  for select using (auth.role() = 'authenticated' and is_active);

create policy "gift rules readable by authenticated users" on public.gift_box_rules
  for select using (auth.role() = 'authenticated');

create policy "fixed flavors readable by authenticated users" on public.gift_box_fixed_flavors
  for select using (auth.role() = 'authenticated');

create policy "counters readable by authenticated users" on public.counters
  for select using (auth.role() = 'authenticated' and is_active);

create policy "managers manage catalog" on public.products
  for all using (public.is_manager()) with check (public.is_manager());

create policy "managers manage flavors" on public.flavors
  for all using (public.is_manager()) with check (public.is_manager());

create policy "managers manage discounts" on public.discounts
  for all using (public.is_manager()) with check (public.is_manager());

create policy "managers manage counters" on public.counters
  for all using (public.is_manager()) with check (public.is_manager());

create policy "managers manage monthly targets" on public.counter_monthly_targets
  for all using (public.is_manager()) with check (public.is_manager());

create policy "staff read own published shifts" on public.shifts
  for select using (staff_id = auth.uid() and published);

create policy "managers manage shifts" on public.shifts
  for all using (public.is_manager()) with check (public.is_manager());

create policy "staff create orders" on public.orders
  for insert with check (cashier_id = auth.uid());

create policy "staff read own orders and managers read all" on public.orders
  for select using (cashier_id = auth.uid() or seller_id = auth.uid() or public.is_manager());

create policy "order items follow readable orders" on public.order_items
  for select using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and (orders.cashier_id = auth.uid() or orders.seller_id = auth.uid() or public.is_manager())
    )
  );

create policy "gift flavor items follow readable orders" on public.order_item_gift_flavors
  for select using (
    exists (
      select 1
      from public.order_items
      join public.orders on orders.id = order_items.order_id
      where order_items.id = order_item_gift_flavors.order_item_id
        and (orders.cashier_id = auth.uid() or orders.seller_id = auth.uid() or public.is_manager())
    )
  );

create policy "staff create inventory movements" on public.inventory_movements
  for insert with check (created_by = auth.uid());

create policy "staff read own inventory and managers read all" on public.inventory_movements
  for select using (created_by = auth.uid() or public.is_manager());

create policy "managers review inventory" on public.inventory_movements
  for update using (public.is_manager()) with check (public.is_manager());

insert into public.products (id, category, name, spec, price) values
  ('00000000-0000-4000-8000-000000000101', 'bag', '包種烏龍牛軋糖', '10入/袋', 280),
  ('00000000-0000-4000-8000-000000000102', 'bag', '蔓越莓牛軋糖', '10入/袋', 280),
  ('00000000-0000-4000-8000-000000000103', 'bag', '經典原味牛軋餅', '10入/袋', 320),
  ('00000000-0000-4000-8000-000000000104', 'bag', '經典原味蔥軋餅', '9入/袋', 320),
  ('00000000-0000-4000-8000-000000000201', 'gift_box', '小禮盒', '自選 3 袋', 880),
  ('00000000-0000-4000-8000-000000000202', 'gift_box', '大禮盒', '自選 8 袋 + 蔥餅', 1680),
  ('00000000-0000-4000-8000-000000000203', 'gift_box', '發禮盒', '固定 4 袋', 980),
  ('00000000-0000-4000-8000-000000000204', 'gift_box', '財禮盒', '固定 4 袋', 1180);

insert into public.gift_box_rules (product_id, selection_mode, required_flavor_count, includes_scallion_cracker) values
  ('00000000-0000-4000-8000-000000000201', 'select', 3, false),
  ('00000000-0000-4000-8000-000000000202', 'select', 8, true),
  ('00000000-0000-4000-8000-000000000203', 'fixed', 0, false),
  ('00000000-0000-4000-8000-000000000204', 'fixed', 0, false);

insert into public.flavors (id, name) values
  ('00000000-0000-4000-8000-000000000501', '包種烏龍'),
  ('00000000-0000-4000-8000-000000000502', '蔓越莓'),
  ('00000000-0000-4000-8000-000000000503', '草莓'),
  ('00000000-0000-4000-8000-000000000504', '芒果'),
  ('00000000-0000-4000-8000-000000000505', '經典原味'),
  ('00000000-0000-4000-8000-000000000506', '黑芝麻'),
  ('00000000-0000-4000-8000-000000000507', '咖啡'),
  ('00000000-0000-4000-8000-000000000508', '抹茶');

insert into public.gift_box_fixed_flavors (product_id, flavor_id, quantity) values
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000501', 1),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000502', 1),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000503', 1),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000504', 1),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000505', 1),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000506', 1),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000507', 1),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000508', 1);

insert into public.discounts (id, name, discount_type, value, min_order_amount) values
  ('00000000-0000-4000-8000-000000000301', '會員 9 折', 'percentage', 0.9, null),
  ('00000000-0000-4000-8000-000000000302', '滿千折百', 'fixed_amount', 100, 1000);

insert into public.counters (id, name, location) values
  ('00000000-0000-4000-8000-000000000401', '信義 A11', '台北市信義區'),
  ('00000000-0000-4000-8000-000000000402', '南西誠品', '台北市中山區');
