import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env") });

export default {
  test: {
    include: ["test/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/specs/**", "**/node_modules/**", "**/.ai-workspace/**"],
    passWithNoTests: true,
  },
};
