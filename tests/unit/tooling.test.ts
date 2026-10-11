import fs from "fs";
import path from "path";

describe("Tooling Configuration", () => {
  it("should have vitest running and verifying basic environment", () => {
    expect(process.version).toBeDefined();
    expect(true).toBe(true);
  });

  it("should define 'workers' script in package.json targeting src/workers/runner.ts", () => {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    expect(pkg.scripts?.workers).toBe("tsx src/workers/runner.ts");
  });
});

