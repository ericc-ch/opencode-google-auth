#!/usr/bin/env bun
import path from "node:path"
import fs from "node:fs/promises"
import { geminiCliConfig } from "../src/lib/services/config"

const rootDir = path.join(import.meta.dir, "..")
const distDir = path.join(rootDir, "dist")
const pluginDir = path.join(rootDir, ".opencode", "plugin")

await fs.rm(pluginDir, { recursive: true, force: true })
await fs.mkdir(pluginDir, { recursive: true })

const src = path.join(distDir, "main.mjs")
const dest = path.join(pluginDir, `${geminiCliConfig().SERVICE_NAME}.js`)

await fs.copyFile(src, dest)
console.log(`Copied ${src} → ${dest}`)
