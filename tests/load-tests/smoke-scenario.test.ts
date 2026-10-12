// tests/load-tests/smoke-scenario.test.ts
import { describe, it, expect } from "vitest";
import { validateDatasetExists } from "../../load-tests/scenarios/smoke-test.js";

describe("smoke test scenario requirements", () => {
  it("throws descriptive error when users.json is missing", () => {
    expect(() => validateDatasetExists(null)).toThrowError(
      /Seed dataset missing! Run 'npx tsx load-tests\/scripts\/seed-load-data.ts' first/
    );
  });

  it("passes when user dataset contains at least 1 user", () => {
    expect(() => validateDatasetExists({ users: [{ id: "u1" }] })).not.toThrow();
  });
});
