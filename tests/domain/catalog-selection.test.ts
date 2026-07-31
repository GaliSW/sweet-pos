import { describe, expect, it } from "vitest";
import { selectAvailableId } from "@/lib/domain/catalog-selection";

describe("selectAvailableId", () => {
  it("replaces a demo selection with the first counter returned by the live catalog", () => {
    expect(
      selectAvailableId("00000000-0000-4000-8000-000000000401", [
        { id: "live-counter-1" },
        { id: "live-counter-2" }
      ])
    ).toBe("live-counter-1");
  });

  it("keeps the current selection when it still exists in the live catalog", () => {
    expect(
      selectAvailableId("live-counter-2", [
        { id: "live-counter-1" },
        { id: "live-counter-2" }
      ])
    ).toBe("live-counter-2");
  });

  it("clears the selection when no counters are available", () => {
    expect(selectAvailableId("stale-counter", [])).toBe("");
  });
});
