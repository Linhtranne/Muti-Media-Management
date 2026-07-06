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
const generatedAndConfigFiles = [
  "**/*.config.ts",
  "**/*.config.mjs",
  "**/*.config.cjs",
  "**/eslint.config.mjs"
];
const commonAllowedNumbers = [
  -1,
  0,
  1,
  2,
  3,
  4,
  5,
  10,
  100,
  200,
  201,
  204,
  300,
  301,
  302,
  304,
  400,
  401,
  403,
  404,
  409,
  422,
  429,
  500,
  1000
];
const colorLiteralPattern = /^(?:#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8})|(?:rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\()/;
const colorTextPattern = /#[\da-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\(/;
const hardTextPattern = /^[A-Za-z][A-Za-z0-9,.;:!?()'\-]+(?:\s+[A-Za-z0-9,.;:!?()'\-]+){2,}$/;

function isImportOrExportLiteral(node) {
  return node.parent?.type === "ImportDeclaration" ||
    node.parent?.type === "ExportNamedDeclaration" ||
    node.parent?.type === "ExportAllDeclaration";
}

function isUpperCaseConstantName(name) {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}

function isAllowedTextResource(node) {
  let current = node.parent;
  while (current) {
    if (
      current.type === "VariableDeclarator" &&
      current.id?.type === "Identifier" &&
      isUpperCaseConstantName(current.id.name)
    ) {
      return true;
    }
    if (
      current.type === "PropertyDefinition" &&
      current.key?.type === "Identifier" &&
      isUpperCaseConstantName(current.key.name)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function getTextExpressionNode(node) {
  return node.parent?.type === "TemplateLiteral" ? node.parent : node;
}

function isLoggerMessage(node) {
  const expressionNode = getTextExpressionNode(node);
  const callExpression = expressionNode.parent?.type === "CallExpression" ? expressionNode.parent : expressionNode.parent?.parent;
  if (callExpression?.type !== "CallExpression" || callExpression.arguments?.[0] !== expressionNode) {
    return false;
  }
  const callee = callExpression.callee;
  return callee?.type === "MemberExpression" &&
    callee.property?.type === "Identifier" &&
    ["debug", "error", "info", "log", "warn"].includes(callee.property.name);
}

function isErrorConstructorMessage(node) {
  const expressionNode = getTextExpressionNode(node);
  let current = expressionNode.parent;
  while (current) {
    if (
      current.type === "NewExpression" &&
      current.callee?.type === "Identifier" &&
      current.callee.name.endsWith("Error")
    ) {
      return true;
    }
    current = current.parent;
  }
  const callExpression = expressionNode.parent?.type === "NewExpression" ? expressionNode.parent : expressionNode.parent?.parent;
  return callExpression?.type === "NewExpression" &&
    callExpression.callee?.type === "Identifier" &&
    callExpression.callee.name.endsWith("Error") &&
    callExpression.arguments?.includes(expressionNode);
}

function isSchemaOrToolMetadataText(node) {
  const expressionNode = getTextExpressionNode(node);
  let current = expressionNode.parent;
  let property;
  while (current) {
    if (current.type === "Property") {
      property = current;
      break;
    }
    if (current.type === "CallExpression" || current.type === "ExpressionStatement") {
      break;
    }
    current = current.parent;
  }
  const propertyName = property?.key?.type === "Identifier" ? property.key.name : undefined;
  return propertyName !== undefined && [
    "action",
    "alert_type",
    "body",
    "body_redacted",
    "channel_id",
    "detail",
    "entity_type",
    "error",
    "eventType",
    "event_type",
    "idempotency_key",
    "queueName",
    "reason",
    "severity",
    "status",
    "type",
    "description",
    "message",
    "shortDescription",
    "usageHint"
  ].includes(propertyName);
}

function isOperationalGuardLabel(node) {
  const expressionNode = getTextExpressionNode(node);
  const callExpression = expressionNode.parent?.type === "CallExpression" ? expressionNode.parent : expressionNode.parent?.parent;
  if (callExpression?.type !== "CallExpression" || !callExpression.arguments?.includes(expressionNode)) {
    return false;
  }
  const callee = callExpression.callee;
  return callee?.type === "Identifier" && [
    "assertNoForbiddenFields",
    "checkIdempotency",
    "markIdempotencySucceeded"
  ].includes(callee.name);
}

function isNonUserFacingCallArgument(node) {
  const expressionNode = getTextExpressionNode(node);
  const callExpression = expressionNode.parent?.type === "CallExpression" ? expressionNode.parent : expressionNode.parent?.parent;
  if (callExpression?.type !== "CallExpression" || !callExpression.arguments?.includes(expressionNode)) {
    return false;
  }
  const callee = callExpression.callee;
  if (callee?.type === "MemberExpression" && callee.property?.type === "Identifier") {
    return !["json", "send"].includes(callee.property.name);
  }
  return true;
}

function shouldIgnoreHardcodedText(node) {
  return isImportOrExportLiteral(node) ||
    isAllowedTextResource(node) ||
    isLoggerMessage(node) ||
    isErrorConstructorMessage(node) ||
    isSchemaOrToolMetadataText(node) ||
    isOperationalGuardLabel(node) ||
    isNonUserFacingCallArgument(node);
}

const cleanCodePlugin = {
  rules: {
    "no-hardcoded-color": {
      meta: {
        type: "problem",
        messages: {
          hardcodedColor: "Do not hard-code color values. Move colors to design tokens or config constants."
        }
      },
      create(context) {
        return {
          Literal(node) {
            if (typeof node.value === "string" && colorLiteralPattern.test(node.value)) {
              context.report({ node, messageId: "hardcodedColor" });
            }
          },
          TemplateElement(node) {
            if (colorTextPattern.test(node.value.raw)) {
              context.report({ node, messageId: "hardcodedColor" });
            }
          }
        };
      }
    },
    "no-hardcoded-text": {
      meta: {
        type: "suggestion",
        messages: {
          hardcodedText: "Avoid hard-coded user-facing text. Move display/copy text to constants, templates, or localization resources."
        }
      },
      create(context) {
        return {
          Literal(node) {
            if (
              typeof node.value === "string" &&
              hardTextPattern.test(node.value) &&
              !shouldIgnoreHardcodedText(node)
            ) {
              context.report({ node, messageId: "hardcodedText" });
            }
          },
          TemplateElement(node) {
            if (hardTextPattern.test(node.value.raw.trim()) && !shouldIgnoreHardcodedText(node)) {
              context.report({ node, messageId: "hardcodedText" });
            }
          }
        };
      }
    }
  }
};

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
    files: ["**/*.cjs"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
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
          "./apps/facebook-mcp-server/tsconfig.json",
          "./apps/tiktok-mcp-server/tsconfig.json"
        ],
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      boundaries,
      "unused-imports": unusedImports,
      unicorn,
      "clean-code": cleanCodePlugin
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
          { from: { type: "apps" }, allow: { to: { type: ["apps", "packages"] } } },
          { from: { type: "packages" }, allow: { to: { type: "packages" } } }
        ]
      }],
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": ["warn", {
        args: "after-used",
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_"
      }],
      "unicorn/filename-case": ["off", {
        cases: {
          kebabCase: true
        },
        ignore: [
          "^README\\.md$",
          "^[A-Z]+-[0-9]+.*\\.md$",
          "^AGENTS\\.md$",
          "^CLAUDE\\.md$",
          "^DESIGN\\.md$",
          "^PRODUCT\\.md$",
          "^SKILL\\.md$"
        ]
      }],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/consistent-type-imports": ["error", {
        prefer: "type-imports",
        fixStyle: "inline-type-imports"
      }],
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
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
      "no-magic-numbers": ["error", {
        ignore: commonAllowedNumbers,
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        ignoreClassFieldInitialValues: true,
        ignoreEnums: true,
        ignoreNumericLiteralTypes: true,
        detectObjects: false,
        enforceConst: false
      }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^(sk-|xox[baprs]-|EAA|Bearer\\s+)/]",
          message: "Do not hard-code secrets, tokens, or bearer credentials."
        }
      ],
      "clean-code/no-hardcoded-color": "error",
      "clean-code/no-hardcoded-text": "error"
    }
  },
  {
    files: generatedAndConfigFiles,
    rules: {
      "no-magic-numbers": "off",
      "no-restricted-syntax": "off",
      "unicorn/filename-case": "off"
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
      "clean-code/no-hardcoded-text": "off",
      "clean-code/no-hardcoded-color": "off",
      "no-restricted-syntax": "off",
      "no-magic-numbers": "off"
    }
  }
);
