/**
 * Transform module type definitions
 */

export type TransformRequestParams = {
  readonly input: Parameters<typeof fetch>[0]
  readonly init: Parameters<typeof fetch>[1]
  readonly accessToken: string
  readonly projectId: string
}

export type TransformRequestResult = {
  readonly input: string
  readonly init: RequestInit
  readonly streaming: boolean
}
