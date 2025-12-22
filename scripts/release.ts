#!/usr/bin/env bun

import { $ } from "bun"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"

const argv = await yargs(hideBin(process.argv))
  .option("dry-run", {
    type: "boolean",
    description: "Print release notes without creating release",
    default: false,
  })
  .parse()

// Get current tag
const currentTag = await $`git describe --tags --exact-match HEAD`.text()
if (!currentTag.trim()) {
  console.error("No tag found on HEAD")
  process.exit(1)
}

// Get previous tag
const prevTagResult = await $`git describe --tags --abbrev=0 ${currentTag.trim()}^`
  .nothrow()
  .quiet()
const prevTag = prevTagResult.exitCode === 0 ? prevTagResult.text() : null

// Get commits - format: "- <subject> (@<author>)"
const logRange = prevTag ? `${prevTag.trim()}..${currentTag.trim()}` : currentTag.trim()
const format = "- %s (@%an)"
const commits = await $`git log ${logRange} --pretty=format:${format} --no-merges`.text()
const notes = commits.trim() || "Initial release"

if (argv.dryRun) {
  console.log(`Tag: ${currentTag.trim()}`)
  console.log(`Previous tag: ${prevTag?.trim() ?? "none"}`)
  console.log(`\nRelease notes:\n${notes}`)
  process.exit(0)
}

// Create release
await $`gh release create ${currentTag.trim()} --title ${currentTag.trim()} --notes ${notes}`
