grant usage on schema public to anon, authenticated, service_role;

grant select on table
  public.products,
  public.discounts,
  public.flavors,
  public.profiles,
  public.counters,
  public.gift_box_rules,
  public.gift_box_fixed_flavors
to anon, authenticated, service_role;

grant select, insert, update on table
  public.orders,
  public.order_items,
  public.order_item_gift_flavors,
  public.inventory_movements,
  public.shifts,
  public.counter_monthly_targets
to service_role;

grant delete on table public.shifts to service_role;

grant execute on function public.create_pos_order(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb
) to authenticated, service_role;
