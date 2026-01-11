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

    if (parsed.response !== undefined) {
      const { response: responseData, ...rest } = parsed
      return new Response(JSON.stringify({ ...rest, ...responseData }), {
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
