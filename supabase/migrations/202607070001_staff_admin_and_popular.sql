alter table public.products add column is_popular boolean not null default false;

update public.products set is_popular = true where id in (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000104',
  '00000000-0000-4000-8000-000000000201'
);

grant insert, update, delete on table public.profiles to service_role;
