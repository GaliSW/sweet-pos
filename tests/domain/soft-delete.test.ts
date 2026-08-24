import { describe, expect, it } from "vitest";
import { planFlavorDeletion, planProductDeletion } from "@/lib/domain/soft-delete";

describe("planProductDeletion", () => {
  it("被其他商品當作庫存來源時擋下,並列出是哪些商品", () => {
    const plan = planProductDeletion({
      name: "蔥餅袋",
      stockSourceDependents: ["9入蔥餅禮盒", "12入蔥餅禮盒"],
      bundleNames: []
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) throw new Error("預期擋下");
    expect(plan.error).toContain("蔥餅袋");
    expect(plan.error).toContain("9入蔥餅禮盒");
    expect(plan.error).toContain("12入蔥餅禮盒");
  });

  it("在組合價裡時放行,並告知會從哪些組合價移除", () => {
    const plan = planProductDeletion({
      name: "原味袋",
      stockSourceDependents: [],
      bundleNames: ["袋裝任選"]
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("預期放行");
    expect(plan.clearedRelation).toContain("袋裝任選");
  });

  it("沒有任何關聯時放行且不需要清理", () => {
    const plan = planProductDeletion({
      name: "測試商品",
      stockSourceDependents: [],
      bundleNames: []
    });

    expect(plan).toEqual({ ok: true, clearedRelation: null });
  });

  it("庫存來源優先於組合價:兩者都有時仍然擋下", () => {
    const plan = planProductDeletion({
      name: "蔥餅袋",
      stockSourceDependents: ["9入蔥餅禮盒"],
      bundleNames: ["袋裝任選"]
    });

    expect(plan.ok).toBe(false);
  });

  it("重複名稱只列一次", () => {
    const plan = planProductDeletion({
      name: "原味袋",
      stockSourceDependents: [],
      bundleNames: ["袋裝任選", "袋裝任選"]
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("預期放行");
    expect(plan.clearedRelation).toBe("已從組合價「袋裝任選」移除此商品");
  });
});

describe("planFlavorDeletion", () => {
  it("是固定禮盒的內容物時擋下,並列出是哪些禮盒", () => {
    const plan = planFlavorDeletion({
      name: "原味",
      fixedGiftBoxNames: ["發禮盒"],
      allowedGiftBoxNames: []
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) throw new Error("預期擋下");
    expect(plan.error).toContain("原味");
    expect(plan.error).toContain("發禮盒");
  });

  it("只被自選禮盒列為可選時放行,並告知會從哪些禮盒移除", () => {
    const plan = planFlavorDeletion({
      name: "草莓",
      fixedGiftBoxNames: [],
      allowedGiftBoxNames: ["小禮盒"]
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("預期放行");
    expect(plan.clearedRelation).toContain("小禮盒");
  });

  it("沒有任何關聯時放行且不需要清理", () => {
    const plan = planFlavorDeletion({
      name: "測試口味",
      fixedGiftBoxNames: [],
      allowedGiftBoxNames: []
    });

    expect(plan).toEqual({ ok: true, clearedRelation: null });
  });

  it("固定禮盒優先於自選禮盒:兩者都有時仍然擋下", () => {
    const plan = planFlavorDeletion({
      name: "原味",
      fixedGiftBoxNames: ["發禮盒"],
      allowedGiftBoxNames: ["小禮盒"]
    });

    expect(plan.ok).toBe(false);
  });
});
