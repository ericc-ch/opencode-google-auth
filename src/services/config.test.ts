import { describe, expect, it } from "bun:test"
import { CODE_ASSIST_VERSION } from "./config"

describe("Config Issues", () => {
  it("should identify the URL version mismatch", () => {
    // The test URLs use v1beta but the code uses v1internal
    const testVersion = "v1beta" 
    const codeVersion = CODE_ASSIST_VERSION
    
    console.log(`Test expects: ${testVersion}`)
    console.log(`Code uses: ${codeVersion}`)
    
    // This should fail, showing the version mismatch
    expect(codeVersion).not.toBe(testVersion)
  })
})
