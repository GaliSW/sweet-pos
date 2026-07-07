insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new,
  email_change_token_current,
  phone_change,
  phone_change_token,
  reauthentication_token
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'staff-a@example.local',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"林小芸"}'::jsonb,
    now(),
    now(),
    '', '', '', '', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'staff-b@example.local',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"陳柏宇"}'::jsonb,
    now(),
    now(),
    '', '', '', '', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'staff-c@example.local',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"黃品安"}'::jsonb,
    now(),
    now(),
    '', '', '', '', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'manager@example.local',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"店長"}'::jsonb,
    now(),
    now(),
    '', '', '', '', '', '', '', ''
  )
on conflict (id) do nothing;

insert into public.profiles (id, display_name, role, hourly_wage) values
  ('00000000-0000-4000-8000-000000000001', '林小芸', 'staff', 190),
  ('00000000-0000-4000-8000-000000000002', '陳柏宇', 'staff', 190),
  ('00000000-0000-4000-8000-000000000003', '黃品安', 'staff', 200),
  ('00000000-0000-4000-8000-000000000004', '店長', 'manager', 0)
on conflict (id) do update set
  display_name = excluded.display_name,
  role = excluded.role,
  hourly_wage = excluded.hourly_wage;

insert into public.counter_monthly_targets (counter_id, month, target_amount) values
  ('00000000-0000-4000-8000-000000000401', date '2026-07-01', 500000),
  ('00000000-0000-4000-8000-000000000402', date '2026-07-01', 420000)
on conflict (counter_id, month) do update set
  target_amount = excluded.target_amount;

insert into public.shifts (counter_id, staff_id, shift_date, shift_code, starts_at, ends_at, published) values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', current_date, 'morning', time '10:00', time '16:00', true),
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000002', current_date, 'evening', time '16:00', time '22:00', true)
on conflict (counter_id, shift_date, shift_code) do update set
  staff_id = excluded.staff_id,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  published = excluded.published;

insert into public.inventory_movements (counter_id, product_id, movement_type, quantity, counted_quantity, note, created_by)
select counters.id, products.id, 'opening_count', 0, 50, '期初庫存', '00000000-0000-4000-8000-000000000004'
from public.counters
cross join public.products
where products.category = 'bag';

insert into public.inventory_movements (counter_id, flavor_id, movement_type, quantity, counted_quantity, note, created_by)
select counters.id, flavors.id, 'opening_count', 0, 50, '期初庫存', '00000000-0000-4000-8000-000000000004'
from public.counters
cross join public.flavors;
