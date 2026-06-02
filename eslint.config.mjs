import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import unusedImports from "eslint-plugin-unused-imports";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

const tsFiles = ["**/*.ts", "**/*.tsx"];
const jsFiles = ["**/*.js", "**/*.mjs", "**/*.cjs"];
const testFiles = [
  "**/__tests__/**/*.ts",
  "**/*.test.ts",
  "**/*.spec.ts"
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/*.tsbuildinfo",
      "node_modules/**",
      "coverage/**",
      "db/migrations/**",
      "apps/orchestrator/scripts/**",
      "eslint.config.mjs"
    ]
  },
  js.configs.recommended,
  {
    files: jsFiles,
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly"
      }
    }
  },
  {
    files: tsFiles,
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked
    ],
    languageOptions: {
      parserOptions: {
        project: [
          "./packages/shared-contracts/tsconfig.json",
          "./packages/policy-engine/tsconfig.json",
          "./apps/orchestrator/tsconfig.json",
          "./apps/facebook-mcp-server/tsconfig.json"
        ],
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      boundaries,
      "unused-imports": unusedImports,
      unicorn
    },
    settings: {
      "boundaries/elements": [
        { type: "apps", pattern: "apps/*/src/**" },
        { type: "packages", pattern: "packages/*/src/**" },
        { type: "docs", pattern: "docs/**" },
        { type: "db", pattern: "db/**" }
      ]
    },
    rules: {
      "boundaries/dependencies": ["error", {
        default: "disallow",
        rules: [
          { from: "apps", allow: ["apps", "packages"] },
          { from: "packages", allow: ["packages"] }
        ]
      }],
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": ["warn", {
        args: "after-used",
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_"
      }],
      "unicorn/filename-case": ["error", {
        cases: {
          kebabCase: true,
          camelCase: true
        },
        ignore: [
          "^[A-Z]+-[0-9]+.*\\.md$",
          "^AGENTS\\.md$"
        ]
      }],
      "@typescript-eslint/consistent-type-imports": ["error", {
        prefer: "type-imports",
        fixStyle: "inline-type-imports"
      }],
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "default",
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
          leadingUnderscore: "allow"
        },
        {
          selector: ["typeLike", "enumMember"],
          format: ["PascalCase", "UPPER_CASE"]
        },
        {
          selector: ["objectLiteralProperty", "typeProperty"],
          format: null
        },
        {
          selector: "variable",
          modifiers: ["destructured"],
          format: null
        }
      ],
      "no-console": ["warn", {
        allow: ["warn", "error"]
      }],
      "no-magic-numbers": ["off", {
        ignore: [-1, 0, 1, 2, 3, 4, 5, 10, 100, 200, 201, 400, 401, 403, 404, 409, 422, 429, 500],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        enforceConst: true
      }],
      "no-restricted-syntax": [
        "warn",
        {
          selector: "Literal[value=/^(sk-|xox[baprs]-|EAA|Bearer\\s+)/]",
          message: "Do not hard-code secrets, tokens, or bearer credentials."
        }
      ]
    }
  },
  {
    files: testFiles,
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-function": "off",
      "unused-imports/no-unused-vars": "off",
      "no-restricted-syntax": "off",
      "no-magic-numbers": "off"
    }
  }
);
