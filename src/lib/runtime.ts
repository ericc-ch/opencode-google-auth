import { ManagedRuntime } from "effect"
import { GeminiOAuth } from "./auth/gemini"

export const Runtime = ManagedRuntime.make(GeminiOAuth.Default)
