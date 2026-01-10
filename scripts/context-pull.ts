#!/usr/bin/env bun

import path from "node:path"
import fs from "node:fs"

const rootDir = path.join(import.meta.dir, "..")
const contextRoot = path.join(rootDir, ".context")

if (!fs.existsSync(contextRoot)) {
  fs.mkdirSync(contextRoot)
}

export const repos = [
  {
    name: "opencode",
    remote: "https://github.com/sst/opencode.git",
    branch: "dev",
  },
  {
    name: "effect",
    remote: "https://github.com/Effect-TS/effect.git",
    branch: "main",
  },
  {
    name: "gemini-cli",
    remote: "https://github.com/google-gemini/gemini-cli.git",
    branch: "main",
  },
  {
    name: "opencode-gemini-auth",
    remote: "https://github.com/jenslys/opencode-gemini-auth.git",
    branch: "main",
  },
  {
    name: "opencode-antigravity-auth",
    remote: "https://github.com/NoeFabris/opencode-antigravity-auth.git",
    branch: "main",
  },
  {
    name: "cli-proxy-api",
    remote: "https://github.com/router-for-me/CLIProxyAPI.git",
    branch: "main",
  },
]

const operations = repos.map(async (repo) => {
  const repoDir = path.join(contextRoot, repo.name)

  if (!fs.existsSync(repoDir)) {
    console.log(`Cloning ${repo.name}...`)
    await Bun.$`git clone --depth 1 --branch ${repo.branch} ${repo.remote} ${repoDir}`.quiet()
    console.log(`✓ Cloned ${repo.name}`)
  } else {
    console.log(`Pulling ${repo.name}...`)
    await Bun.$`git pull`.cwd(repoDir).quiet()
    console.log(`✓ Pulled ${repo.name}`)
  }
})

const results = await Promise.allSettled(operations)

const failures = results.filter((r) => r.status === "rejected")
if (failures.length > 0) {
  console.error(`\n${failures.length} operation(s) failed:`)
  for (const f of failures) {
    console.error(`  - ${(f as PromiseRejectedResult).reason.message}`)
  }
}

console.log("Done!")
