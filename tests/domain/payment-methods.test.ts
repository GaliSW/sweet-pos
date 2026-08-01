import { describe, expect, it } from "vitest";
import { resolvePaymentLabel } from "@/lib/domain/payment-methods";

describe("resolvePaymentLabel", () => {
  it("uses the manager-configured name", () => {
    expect(
      resolvePaymentLabel("mobile_payment", [
        { code: "mobile_payment", name: "電子支付" }
      ])
    ).toBe("電子支付");
  });

  it("groups legacy LINE Pay and JKOPay values under mobile payment", () => {
    expect(resolvePaymentLabel("line_pay", [])).toBe("行動支付");
    expect(resolvePaymentLabel("jkopay", [])).toBe("行動支付");
  });
});
