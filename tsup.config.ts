import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node20",
  },
  {
    entry: { "cli/main": "src/cli/main.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
