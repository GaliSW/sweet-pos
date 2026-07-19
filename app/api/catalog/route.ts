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
    fixedFlavorsResult,
    allowedFlavorsResult,
    bundlesResult
  ] = await Promise.all([
    supabase.from("products").select("*").eq("is_active", true).order("category"),
    supabase.from("discounts").select("*").eq("is_active", true).order("name"),
    supabase.from("flavors").select("*").eq("is_active", true).order("name"),
    // 排班/業績歸屬名單納入店長(店長也可排班、銷售)
    supabase
      .from("profiles")
      .select("id, display_name, role")
      .in("role", ["staff", "manager"])
      .eq("is_active", true)
      .order("display_name"),
    supabase.from("counters").select("*").eq("is_active", true).order("name"),
    supabase.from("gift_box_rules").select("*"),
    supabase.from("gift_box_fixed_flavors").select("product_id, quantity, flavors(id, name, spec)"),
    supabase.from("gift_box_allowed_flavors").select("product_id, flavor_id"),
    supabase
      .from("bundles")
      .select("id, name, is_active, bundle_products(product_id), bundle_tiers(quantity, price)")
      .eq("is_active", true)
  ]);

  const error =
    productsResult.error ??
    discountsResult.error ??
    flavorsResult.error ??
    staffResult.error ??
    countersResult.error ??
    giftRulesResult.error ??
    fixedFlavorsResult.error ??
    allowedFlavorsResult.error ??
    bundlesResult.error;

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
      allowedFlavors: allowedFlavorsResult.data,
      bundles: (bundlesResult.data ?? []).map((bundle) => ({
        id: bundle.id,
        name: bundle.name,
        productIds: (bundle.bundle_products ?? []).map(
          (row: { product_id: string }) => row.product_id
        ),
        tiers: (bundle.bundle_tiers ?? [])
          .map((tier: { quantity: number; price: number | string }) => ({
            quantity: tier.quantity,
            price: Number(tier.price)
          }))
          .sort(
            (left: { quantity: number }, right: { quantity: number }) =>
              left.quantity - right.quantity
          )
      })),
      source: "supabase"
    }
  });
}
