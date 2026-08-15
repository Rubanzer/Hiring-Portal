import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 ships flat config directly, so no FlatCompat wrapper.
 */
const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: ["src/generated/**", ".next/**", "node_modules/**", "next-env.d.ts"],
  },
  {
    /**
     * Tenant isolation, enforced by the linter.
     *
     * Agency-facing routes must go through lib/tenancy, which injects `agencyId` from the
     * session on every query. Importing Prisma directly here is how one agency ends up
     * reading another's candidates, so it's a build failure rather than a code-review note.
     */
    files: ["src/app/(agency)/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/db",
              message:
                "Agency routes must not query Prisma directly. Use lib/tenancy, which scopes every query to the session's agencyId.",
            },
          ],
          patterns: [
            {
              group: ["**/lib/db", "**/generated/prisma/**"],
              message:
                "Agency routes must not query Prisma directly. Use lib/tenancy, which scopes every query to the session's agencyId.",
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
