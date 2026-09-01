import { describe, expect, it } from "vitest";

import {
  contractMoneySnapshot,
  openingBalanceMoneySnapshot,
  proratedContractFee,
  receivableStatus,
  remainingAmount,
} from "@/features/finance/money";

describe("finance money rules", () => {
  it("takes an exempt and exclusive contract snapshot without Number math", () => {
    expect(contractMoneySnapshot("75000", "exempt", "0")).toEqual({
      netAmount: "75000.0000",
      totalAmount: "75000.0000",
      vatAmount: "0.0000",
    });
    expect(contractMoneySnapshot("50000", "exclusive", "20")).toEqual({
      netAmount: "50000.0000",
      totalAmount: "60000.0000",
      vatAmount: "10000.0000",
    });
  });

  it("keeps inclusive VAT components equal to the contract total", () => {
    expect(contractMoneySnapshot("50000", "inclusive", "20")).toEqual({
      netAmount: "41666.6667",
      totalAmount: "50000.0000",
      vatAmount: "8333.3333",
    });
  });

  it("normalizes opening balances and calculates the remaining amount", () => {
    expect(openingBalanceMoneySnapshot("100.1", "20.02")).toEqual({
      netAmount: "100.1000",
      totalAmount: "120.1200",
      vatAmount: "20.0200",
    });
    expect(remainingAmount("120.1200", "20.1200")).toBe("100.0000");
  });

  it("prorates only the contract's active calendar days in boundary months", () => {
    expect(
      proratedContractFee("120000", "2026-09", "2026-09-15", "2027-08-14"),
    ).toBe("64000.0000");
    expect(
      proratedContractFee("120000", "2026-10", "2026-09-15", "2027-08-14"),
    ).toBe("120000.0000");
    expect(
      proratedContractFee("120000", "2027-08", "2026-09-15", "2027-08-14"),
    ).toBe("54193.5484");
  });

  it("derives status from payments and the due date instead of persisting it", () => {
    expect(receivableStatus("100", "100", "2026-09-01", "2026-09-02")).toBe(
      "paid",
    );
    expect(receivableStatus("100", "25", "2026-09-03", "2026-09-02")).toBe(
      "partial",
    );
    expect(receivableStatus("100", "25", "2026-09-01", "2026-09-02")).toBe(
      "overdue",
    );
    expect(receivableStatus("100", "0", "2026-09-02", "2026-09-02")).toBe(
      "open",
    );
  });
});
