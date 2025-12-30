#!/usr/bin/env bun
import path from "node:path"
import fs from "node:fs/promises"

const rootDir = path.join(import.meta.dir, "..")
const distDir = path.join(rootDir, "dist")
const pluginDir = path.join(rootDir, ".opencode", "plugin")

await fs.rm(pluginDir, { recursive: true, force: true })
await fs.mkdir(pluginDir, { recursive: true })

const files = await fs.readdir(distDir)

for (const file of files) {
  if (!file.endsWith(".mjs")) continue

  const src = path.join(distDir, file)
  const destFile = file.replace(/\.mjs$/, ".js")
  const dest = path.join(pluginDir, destFile)

  await fs.copyFile(src, dest)
  console.log(`Copied ${src} → ${dest}`)
}
