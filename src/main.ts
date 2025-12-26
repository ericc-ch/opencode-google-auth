import type { Plugin } from "@opencode-ai/plugin"

export const main: Plugin = async (ctx) => {
  return {
    auth: {
      provider: "gemini-cli",
      methods: [
        {
          type: "oauth",
          label: "OAuth with Google",
          authorize: async () => {
            return {
              callback,
              // idk theres more
            }
          },
        },
      ],
    },
  }
}
