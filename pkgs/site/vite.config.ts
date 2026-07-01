import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Build a static SPA into dist/. config.js (deploy-time values) is served as a
// sibling file at runtime — NOT bundled — so the build never needs deploy values
// and one `cdk deploy` produces a fully-configured site.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
