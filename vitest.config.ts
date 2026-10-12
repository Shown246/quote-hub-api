import { defineConfig } from "vitest/config";

import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "k6/http": path.resolve(__dirname, "tests/mocks/k6-http.ts"),
      "k6": path.resolve(__dirname, "tests/mocks/k6.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
  },
});
