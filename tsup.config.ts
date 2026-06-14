import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.tsx" },
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // Keep deps external — they resolve from the package's own node_modules
  // (provided by `npm install` / `npm link`). Avoids bundling ink's optional
  // react-devtools-core dependency.
  external: ["react-devtools-core"],
});
