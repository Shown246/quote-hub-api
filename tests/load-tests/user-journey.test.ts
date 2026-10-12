// tests/load-tests/user-journey.test.ts
import { describe, it, expect } from "vitest";
import { selectActionCategory } from "../../load-tests/scenarios/mixed-user-journey.js";

describe("user journey action distribution", () => {
  it("categorizes rolls < 0.80 as READ", () => {
    expect(selectActionCategory(0.0)).toBe("READ");
    expect(selectActionCategory(0.79)).toBe("READ");
  });

  it("categorizes rolls between 0.80 and 0.94 as INTERACTION", () => {
    expect(selectActionCategory(0.80)).toBe("INTERACTION");
    expect(selectActionCategory(0.94)).toBe("INTERACTION");
  });

  it("categorizes rolls >= 0.95 as WRITE", () => {
    expect(selectActionCategory(0.95)).toBe("WRITE");
    expect(selectActionCategory(0.99)).toBe("WRITE");
  });
});
