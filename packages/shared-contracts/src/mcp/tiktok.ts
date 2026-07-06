import { z } from "zod";

const FORBIDDEN_MCP_FIELDS = [
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "bearer",
  "apiKey",
  "api_key"
] as const;

const MAX_PHOTOS = 35;
const TIKTOK_VIDEO_TITLE_MAX = 2200;
const TIKTOK_PHOTO_TITLE_MAX = 90;
const TIKTOK_PHOTO_DESC_MAX = 4000;

function checkForbiddenMcpFields(value: Record<string, unknown>, ctx: z.RefinementCtx) {
  for (const field of FORBIDDEN_MCP_FIELDS) {
    if (Object.hasOwn(value, field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden MCP field: ${field}`,
        path: [field]
      });
    }
  }
}

export const ValidateTiktokPostInputSchema = z
  .object({
    variantRef: z.object({
      variantId: z.string().uuid(),
      bodyLength: z.number().int().nonnegative(),
      hashtagCount: z.number().int().nonnegative(),
      hasMedia: z.boolean(),
      ctaUrl: z.string().optional()
    }).strict(),
    channelAccountId: z.string().min(1),
    workspaceId: z.string().min(1),
    privacyLevel: z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]).optional()
  })
  .strict()
  .superRefine(checkForbiddenMcpFields);

export const PublishTiktokVideoInputSchema = z
  .object({
    jobRef: z.object({
      jobId: z.string().uuid()
    }).strict(),
    channelAccountId: z.string().min(1),
    workspaceId: z.string().min(1),
    content: z.object({
      title: z.string().min(1).max(TIKTOK_VIDEO_TITLE_MAX),
      videoUrl: z.string().url(),
      privacyLevel: z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]).optional(),
      disableComment: z.boolean().optional(),
      disableDuet: z.boolean().optional(),
      disableStitch: z.boolean().optional(),
      brandContentToggle: z.boolean(),
      brandOrganicToggle: z.boolean()
    }).strict()
  })
  .strict()
  .superRefine(checkForbiddenMcpFields);

export const PublishTiktokPhotoInputSchema = z
  .object({
    jobRef: z.object({
      jobId: z.string().uuid()
    }).strict(),
    channelAccountId: z.string().min(1),
    workspaceId: z.string().min(1),
    content: z.object({
      title: z.string().min(1).max(TIKTOK_PHOTO_TITLE_MAX).optional(),
      description: z.string().max(TIKTOK_PHOTO_DESC_MAX).optional(),
      imageUrls: z.array(z.string().url()).min(1).max(MAX_PHOTOS),
      privacyLevel: z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]).optional(),
      disableComment: z.boolean().optional(),
      brandContentToggle: z.boolean(),
      brandOrganicToggle: z.boolean(),
      autoAddMusic: z.boolean().optional()
    }).strict()
  })
  .strict()
  .superRefine(checkForbiddenMcpFields);

export const PublishTiktokResultSchema = z
  .object({
    passed: z.boolean(),
    tiktokRequestId: z.string().min(1).optional(),
    status: z.string().optional(),
    errors: z.array(
      z.object({
        code: z.string(),
        detail: z.string()
      }).strict()
    ).optional()
  })
  .strict();

export const GetTiktokPublishStatusInputSchema = z
  .object({
    channelAccountId: z.string().min(1),
    workspaceId: z.string().min(1),
    tiktokRequestId: z.string().min(1)
  })
  .strict()
  .superRefine(checkForbiddenMcpFields);

export const GetTiktokPublishStatusResultSchema = z
  .object({
    passed: z.boolean(),
    status: z.enum(["PROCESSING", "PUBLISHED", "FAILED"]),
    externalPostId: z.string().min(1).optional(),
    errors: z.array(
      z.object({
        code: z.string(),
        detail: z.string()
      }).strict()
    ).optional()
  })
  .strict();

export const QueryTiktokCreatorInfoInputSchema = z
  .object({
    channelAccountId: z.string().min(1),
    workspaceId: z.string().min(1)
  })
  .strict()
  .superRefine(checkForbiddenMcpFields);

export const QueryTiktokCreatorInfoResultSchema = z
  .object({
    passed: z.boolean(),
    creatorInfo: z.object({
      creator_avatar_url: z.string().optional(),
      creator_nickname: z.string().optional(),
      creator_username: z.string().optional(),
      privacy_level_options: z.array(z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"])),
      comment_disabled: z.boolean().optional(),
      duet_disabled: z.boolean().optional(),
      stitch_disabled: z.boolean().optional(),
      max_video_duration_in_seconds: z.number().int().optional()
    }).strict().optional(),
    errors: z.array(
      z.object({
        code: z.string(),
        detail: z.string()
      }).strict()
    ).optional()
  })
  .strict();

export type ValidateTiktokPostInput = z.infer<typeof ValidateTiktokPostInputSchema>;
export type PublishTiktokVideoInput = z.infer<typeof PublishTiktokVideoInputSchema>;
export type PublishTiktokPhotoInput = z.infer<typeof PublishTiktokPhotoInputSchema>;
export type PublishTiktokResult = z.infer<typeof PublishTiktokResultSchema>;
export type GetTiktokPublishStatusInput = z.infer<typeof GetTiktokPublishStatusInputSchema>;
export type GetTiktokPublishStatusResult = z.infer<typeof GetTiktokPublishStatusResultSchema>;
export type QueryTiktokCreatorInfoInput = z.infer<typeof QueryTiktokCreatorInfoInputSchema>;
export type QueryTiktokCreatorInfoResult = z.infer<typeof QueryTiktokCreatorInfoResultSchema>;
