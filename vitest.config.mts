import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/__tests__/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // "server-only" يوفّره Next.js فقط — نستبدله ببديل فارغ في الاختبارات
      "server-only": path.resolve(import.meta.dirname, "./src/lib/__tests__/server-only-stub.ts"),
    },
  },
});
