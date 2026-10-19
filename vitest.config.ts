import { defineConfig } from "vitest/config";

// Resolve the package's `#layer` imports to TypeScript sources instead of dist.
const conditions = ["polymodel-source", "node", "import", "module", "default"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { include: ["src/**/*.test.ts"] },
});
