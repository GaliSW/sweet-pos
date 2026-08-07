-- Keep privileged RLS helpers outside the Data API's exposed public schema.
create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select profile.role = 'manager'
      from public.profiles profile
      where profile.id = (select auth.uid())
    ),
    false
  );
$$;

revoke execute on function private.is_manager() from public, anon;
grant execute on function private.is_manager() to authenticated, service_role;

-- RLS policies need the manager helper, but it no longer needs to be exposed as
-- a callable public SECURITY DEFINER RPC.
alter policy "managers manage commission tiers"
  on public.commission_tiers
  to authenticated
  using ((select private.is_manager()))
  with check ((select private.is_manager()));

alter policy "managers manage monthly targets"
  on public.counter_monthly_targets
  to authenticated
  using ((select private.is_manager()))
  with check ((select private.is_manager()));

alter policy "managers manage counters"
  on public.counters
  to authenticated
  using ((select private.is_manager()))
  with check ((select private.is_manager()));

alter policy "managers manage discounts"
  on public.discounts
  to authenticated
  using ((select private.is_manager()))
  with check ((select private.is_manager()));

alter policy "managers manage flavors"
  on public.flavors
  to authenticated
  using ((select private.is_manager()))
  with check ((select private.is_manager()));

alter policy "managers review inventory"
  on public.inventory_movements
  to authenticated
  using ((select private.is_manager()))
  with check ((select private.is_manager()));

alter policy "staff read own inventory and managers read all"
  on public.inventory_movements
  to authenticated
  using (
    created_by = (select auth.uid())
    or (select private.is_manager())
  );

alter policy "gift flavor items follow readable orders"
  on public.order_item_gift_flavors
  to authenticated
  using (
    exists (
      select 1
      from public.order_items
      join public.orders on orders.id = order_items.order_id
      where order_items.id = order_item_gift_flavors.order_item_id
        and (
          orders.cashier_id = (select auth.uid())
          or orders.seller_id = (select auth.uid())
          or (select private.is_manager())
        )
    )
  );

alter policy "order items follow readable orders"
  on public.order_items
  to authenticated
  using (
    exists (
      select 1
      from public.orders
      where orders.id = order_items.order_id
        and (
          orders.cashier_id = (select auth.uid())
          or orders.seller_id = (select auth.uid())
          or (select private.is_manager())
        )
    )
  );

alter policy "managers read preorders"
  on public.order_preorder_items
  to authenticated
  using ((select private.is_manager()));

alter policy "staff read own orders and managers read all"
  on public.orders
  to authenticated
  using (
    cashier_id = (select auth.uid())
    or seller_id = (select auth.uid())
    or (select private.is_manager())
  );

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'payment_methods'
      and policyname = 'managers manage payment methods'
  ) then
    execute $policy$
      alter policy "managers manage payment methods"
        on public.payment_methods
        to authenticated
        using ((select private.is_manager()))
        with check ((select private.is_manager()))
    $policy$;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'payment_methods'
      and policyname = 'payment methods readable'
  ) then
    execute $policy$
      alter policy "payment methods readable"
        on public.payment_methods
        to authenticated
        using (is_active or (select private.is_manager()))
    $policy$;
  end if;
end;
$$;

alter policy "managers manage catalog"
  on public.products
  to authenticated
  using ((select private.is_manager()))
  with check ((select private.is_manager()));

alter policy "managers manage profiles"
  on public.profiles
  to authenticated
  using ((select private.is_manager()))
  with check ((select private.is_manager()));

alter policy "profiles read own or manager"
  on public.profiles
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_manager())
  );

alter policy "managers manage shifts"
  on public.shifts
  to authenticated
  using ((select private.is_manager()))
  with check ((select private.is_manager()));

-- All application RPC calls go through server-side service_role clients.
revoke execute on function public.calculate_order_discount(numeric, uuid)
  from public, anon, authenticated;
