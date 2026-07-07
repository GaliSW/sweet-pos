import { NextResponse } from "next/server";
import type { UpsertStaffInput } from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { currentShiftStaff } from "@/lib/domain/sample-data";

export async function GET() {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        staff: currentShiftStaff.map((staff, index) => ({
          id: staff.id,
          email: `staff-${String.fromCharCode(97 + index)}@example.local`,
          displayName: staff.name,
          role: "staff",
          hourlyWage: 190,
          isActive: true
        })),
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();
  const [profilesResult, usersResult] = await Promise.all([
    supabase.from("profiles").select("*").order("role").order("display_name"),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  ]);

  if (profilesResult.error) {
    return NextResponse.json({ ok: false, error: profilesResult.error.message }, { status: 500 });
  }

  const emailById = new Map(
    (usersResult.data?.users ?? []).map((user) => [user.id, user.email ?? ""])
  );

  return NextResponse.json({
    ok: true,
    data: {
      staff: (profilesResult.data ?? []).map((profile) => ({
        id: profile.id,
        email: emailById.get(profile.id as string) ?? "",
        displayName: profile.display_name,
        role: profile.role,
        hourlyWage: Number(profile.hourly_wage),
        isActive: profile.is_active
      })),
      source: "supabase"
    }
  });
}

export async function POST(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertStaffInput;
  const validation = validateStaffInput(input, { requireCredentials: true });

  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { staffId: crypto.randomUUID(), source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: input.email as string,
    password: input.password as string,
    email_confirm: true,
    user_metadata: { display_name: input.displayName.trim() }
  });

  if (createError || !created.user) {
    return NextResponse.json(
      { ok: false, error: createError?.message ?? "建立帳號失敗" },
      { status: 400 }
    );
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: created.user.id,
    display_name: input.displayName.trim(),
    role: input.role,
    hourly_wage: input.hourlyWage,
    is_active: input.isActive ?? true
  });

  if (profileError) {
    await supabase.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ ok: false, error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: { staffId: created.user.id, source: "supabase" }
  });
}

export async function PATCH(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertStaffInput;

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少員工編號" }, { status: 400 });
  }

  const validation = validateStaffInput(input, { requireCredentials: false });

  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { staffId: input.id, source: "demo" }
    });
  }

  if (guard.profile && guard.profile.id === input.id && input.role !== "manager") {
    return NextResponse.json({ ok: false, error: "不可移除自己的店長權限" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: input.displayName.trim(),
      role: input.role,
      hourly_wage: input.hourlyWage,
      is_active: input.isActive ?? true
    })
    .eq("id", input.id)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  if (input.password) {
    const { error: passwordError } = await supabase.auth.admin.updateUserById(input.id, {
      password: input.password
    });

    if (passwordError) {
      return NextResponse.json({ ok: false, error: passwordError.message }, { status: 400 });
    }
  }

  return NextResponse.json({
    ok: true,
    data: { staffId: data.id, source: "supabase" }
  });
}

export async function DELETE(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as { id?: string };

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少員工編號" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { staffId: input.id, mode: "deleted", source: "demo" }
    });
  }

  if (guard.profile && guard.profile.id === input.id) {
    return NextResponse.json({ ok: false, error: "不可刪除自己的帳號" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const [ordersResult, shiftsResult, movementsResult] = await Promise.all([
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .or(`seller_id.eq.${input.id},cashier_id.eq.${input.id}`),
    supabase.from("shifts").select("id", { count: "exact", head: true }).eq("staff_id", input.id),
    supabase
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .or(`created_by.eq.${input.id},reviewed_by.eq.${input.id}`)
  ]);

  const error = ordersResult.error ?? shiftsResult.error ?? movementsResult.error;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const referenceCount =
    (ordersResult.count ?? 0) + (shiftsResult.count ?? 0) + (movementsResult.count ?? 0);

  if (referenceCount > 0) {
    const { error: deactivateError } = await supabase
      .from("profiles")
      .update({ is_active: false })
      .eq("id", input.id);

    if (deactivateError) {
      return NextResponse.json({ ok: false, error: deactivateError.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        staffId: input.id,
        mode: "deactivated",
        message: "員工已有訂單 / 班表 / 庫存紀錄，帳號已停用（保留歷史資料）",
        source: "supabase"
      }
    });
  }

  const { error: deleteProfileError } = await supabase
    .from("profiles")
    .delete()
    .eq("id", input.id);

  if (deleteProfileError) {
    return NextResponse.json({ ok: false, error: deleteProfileError.message }, { status: 400 });
  }

  const { error: deleteUserError } = await supabase.auth.admin.deleteUser(input.id);

  if (deleteUserError) {
    return NextResponse.json({ ok: false, error: deleteUserError.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: { staffId: input.id, mode: "deleted", source: "supabase" }
  });
}

function validateStaffInput(
  input: UpsertStaffInput,
  options: { requireCredentials: boolean }
) {
  if (!input.displayName?.trim()) return { ok: false as const, error: "缺少姓名" };
  if (input.role !== "staff" && input.role !== "manager") {
    return { ok: false as const, error: "角色必須是員工或店長" };
  }
  if (!Number.isFinite(Number(input.hourlyWage)) || Number(input.hourlyWage) < 0) {
    return { ok: false as const, error: "時薪不可為負數" };
  }

  if (options.requireCredentials) {
    if (!input.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) {
      return { ok: false as const, error: "Email 格式不正確" };
    }
    if (!input.password || input.password.length < 8) {
      return { ok: false as const, error: "密碼至少需要 8 個字元" };
    }
  } else if (input.password && input.password.length < 8) {
    return { ok: false as const, error: "密碼至少需要 8 個字元" };
  }

  return { ok: true as const };
}
