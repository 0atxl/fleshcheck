import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
  },
  assetsInclude: ["**/*.task", "**/*.wasm"],
});
