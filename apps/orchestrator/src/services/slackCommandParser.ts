const SLACK_COMMAND_MESSAGE_MAX_LENGTH = 2000;

export type ParsedSlackCommand =
  | {
      error: false;
      action: "approve";
      postId: string;
      reason: null;
    }
  | {
      error: false;
      action: "reject";
      postId: string;
      reason: string;
    }
  | {
      error: false;
      action: "reply";
      interactionId: string;
      message: string;
    }
  | {
      error: false;
      action: "reply_dm";
      conversationId: string;
      message: string;
    }
  | {
      error: false;
      action: "escalate";
      interactionId: string;
      reason: string | null;
    };

export interface ParseError {
  error: true;
  errorCode: string;
  message: string;
}

export class SlackCommandParser {
  constructor(private readonly maxReasonLength = 500) {}

  parse(command: string, text: string): ParsedSlackCommand | ParseError {
    const trimmedCommand = command.trim();
    const trimmedText = text.trim();

    if (
      trimmedCommand !== "/approve_post" &&
      trimmedCommand !== "/reject_post" &&
      trimmedCommand !== "/reply_comment" &&
      trimmedCommand !== "/reply_dm" &&
      trimmedCommand !== "/escalate"
    ) {
      return { error: true, errorCode: "UNKNOWN_COMMAND", message: "Unknown command" };
    }

    if (!trimmedText) {
      if (trimmedCommand === "/approve_post" || trimmedCommand === "/reject_post") {
        return { error: true, errorCode: "MISSING_POST_ID", message: "Post ID is required" };
      } else if (trimmedCommand === "/reply_dm") {
        return { error: true, errorCode: "MISSING_CONVERSATION_ID", message: "Conversation ID is required" };
      } else {
        return { error: true, errorCode: "MISSING_INTERACTION_ID", message: "Interaction ID is required" };
      }
    }

    // First token is the target ID (post ID or interaction ID)
    const firstSpaceIndex = trimmedText.indexOf(" ");
    const hasRemainingText = firstSpaceIndex !== -1;

    const rawId = hasRemainingText ? trimmedText.substring(0, firstSpaceIndex) : trimmedText;
    const rawRemainingText = hasRemainingText ? trimmedText.substring(firstSpaceIndex + 1).trim() : "";

    if (trimmedCommand === "/approve_post" || trimmedCommand === "/reject_post") {
      // Sanitize post_id: alphanumeric, dashes, underscores
      const postId = rawId.replace(/[^a-zA-Z0-9_-]/g, "");

      if (!postId) {
        return { error: true, errorCode: "MISSING_POST_ID", message: "Post ID is invalid or missing" };
      }

      if (trimmedCommand === "/approve_post") {
        return { error: false, action: "approve", postId, reason: null };
      }

      // Must be /reject_post
      if (!rawRemainingText) {
        return { error: true, errorCode: "MISSING_REASON", message: "Reason is required for rejecting a post" };
      }

      if (rawRemainingText.length > this.maxReasonLength) {
        return {
          error: true,
          errorCode: "REASON_TOO_LONG",
          message: `Reason must be less than ${this.maxReasonLength} characters`,
        };
      }

      return { error: false, action: "reject", postId, reason: rawRemainingText };
    }

    // It is /reply_comment or /escalate
    // Verify interaction_id is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const interactionId = rawId;

    if (!uuidRegex.test(interactionId)) {
      return { error: true, errorCode: "INVALID_UUID", message: "Interaction ID must be a valid UUID" };
    }

    if (trimmedCommand === "/reply_comment") {
      if (!rawRemainingText) {
        return { error: true, errorCode: "MISSING_MESSAGE", message: "Message is required for replying to a comment" };
      }
      if (rawRemainingText.length > SLACK_COMMAND_MESSAGE_MAX_LENGTH) {
        return { error: true, errorCode: "MESSAGE_TOO_LONG", message: "Message must be less than 2000 characters" };
      }
      return { error: false, action: "reply", interactionId, message: rawRemainingText };
    }

    if (trimmedCommand === "/reply_dm") {
      if (!uuidRegex.test(rawId)) {
        return { error: true, errorCode: "INVALID_UUID", message: "Conversation ID must be a valid UUID" };
      }
      if (!rawRemainingText) {
        return { error: true, errorCode: "MISSING_MESSAGE", message: "Message is required for replying to a DM" };
      }
      if (rawRemainingText.length > SLACK_COMMAND_MESSAGE_MAX_LENGTH) {
        return { error: true, errorCode: "MESSAGE_TOO_LONG", message: "Message must be less than 2000 characters" };
      }
      return { error: false, action: "reply_dm", conversationId: rawId, message: rawRemainingText };
    }

    if (trimmedCommand === "/escalate") {
      if (rawRemainingText.length > this.maxReasonLength) {
        return {
          error: true,
          errorCode: "REASON_TOO_LONG",
          message: `Reason must be less than ${this.maxReasonLength} characters`,
        };
      }
      return { error: false, action: "escalate", interactionId, reason: rawRemainingText || null };
    }

    return { error: true, errorCode: "UNKNOWN_COMMAND", message: "Unknown command" };
  }
}
