import { describe, expect, it } from "vitest";
import {
  auditEntityLabel,
  auditFieldLabel,
  diffRecords,
  formatAuditValue
} from "@/lib/domain/audit-diff";

describe("diffRecords", () => {
  it("新增時列出 after 的每一個欄位", () => {
    expect(diffRecords(null, { name: "匠心(原/草/巧)", price: 450 })).toEqual([
      { field: "name", label: "名稱", before: null, after: "匠心(原/草/巧)" },
      { field: "price", label: "價格", before: null, after: "450" }
    ]);
  });

  it("刪除時列出 before 的每一個欄位", () => {
    expect(diffRecords({ name: "匠心(原/草/巧)", price: 450 }, null)).toEqual([
      { field: "name", label: "名稱", before: "匠心(原/草/巧)", after: null },
      { field: "price", label: "價格", before: "450", after: null }
    ]);
  });

  it("修改時只列出真正變動的欄位", () => {
    expect(
      diffRecords(
        { name: "匠心", price: 450, is_active: true },
        { name: "匠心", price: 480, is_active: true }
      )
    ).toEqual([{ field: "price", label: "價格", before: "450", after: "480" }]);
  });

  it("Postgres numeric 回傳字串時不算變更", () => {
    expect(diffRecords({ price: "450.00" }, { price: 450 })).toEqual([]);
  });

  it("兩邊都是字串時不做數值正規化", () => {
    expect(diffRecords({ name: "0050" }, { name: "50" })).toHaveLength(1);
  });

  it("布林值顯示為是／否", () => {
    expect(diffRecords({ is_active: true }, { is_active: false })).toEqual([
      { field: "is_active", label: "啟用", before: "是", after: "否" }
    ]);
  });

  it("巢狀物件的鍵順序不影響比對", () => {
    expect(
      diffRecords(
        { giftRule: { selectionMode: "select", requiredFlavorCount: 3 } },
        { giftRule: { requiredFlavorCount: 3, selectionMode: "select" } }
      )
    ).toEqual([]);
  });

  it("巢狀物件內容變動會被抓到", () => {
    expect(
      diffRecords(
        { giftRule: { requiredFlavorCount: 3 } },
        { giftRule: { requiredFlavorCount: 4 } }
      )
    ).toHaveLength(1);
  });

  it("陣列內容變動會被抓到", () => {
    expect(
      diffRecords(
        { tiers: [{ minDailySales: 0, rate: 0.02 }] },
        { tiers: [{ minDailySales: 0, rate: 0.03 }] }
      )
    ).toHaveLength(1);
  });

  it("null 與 undefined 視為相同", () => {
    expect(diffRecords({ location: null }, { location: undefined })).toEqual([]);
  });

  it("兩邊皆空時沒有任何變更", () => {
    expect(diffRecords(null, null)).toEqual([]);
  });

  it("未知欄位退回顯示原始欄位名", () => {
    expect(diffRecords(null, { some_new_column: "x" })[0].label).toBe("some_new_column");
  });
});

describe("formatAuditValue", () => {
  it("空值回傳 null", () => {
    expect(formatAuditValue(null)).toBeNull();
    expect(formatAuditValue(undefined)).toBeNull();
  });

  it("布林值轉成是／否", () => {
    expect(formatAuditValue(true)).toBe("是");
    expect(formatAuditValue(false)).toBe("否");
  });

  it("數字與字串原樣輸出", () => {
    expect(formatAuditValue(450)).toBe("450");
    expect(formatAuditValue("匠心")).toBe("匠心");
  });

  it("物件輸出 JSON", () => {
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("label 對照", () => {
  it("已知的 entity 顯示中文", () => {
    expect(auditEntityLabel("products")).toBe("商品");
    expect(auditEntityLabel("commission_tiers")).toBe("抽成");
  });

  it("未知的 entity 原樣顯示", () => {
    expect(auditEntityLabel("unknown_table")).toBe("unknown_table");
  });

  it("已知的欄位顯示中文", () => {
    expect(auditFieldLabel("hourly_wage")).toBe("時薪");
  });
});
