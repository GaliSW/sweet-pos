-- 後台設定變更的稽核紀錄。八組管理路由都用 service_role 寫入、資料庫層抓不到 auth.uid(),
-- 因此由應用層的 writeAuditLog() 帶入操作人。這張表是 append-only:
-- 只有 select policy,沒有 insert/update/delete policy,只有 service_role 寫得進去。
create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_name   text not null,
  action       text not null check (action in ('create', 'update', 'delete')),
  entity       text not null,
  entity_id    text,
  entity_label text,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity, entity_id);
create index if not exists audit_logs_actor_id_idx on public.audit_logs (actor_id);

alter table public.audit_logs enable row level security;

drop policy if exists "managers read audit logs" on public.audit_logs;
create policy "managers read audit logs" on public.audit_logs
  for select to authenticated
  using ((select private.is_manager()));

grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
