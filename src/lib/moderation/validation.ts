import { z } from "zod";

export const reportStatusSchema = z.enum([
  "pending",
  "investigating",
  "resolved",
  "dismissed",
]);

export const reportCategorySchema = z.enum([
  "harassment",
  "threats",
  "spam",
  "inappropriate_content",
  "impersonation",
  "other",
]);

export const moderationActionTypeSchema = z.enum([
  "warn_user",
  "suspend_user",
  "reactivate_user",
]);

export const resolveReportSchema = z.object({
  reportId: z.string().uuid("Invalid report ID"),
  newStatus: z.enum(["investigating", "resolved", "dismissed"], {
    message: "Invalid status transition",
  }),
  reason: z
    .string()
    .trim()
    .min(3, "Reason must be at least 3 characters")
    .max(1000, "Reason must not exceed 1000 characters"),
});

export const applyModerationActionSchema = z.object({
  targetPublicId: z.string().uuid("Invalid target public ID"),
  actionType: moderationActionTypeSchema,
  reason: z
    .string()
    .trim()
    .min(3, "Reason must be at least 3 characters")
    .max(1000, "Reason must not exceed 1000 characters"),
  reportId: z.string().uuid("Invalid report ID").optional(),
});

export const moderationFiltersSchema = z.object({
  status: reportStatusSchema.optional(),
  category: reportCategorySchema.optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
});

export type ResolveReportInput = z.infer<typeof resolveReportSchema>;
export type ApplyModerationActionInput = z.infer<typeof applyModerationActionSchema>;
export type ModerationFiltersInput = z.infer<typeof moderationFiltersSchema>;
