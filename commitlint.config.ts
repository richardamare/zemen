import type { UserConfig } from "@commitlint/types"

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["web", "server", "domain", "contract", "infra", "ci", "deps", "deps-dev", "docs", "repo"]
    ]
  }
}

export default config
