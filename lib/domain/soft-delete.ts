// 軟刪除的前置判斷。軟刪除不會觸發資料庫 cascade,
// 所以要自己決定哪些情況「擋下」、哪些關聯要「一併清掉」。純邏輯,不放 I/O。

export type SoftDeletePlan =
  | { ok: true; clearedRelation: string | null }
  | { ok: false; error: string };

function joinNames(names: string[]) {
  return Array.from(new Set(names)).join("、");
}

// 擋下條件:有其他商品以它為庫存來源。放行的話那些商品賣出時會去扣一個已刪除商品的庫存。
export function planProductDeletion(params: {
  name: string;
  stockSourceDependents: string[];
  bundleNames: string[];
}): SoftDeletePlan {
  if (params.stockSourceDependents.length > 0) {
    return {
      ok: false,
      error: `「${params.name}」是這些商品的庫存來源，請先改掉它們的庫存來源再刪除：${joinNames(
        params.stockSourceDependents
      )}`
    };
  }

  return {
    ok: true,
    clearedRelation: params.bundleNames.length
      ? `已從組合價「${joinNames(params.bundleNames)}」移除此商品`
      : null
  };
}

// 擋下條件:被固定禮盒當作內容物。放行的話禮盒內容會指向不存在的口味。
export function planFlavorDeletion(params: {
  name: string;
  fixedGiftBoxNames: string[];
  allowedGiftBoxNames: string[];
}): SoftDeletePlan {
  if (params.fixedGiftBoxNames.length > 0) {
    return {
      ok: false,
      error: `「${params.name}」是這些固定禮盒的內容物，請先調整禮盒內容再刪除：${joinNames(
        params.fixedGiftBoxNames
      )}`
    };
  }

  return {
    ok: true,
    clearedRelation: params.allowedGiftBoxNames.length
      ? `已從自選禮盒「${joinNames(params.allowedGiftBoxNames)}」的可選口味中移除`
      : null
  };
}
