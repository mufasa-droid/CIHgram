import { z } from "zod";
import type { ReportCategory } from "./types";

export const REPORT_CATEGORIES: [ReportCategory, ...ReportCategory[]] = [
  "harassment",
  "threats",
  "spam",
  "inappropriate_content",
  "impersonation",
  "other",
];

export const reportCategorySchema = z.enum(REPORT_CATEGORIES, {
  message: "Please select a valid report category.",
});

export const reportDetailsSchema = z
  .string()
  .trim()
  .max(1000, "Details must not exceed 1000 characters.")
  .nullable()
  .optional()
  .transform((val) => (val && val.length > 0 ? val : null));

export const disclosedPlaintextSchema = z
  .string()
  .max(2000, "Disclosed plaintext must not exceed 2000 characters.")
  .nullable()
  .optional()
  .transform((val) => (val && val.length > 0 ? val : null));

export const createReportSchema = z
  .object({
    messageId: z.string().uuid("Invalid message identifier."),
    category: reportCategorySchema,
    details: reportDetailsSchema,
    disclosePlaintext: z.boolean(),
    disclosedPlaintext: disclosedPlaintextSchema,
  })
  .superRefine((data, ctx) => {
    if (data.disclosePlaintext && (!data.disclosedPlaintext || data.disclosedPlaintext.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["disclosedPlaintext"],
        message: "When plaintext disclosure is enabled, the decrypted message text must be provided.",
      });
    }
  });

export type ValidatedReportInput = z.infer<typeof createReportSchema>;
