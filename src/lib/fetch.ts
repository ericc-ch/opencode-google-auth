import { Effect } from "effect"

export const fetchEffect = Effect.fn(function* (
  input: string | URL | Request,
  init?: BunFetchRequestInit,
) {
  // const openCode = yield* OpenCodeContext

  yield* Effect.log(input)
  yield* Effect.log(init)

  return Response.json({ message: "LMAO" })
})
