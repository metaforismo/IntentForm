import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/.desktop/**", "**/.next/**", "**/dist/**", "**/output/**"],
    coverage: { reporter: ["text", "json-summary"] },
  },
});
