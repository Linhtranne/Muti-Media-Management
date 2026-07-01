#!/usr/bin/env node
/**
 * run-tests.mjs
 * Windows-stable test runner. It explicitly lists compiled test files and
 * executes each file directly with Node instead of using the multi-file
 * `node --test` harness, which can fail with spawn EPERM in nested validation
 * flows on Windows.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testFiles = [
  "packages/shared-contracts/dist/__tests__/airtableContracts.test.js",
  "packages/shared-contracts/dist/__tests__/policyContracts.test.js",
  "packages/shared-contracts/dist/__tests__/mcpContracts.test.js",
  "packages/shared-contracts/dist/__tests__/facebookCommentContracts.test.js",
  "packages/shared-contracts/dist/__tests__/composer.test.js",
  "packages/shared-contracts/dist/__tests__/envelope.test.js",
  "packages/shared-contracts/dist/__tests__/directMessageContracts.test.js",
  "packages/policy-engine/dist/__tests__/policyEngine.test.js",
  "apps/facebook-mcp-server/dist/__tests__/secretStore.test.js",
  "apps/facebook-mcp-server/dist/__tests__/databaseSecretStore.test.js",
  "apps/facebook-mcp-server/dist/__tests__/validatePost.test.js",
  "apps/facebook-mcp-server/dist/__tests__/getRateLimitStatus.test.js",
  "apps/facebook-mcp-server/dist/__tests__/syncComments.test.js",
  "apps/orchestrator/dist/__tests__/redact.test.js",
  "apps/orchestrator/dist/__tests__/auditLog.test.js",
  "apps/orchestrator/dist/__tests__/airtableClient.test.js",
  "apps/orchestrator/dist/__tests__/airtableStatusPoller.test.js",
  "apps/orchestrator/dist/__tests__/channelAccountResolver.test.js",
  "apps/orchestrator/dist/__tests__/approvedPostWorker.test.js",
  "apps/orchestrator/dist/__tests__/notion-context-loader.test.js",
  "apps/orchestrator/dist/__tests__/prompt-registry.test.js",
  "apps/orchestrator/dist/__tests__/structuredValidator.test.js",
  "apps/orchestrator/dist/__tests__/commentRiskClassifier.test.js",
  "apps/orchestrator/dist/__tests__/facebookCommentSyncWorker.test.js",
  "apps/orchestrator/dist/__tests__/ai-composer-worker.test.js",
  "apps/orchestrator/dist/__tests__/aiComposerRabbitmqConsumer.test.js",
  "apps/orchestrator/dist/__tests__/policyRabbitmqConsumer.test.js",
  "apps/orchestrator/dist/__tests__/policyWorker.test.js",
  "apps/orchestrator/dist/__tests__/securityGate.test.js",
  "packages/shared-contracts/dist/__tests__/mcpPublishContracts.test.js",
  "apps/facebook-mcp-server/dist/__tests__/publishPost.test.js",
  "apps/orchestrator/dist/workers/__tests__/mcpPublishWorker.test.js",
  "apps/orchestrator/dist/workers/__tests__/mcpPublishScheduler.test.js",
  "apps/orchestrator/dist/queue/__tests__/mcpPublishRabbitmqConsumer.test.js",
  "packages/shared-contracts/dist/__tests__/slackCommandContracts.test.js",
  "apps/orchestrator/dist/__tests__/slackSignatureVerifier.test.js",
  "apps/orchestrator/dist/__tests__/slackCommandParser.test.js",
  "apps/orchestrator/dist/__tests__/slackCommandsRoute.test.js",
  "apps/orchestrator/dist/__tests__/slackPostApprovalWorker.test.js",
  "apps/facebook-mcp-server/dist/tools/__tests__/replyComment.test.js",
  "apps/facebook-mcp-server/dist/tools/__tests__/directMessage.test.js",
  "apps/orchestrator/dist/workers/__tests__/slackCommentActionWorker.test.js",
  "apps/orchestrator/dist/queue/__tests__/slackCommentActionRabbitmqConsumer.test.js",
  "packages/shared-contracts/dist/__tests__/mcp/facebookAuth.test.js",
  "apps/orchestrator/dist/__tests__/facebookAdminRoute.test.js",
  "packages/shared-contracts/dist/__tests__/reportsContracts.test.js",
  "apps/orchestrator/dist/__tests__/reportRepository.test.js",
  "apps/orchestrator/dist/__tests__/directMessageRepository.test.js",
  "apps/orchestrator/dist/__tests__/reportsRoute.test.js",
  // US-015: Unified DM tests
  "apps/orchestrator/dist/lib/__tests__/dmRedactor.test.js",
  "apps/orchestrator/dist/workers/__tests__/directMessageIngestWorker.test.js",
  "apps/orchestrator/dist/workers/__tests__/directMessageReplyWorker.test.js",
  "apps/orchestrator/dist/queue/__tests__/directMessageIngestRabbitmqConsumer.test.js",
  "apps/orchestrator/dist/queue/__tests__/directMessageReplyRabbitmqConsumer.test.js",

  // US-014 topology tests
  "apps/orchestrator/dist/queue/__tests__/topologyConfig.test.js",
  "apps/orchestrator/dist/queue/__tests__/rabbitmqPublisher.test.js",
  "apps/orchestrator/dist/queue/__tests__/rabbitmqConsumer.test.js",

  // AI-SDLC automation pilot
  "scripts/__tests__/ai-sdlc-check.test.mjs",
  "scripts/__tests__/ai-sdlc-validate.test.mjs",
  "scripts/__tests__/ai-sdlc-quality.test.mjs",
  "scripts/__tests__/ai-sdlc-trace.test.mjs",
  "scripts/__tests__/pre-commit-gate.test.mjs",
  "scripts/__tests__/pre-push-gate.test.mjs",
  "scripts/__tests__/story-detect.test.mjs",
  "scripts/__tests__/runtime-smoke.test.mjs",
  "scripts/__tests__/ci-story-detect.test.mjs"
];

const absoluteFiles = testFiles.map((f) => path.resolve(__dirname, f));

for (const file of absoluteFiles) {
  const result = spawnSync(process.execPath, ["--no-warnings", file], {
    stdio: "inherit",
    cwd: __dirname
  });

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`All ${absoluteFiles.length} test files passed.`);
