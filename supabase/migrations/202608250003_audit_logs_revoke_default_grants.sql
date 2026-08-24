-- 正式區的 schema public 有預設授權(alter default privileges),
-- 導致 202608250001 建立的 audit_logs 自動被授予 anon/authenticated 的寫入權限,
-- 與「append-only、只有 service_role 寫得進去」的設計不符。
--
-- RLS 目前仍擋得住(只有 select policy,其餘操作無 policy 即拒絕),
-- 但那只剩一道防線。這裡把授權層補回來,恢復成兩道。
revoke all on public.audit_logs from anon;
revoke all on public.audit_logs from authenticated;

grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
