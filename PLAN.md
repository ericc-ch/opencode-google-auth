# Antigravity Plugin Implementation Plan

## Overview

Add an `antigravity` plugin export alongside the existing `geminiCli` plugin. The antigravity plugin enables access to both Gemini and Claude models through Google's Cloud Code Assist API.

## Background

### What is Antigravity?

Antigravity is Google DeepMind's internal codename for their advanced agentic coding assistant. It uses the same Cloud Code Assist API as Gemini CLI but with:

- Different OAuth credentials (client ID/secret)
- Additional OAuth scopes (`cclog`, `experimentsandconfigs`)
- Access to Claude models alongside Gemini models
- Different endpoints (daily sandbox as primary)

### How Model Names Work

The Cloud Code Assist API accepts model names directly in the request body:

```
{
  "project": "project-id",
  "model": "claude-sonnet-4-5-thinking",  <-- Real model name
  "request": { ... }
}
```

**Real model names sent to the API:**

- Gemini: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3-pro-preview`, etc.
- Claude: `claude-sonnet-4-5`, `claude-sonnet-4-5-thinking`, `claude-opus-4-5-thinking`

The `gemini-claude-*` prefix naming is only used by external proxies for routing purposes - it's NOT what the actual API expects.

### Request/Response Format

Both Gemini and Claude models use the **Google Generative AI format** when accessed through Cloud Code Assist:

- Request: `{ project, model, request: { contents, tools, generationConfig, ... } }`
- Response: `{ response: { candidates, usageMetadata, ... } }`

This means `@ai-sdk/google` works for BOTH model families. No need for `@ai-sdk/anthropic`.

---

## Implementation Tasks

### 1. Update Model Configuration

**File:** `src/lib/services/config.ts`

**Current (incorrect):**

```typescript
export const ANTIGRAVITY_MODELS = [
  ...GEMINI_CLI_MODELS,
  "claude-sonnet-4", // Wrong name
  "claude-sonnet-4-thinking", // Wrong name
] as const
```

**Changes:**

- Replace Claude model names with correct API names:
  - `claude-sonnet-4-5` (non-thinking variant)
  - `claude-sonnet-4-5-thinking` (thinking variant)
  - `claude-opus-4-5-thinking` (opus thinking variant)
- Keep all Gemini models from `GEMINI_CLI_MODELS`

**Note:** The config already has correct `ANTIGRAVITY_CONFIG` with proper client ID, secret, scopes, endpoints, and headers.

---

### 2. Add Antigravity Plugin Export

**File:** `src/main.ts`

**Changes:**

1. Import `ANTIGRAVITY_CONFIG` and `ANTIGRAVITY_MODELS` from config
2. Add new `antigravity` plugin export (copy structure from `geminiCli`)
3. Replace all `GEMINI_CLI_CONFIG` references with `ANTIGRAVITY_CONFIG`
4. Replace model filtering to use `ANTIGRAVITY_MODELS`

**Key differences from geminiCli:**

- Uses `ANTIGRAVITY_CONFIG.SERVICE_NAME` ("antigravity")
- Uses `ANTIGRAVITY_CONFIG.ENDPOINTS[0]` (daily sandbox)
- Uses `ANTIGRAVITY_CONFIG.HEADERS` (antigravity user-agent)
- Filters models using `ANTIGRAVITY_MODELS` (includes Claude)

**Model definitions handling:**

- Gemini models: Fetched from models.dev API (existing `fetchModels` logic)
- Claude models: May need fallback definitions if not in models.dev `google` section
- Consider adding hardcoded Claude model metadata as fallback

---

### 3. Claude-Specific Request Transformations (Optional Enhancement)

**File:** `src/transform/request.ts`

Claude models may work without modifications, but for full compatibility consider adding:

#### 3a. Tool Config Mode

When model is Claude, set:

```
toolConfig.functionCallingConfig.mode = "VALIDATED"
```

#### 3b. Thinking Config Keys

Claude uses snake_case for thinking config:

- `thinkingBudget` → `thinking_budget`
- `includeThoughts` → `include_thoughts`

#### 3c. Max Output Tokens

For Claude thinking models, ensure `maxOutputTokens >= thinking_budget` (default: 64000)

#### 3d. Model Detection Helper

Add helper function:

```typescript
function isClaudeModel(model: string): boolean {
  return model.toLowerCase().includes("claude")
}
```

**Decision:** Start without these transforms. Add them if Claude models don't work correctly.

---

### 4. Response Transformation

**File:** `src/transform/response.ts` and `src/transform/stream.ts`

**No changes needed.** Both Gemini and Claude use the same response format through Cloud Code Assist:

- Response wrapped in `{ response: ... }` envelope
- Same `candidates[].content.parts[]` structure
- Same `usageMetadata` format

The existing transform that unwraps `response` field works for both.

---

## File Changes Summary

| File                         | Action   | Description                                              |
| ---------------------------- | -------- | -------------------------------------------------------- |
| `src/lib/services/config.ts` | Modify   | Fix `ANTIGRAVITY_MODELS` with correct Claude model names |
| `src/main.ts`                | Modify   | Add `antigravity` plugin export                          |
| `src/transform/request.ts`   | Optional | Add Claude-specific transforms if needed                 |

---

## Testing Plan

### 1. Basic Gemini Model Test

- Authenticate with antigravity provider
- Send request to `gemini-2.5-flash`
- Verify response is received and parsed correctly

### 2. Claude Model Test

- Send request to `claude-sonnet-4-5`
- Verify model name is sent correctly in request body
- Verify response is parsed correctly

### 3. Claude Thinking Model Test

- Send request to `claude-sonnet-4-5-thinking`
- Verify thinking config is passed correctly
- Verify thinking tokens appear in response

### 4. Tool Usage Test

- Send request with tools to Claude model
- Verify tool calls work correctly

---

## Reference Code Locations

### opencode-antigravity-auth (TypeScript reference)

- `src/constants.ts` - Config values, headers, endpoints
- `src/plugin/transform/model-resolver.ts` - Model name resolution and aliases
- `src/plugin/transform/claude.ts` - Claude-specific transforms
- `src/plugin/request.ts` - Full request preparation logic

### cli-proxy-api (Go reference)

- `internal/runtime/executor/antigravity_executor.go` - Request handling
- `internal/translator/antigravity/claude/` - Claude format translation
- `internal/registry/model_definitions.go` - Model configurations

---

## Questions to Resolve

1. **Claude model metadata**: Should we add fallback model definitions for Claude models, or rely on models.dev having them?

2. **Thinking config format**: Does OpenCode's AI SDK already handle the `thinkingBudget` → `thinking_budget` conversion for Claude, or do we need to add it?

3. **Endpoint selection**: Should we use the daily sandbox endpoint (like the reference) or production endpoint for stability?

---

## Implementation Order

1. **Phase 1: Basic Implementation**
   - Update `ANTIGRAVITY_MODELS` in config.ts
   - Add `antigravity` plugin export in main.ts
   - Test with Gemini models

2. **Phase 2: Claude Support**
   - Test Claude models without modifications
   - Add Claude transforms if needed
   - Verify thinking models work

3. **Phase 3: Refinement**
   - Add Claude model fallback definitions
   - Handle edge cases
   - Add error handling for model-specific issues
