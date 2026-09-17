import { defineConfig } from "tsup";

// GitHub Actions runs `node dist/index.js` directly with no install step,
// so this bundle must be fully self-contained — bundle every dependency,
// including workspace packages and @actions/*, rather than leaving them
// external the way the published `bugzero` CLI does.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node20",
  platform: "node",
  noExternal: [/.*/],
  dts: false,
  clean: true,
  minify: false,
});
