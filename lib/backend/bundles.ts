import type { createSupabaseAdminClient } from "@/lib/db/server";
import {
  calculateBundleDiscount,
  type BundleDefinition
} from "@/lib/domain/pos-rules";

export async function fetchActiveBundles(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<BundleDefinition[]> {
  const { data, error } = await supabase
    .from("bundles")
    .select("id, name, bundle_products(product_id), bundle_tiers(quantity, price)")
    .eq("is_active", true);

  if (error || !data) return [];

  return data.map((bundle) => ({
    id: bundle.id as string,
    name: bundle.name as string,
    productIds: (bundle.bundle_products ?? []).map(
      (row: { product_id: string }) => row.product_id
    ),
    tiers: (bundle.bundle_tiers ?? []).map(
      (tier: { quantity: number; price: number | string }) => ({
        quantity: tier.quantity,
        price: Number(tier.price)
      })
    )
  }));
}

// 依訂單品項(商品 x 數量)計算組合價總折抵;金額以資料庫商品售價為準。
export async function computeOrderBundleDiscount(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  items: Array<{ productId: string; quantity: number }>
): Promise<number> {
  if (items.length === 0) return 0;

  const bundles = await fetchActiveBundles(supabase);

  if (bundles.length === 0) return 0;

  const productIds = Array.from(new Set(items.map((item) => item.productId)));
  const { data: products, error } = await supabase
    .from("products")
    .select("id, price")
    .in("id", productIds);

  if (error || !products) return 0;

  const priceById = new Map(products.map((product) => [product.id as string, Number(product.price)]));

  return calculateBundleDiscount(
    items.map((item) => ({
      productId: item.productId,
      unitPrice: priceById.get(item.productId) ?? 0,
      quantity: item.quantity
    })),
    bundles
  ).totalDiscount;
}
