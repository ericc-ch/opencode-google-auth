import { defineConfig, type UserConfigExport } from "tsdown"

const config: UserConfigExport = defineConfig({
  entry: ["src/main.ts"],

  target: "esnext",
  platform: "node",

  unbundle: true,
  sourcemap: true,
})

export default config
