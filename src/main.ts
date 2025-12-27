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
              url: "https://developers.google.com/gemini-code-assist/auth_success_gemini",
              method: "auto",
              callback: async () => {},
            }
          },
        },
      ],
    },
  }
}
