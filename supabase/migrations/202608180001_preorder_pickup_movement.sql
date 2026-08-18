-- 庫存異動加預購取貨:POS 庫存不足時差額掛預購未扣庫存,客人取貨時補扣
alter table public.inventory_movements
  drop constraint inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (
    movement_type in ('opening_count', 'closing_count', 'handover_count', 'purchase', 'sampling', 'waste', 'adjustment', 'preorder_pickup', 'sale')
  );
