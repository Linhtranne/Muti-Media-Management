/**
 * @file commentRiskClassifier.ts
 * Implements risk classification for incoming Facebook comments.
 */

export class CommentRiskClassifier {
  private crisisKeywords: string[];

  constructor() {
    // Default crisis keywords if not configured
    const defaultKeywords = "scam,fake,lawsuit,sue,fraud,refund";
    const envKeywords = process.env.CRISIS_KEYWORDS || defaultKeywords;
    
    // Split by comma, trim whitespace, and filter out empty strings
    this.crisisKeywords = envKeywords
      .split(',')
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0);
  }

  /**
   * Classifies a comment as 'CRISIS' or 'NORMAL' based on keyword matching.
   * Matching is case-insensitive.
   * 
   * @param commentBody The text body of the comment
   * @returns "CRISIS" | "NORMAL"
   */
  public classify(commentBody: string): "CRISIS" | "NORMAL" {
    if (!commentBody || commentBody.trim().length === 0) {
      return "NORMAL";
    }

    const normalizedBody = commentBody.toLowerCase();

    for (const keyword of this.crisisKeywords) {
      // Basic substring matching. Could be upgraded to regex word boundary (\b) 
      // if substring matching produces too many false positives.
      if (normalizedBody.includes(keyword)) {
        return "CRISIS";
      }
    }

    return "NORMAL";
  }
}
