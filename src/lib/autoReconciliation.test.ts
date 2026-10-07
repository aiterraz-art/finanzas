import { describe, expect, it } from "vitest";
import { buildAutoMatchSuggestions, getDayDistance, type AutoMatchCandidate } from "@/lib/autoReconciliation";

const invoice = (id: string, amount: number, dates: string[], direction: "inflow" | "outflow" = "inflow"): AutoMatchCandidate => ({
  id,
  type: "factura",
  direction,
  amount,
  dates,
});

describe("auto reconciliation suggestions", () => {
  it("uses the closest reference date", () => {
    expect(getDayDistance("2026-04-10", ["2026-03-01", "2026-04-12", null])).toBe(2);
    expect(getDayDistance("2026-04-10", [null])).toBeNull();
  });

  it("matches by exact amount, direction and date window", () => {
    const suggestions = buildAutoMatchSuggestions(
      [
        { id: "m1", fecha: "2026-04-10", monto: 1000 },
        { id: "m2", fecha: "2026-04-10", monto: -500 },
        { id: "m3", fecha: "2026-04-10", monto: 777 },
      ],
      [
        invoice("f-in", 1000, ["2026-04-05"]),
        invoice("f-out-wrong-direction", 500, ["2026-04-10"]),
        invoice("f-out", 500, ["2026-04-11"], "outflow"),
        invoice("f-far", 777, ["2026-02-01"]),
      ],
      { maxDays: 7 }
    );

    expect(suggestions.map((item) => [item.movementId, item.candidateId])).toEqual([
      ["m1", "f-in"],
      ["m2", "f-out"],
    ]);
  });

  it("never assigns the same document to two movements", () => {
    const suggestions = buildAutoMatchSuggestions(
      [
        { id: "m1", fecha: "2026-04-10", monto: 1000 },
        { id: "m2", fecha: "2026-04-03", monto: 1000 },
      ],
      [invoice("f1", 1000, ["2026-04-09"]), invoice("f2", 1000, ["2026-04-01"])],
      { maxDays: 15 }
    );

    expect(suggestions.find((item) => item.movementId === "m1")?.candidateId).toBe("f1");
    expect(suggestions.find((item) => item.movementId === "m2")?.candidateId).toBe("f2");
    expect(suggestions.find((item) => item.movementId === "m1")?.options).toHaveLength(2);
  });

  it("skips a movement whose only option was taken by a closer one", () => {
    const suggestions = buildAutoMatchSuggestions(
      [
        { id: "m1", fecha: "2026-04-10", monto: 1000 },
        { id: "m2", fecha: "2026-04-15", monto: 1000 },
      ],
      [invoice("f1", 1000, ["2026-04-10"])],
      { maxDays: 15 }
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].movementId).toBe("m1");
  });
});
