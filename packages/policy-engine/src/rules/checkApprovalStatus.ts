import type { PolicyCheck, PolicyVariantInput } from "../types.js";
import { blocked, passed } from "./helpers.js";

export function checkApprovalStatus(variant: Pick<PolicyVariantInput, "approvalStatus">): PolicyCheck {
  if (variant.approvalStatus !== "needs_review") {
    return blocked("checkApprovalStatus", "MISSING_APPROVAL", "Variant is not in the approved review-ready state");
  }

  return passed("checkApprovalStatus");
}