revoke execute on function public.create_pos_order(
  uuid, uuid, uuid, uuid, text, jsonb, uuid, numeric, numeric, text, timestamptz
) from public, anon, authenticated;
revoke execute on function public.current_stock(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.current_user_role()
  from public, anon, authenticated;
revoke execute on function public.is_manager()
  from public, anon, authenticated;
revoke execute on function public.update_pos_order(
  uuid, uuid, uuid, text, jsonb, uuid, timestamptz, uuid, numeric, numeric, text
) from public, anon, authenticated;
revoke execute on function public.void_pos_order(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.write_pos_order_items(uuid, text, uuid, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.calculate_order_discount(numeric, uuid) to service_role;
grant execute on function public.create_pos_order(
  uuid, uuid, uuid, uuid, text, jsonb, uuid, numeric, numeric, text, timestamptz
) to service_role;
grant execute on function public.current_stock(uuid, uuid, uuid) to service_role;
grant execute on function public.current_user_role() to service_role;
grant execute on function public.is_manager() to service_role;
grant execute on function public.update_pos_order(
  uuid, uuid, uuid, text, jsonb, uuid, timestamptz, uuid, numeric, numeric, text
) to service_role;
grant execute on function public.void_pos_order(uuid, uuid, text) to service_role;
grant execute on function public.write_pos_order_items(uuid, text, uuid, uuid, jsonb)
  to service_role;

-- PostgreSQL does not automatically index the referencing side of foreign keys.
create index if not exists bundle_products_product_id_idx
  on public.bundle_products (product_id);
create index if not exists gift_box_allowed_flavors_flavor_id_idx
  on public.gift_box_allowed_flavors (flavor_id);
create index if not exists gift_box_fixed_flavors_flavor_id_idx
  on public.gift_box_fixed_flavors (flavor_id);
create index if not exists inventory_movements_counter_id_idx
  on public.inventory_movements (counter_id);
create index if not exists inventory_movements_created_by_idx
  on public.inventory_movements (created_by);
create index if not exists inventory_movements_flavor_id_idx
  on public.inventory_movements (flavor_id);
create index if not exists inventory_movements_order_id_idx
  on public.inventory_movements (order_id);
create index if not exists inventory_movements_product_id_idx
  on public.inventory_movements (product_id);
create index if not exists inventory_movements_reviewed_by_idx
  on public.inventory_movements (reviewed_by);
create index if not exists inventory_movements_updated_by_idx
  on public.inventory_movements (updated_by);
create index if not exists order_item_gift_flavors_flavor_id_idx
  on public.order_item_gift_flavors (flavor_id);
create index if not exists order_item_gift_flavors_order_item_id_idx
  on public.order_item_gift_flavors (order_item_id);
create index if not exists order_items_order_id_idx
  on public.order_items (order_id);
create index if not exists order_items_product_id_idx
  on public.order_items (product_id);
create index if not exists order_preorder_items_counter_id_idx
  on public.order_preorder_items (counter_id);
create index if not exists order_preorder_items_flavor_id_idx
  on public.order_preorder_items (flavor_id);
create index if not exists order_preorder_items_order_id_idx
  on public.order_preorder_items (order_id);
create index if not exists order_preorder_items_order_item_id_idx
  on public.order_preorder_items (order_item_id);
create index if not exists order_preorder_items_product_id_idx
  on public.order_preorder_items (product_id);
create index if not exists orders_cashier_id_idx
  on public.orders (cashier_id);
create index if not exists orders_counter_id_idx
  on public.orders (counter_id);
create index if not exists orders_discount_id_idx
  on public.orders (discount_id);
create index if not exists orders_edited_by_idx
  on public.orders (edited_by);
create index if not exists orders_payment_method_idx
  on public.orders (payment_method);
create index if not exists orders_seller2_id_idx
  on public.orders (seller2_id);
create index if not exists orders_seller_id_idx
  on public.orders (seller_id);
create index if not exists orders_voided_by_idx
  on public.orders (voided_by);
create index if not exists products_stock_source_product_id_idx
  on public.products (stock_source_product_id);
create index if not exists shifts_staff_id_idx
  on public.shifts (staff_id);
