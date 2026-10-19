import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve the package's `#layer` imports to TypeScript sources instead of dist.
const conditions = ["polymodel-source", "node", "import", "module", "default"];

export default defineConfig({
  resolve: {
    conditions,
    // Vite doesn't run the Node resolve hook from registerPackageAlias, so
    // config files loaded in tests need the self-import mapped explicitly.
    alias: {
      "@ryaninvents/polymodel/plugin": fileURLToPath(
        new URL("src/plugin.ts", import.meta.url),
      ),
    },
  },
  ssr: { resolve: { conditions } },
  test: { include: ["src/**/*.test.ts"] },
});
