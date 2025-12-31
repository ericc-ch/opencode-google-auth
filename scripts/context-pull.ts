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
  // {
  //   name: "opencode-google-antigravity-auth",
  //   remote: "https://github.com/shekohex/opencode-google-antigravity-auth.git",
  //   branch: "main",
  // },
  // {
  //   name: "opencode-antigravity-auth",
  //   remote: "https://github.com/NoeFabris/opencode-antigravity-auth.git",
  //   branch: "main",
  // },
  // {
  //   name: "vibeproxy",
  //   remote: "https://github.com/automazeio/vibeproxy.git",
  //   branch: "main",
  // },
]

for (const repo of repos) {
  const repoDir = path.join(contextRoot, repo.name)

  if (!fs.existsSync(repoDir)) {
    console.log(`Cloning ${repo.name}...`)
    await Bun.$`git clone --depth 1 --branch ${repo.branch} ${repo.remote} ${repoDir}`
  } else {
    console.log(`Pulling ${repo.name}...`)
    await Bun.$`git pull`.cwd(repoDir)
  }
}

console.log("Done!")
