import { describe, expect, it } from "vitest";
import { densityScalar, DENSITY_SCALAR } from "./density";

describe("densityScalar", () => {
  it("returns 0.85 for compact", () => {
    expect(densityScalar("compact")).toBe(0.85);
  });
  it("returns 1 for default", () => {
    expect(densityScalar("default")).toBe(1);
  });
  it("returns 1.18 for comfortable", () => {
    expect(densityScalar("comfortable")).toBe(1.18);
  });
  it("falls back to 1 for null/undefined/unknown", () => {
    expect(densityScalar(null)).toBe(1);
    expect(densityScalar(undefined)).toBe(1);
    expect(densityScalar("nonsense")).toBe(1);
  });
});

describe("DENSITY_SCALAR map", () => {
  it("matches the css tokens", () => {
    expect(DENSITY_SCALAR.compact).toBe(0.85);
    expect(DENSITY_SCALAR.default).toBe(1);
    expect(DENSITY_SCALAR.comfortable).toBe(1.18);
  });
});
