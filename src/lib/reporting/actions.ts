"use server";

import { createMessageReport } from "./service";
import { AppError } from "@/lib/errors";
import type { ReportInput, ReportResult } from "./types";

/**
 * Server Action: Submits an abuse report for a received message.
 *
 * CRITICAL PRIVACY INVARIANT:
 * - The server derives the reporter from the authenticated session.
 * - Sender identity is resolved strictly within PostgreSQL.
 * - Disclosed plaintext is accepted ONLY if explicit consent is verified.
 */
export async function reportMessageAction(
  input: ReportInput
): Promise<ReportResult> {
  try {
    return await createMessageReport(input);
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return { success: false, error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Failed to submit abuse report";
    return { success: false, error: message };
  }
}
