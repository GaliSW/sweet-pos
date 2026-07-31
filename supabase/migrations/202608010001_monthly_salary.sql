alter table public.profiles
  add column if not exists salary_type text not null default 'hourly'
    check (salary_type in ('hourly', 'monthly')),
  add column if not exists monthly_salary numeric(12,2) not null default 0
    check (monthly_salary >= 0);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_hourly_wage_nonnegative'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_hourly_wage_nonnegative check (hourly_wage >= 0);
  end if;
end
$$;
