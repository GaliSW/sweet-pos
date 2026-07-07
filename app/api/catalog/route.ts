import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { counters, currentShiftStaff, discounts, flavors, products } from "@/lib/domain/sample-data";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";

export async function GET() {
  const guard = await requireRole();

  if (guard.failure) return guard.failure;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        products,
        discounts,
        flavors,
        staff: currentShiftStaff,
        counters,
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();

  const [
    productsResult,
    discountsResult,
    flavorsResult,
    staffResult,
    countersResult,
    giftRulesResult,
    fixedFlavorsResult
  ] = await Promise.all([
    supabase.from("products").select("*").eq("is_active", true).order("category"),
    supabase.from("discounts").select("*").eq("is_active", true).order("name"),
    supabase.from("flavors").select("*").eq("is_active", true).order("name"),
    supabase.from("profiles").select("id, display_name").eq("role", "staff").eq("is_active", true),
    supabase.from("counters").select("*").eq("is_active", true).order("name"),
    supabase.from("gift_box_rules").select("*"),
    supabase.from("gift_box_fixed_flavors").select("product_id, quantity, flavors(id, name, spec)")
  ]);

  const error =
    productsResult.error ??
    discountsResult.error ??
    flavorsResult.error ??
    staffResult.error ??
    countersResult.error ??
    giftRulesResult.error ??
    fixedFlavorsResult.error;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      products: productsResult.data,
      discounts: discountsResult.data,
      flavors: flavorsResult.data,
      staff: staffResult.data,
      counters: countersResult.data,
      giftRules: giftRulesResult.data,
      fixedFlavors: fixedFlavorsResult.data,
      source: "supabase"
    }
  });
}
