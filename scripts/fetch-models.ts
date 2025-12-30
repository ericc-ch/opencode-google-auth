#!/usr/bin/env bun

import path from "node:path"

const MODELS_DEV_URL = "https://models.dev/api.json"

const SUPPORTED_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
]

const rootDir = path.join(import.meta.dir, "..")
const outputPath = path.join(rootDir, "src", "models.json")

console.log("Fetching models from models.dev...")

const response = await fetch(MODELS_DEV_URL)
if (!response.ok) {
  console.error(
    `Failed to fetch models.dev: ${response.status} ${response.statusText}`,
  )
  process.exit(1)
}

const data = (await response.json()) as Record<string, unknown>
const googleConfig = data.google as {
  models: Record<string, unknown>
  [key: string]: unknown
}

if (!googleConfig) {
  console.error("No google provider found in models.dev")
  process.exit(1)
}

const filteredModels = Object.fromEntries(
  Object.entries(googleConfig.models).filter(([key]) =>
    SUPPORTED_MODELS.includes(key),
  ),
)

const output = {
  ...googleConfig,
  models: filteredModels,
}

await Bun.write(outputPath, JSON.stringify(output, null, 2))

console.log(
  `Written ${Object.keys(filteredModels).length} models to ${outputPath}`,
)
