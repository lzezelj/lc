import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import prettierRecommended from "eslint-plugin-prettier/recommended";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  prettierRecommended,
  globalIgnores([".next/**", "node_modules/**"]),
]);
