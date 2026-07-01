import type { PolicyCheck, PolicyWorkspaceConfigInput } from "../types.js";
import { blocked, passed } from "./helpers.js";

export function checkAutoPublishConfig(config: PolicyWorkspaceConfigInput): PolicyCheck[] {
  const checks: PolicyCheck[] = [];

  if (config.autoPublishEnabled !== true) {
    checks.push(blocked("checkAutoPublishConfig.autoPublishEnabled", "AUTO_PUBLISH_DISABLED", "Workspace auto publish is disabled"));
  } else {
    checks.push(passed("checkAutoPublishConfig.autoPublishEnabled"));
  }

  if (config.autoApproveEnabled !== true) {
    checks.push(blocked("checkAutoPublishConfig.autoApproveEnabled", "AUTO_APPROVE_DISABLED", "Workspace auto approve is disabled"));
  } else {
    checks.push(passed("checkAutoPublishConfig.autoApproveEnabled"));
  }

  return checks;
}

