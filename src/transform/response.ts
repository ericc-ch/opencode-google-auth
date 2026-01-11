export const transformNonStreamingResponse = async (
  response: Response,
): Promise<Response> => {
  const contentType = response.headers.get("content-type")

  if (!contentType?.includes("application/json")) {
    return response
  }

  try {
    const cloned = response.clone()
    const parsed = (await cloned.json()) as { response?: unknown }

    // Unwrap { response: X } -> X
    if (parsed.response !== undefined) {
      return new Response(JSON.stringify(parsed.response), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
  } catch {
    // Return original if parse fails
  }

  return response
}
