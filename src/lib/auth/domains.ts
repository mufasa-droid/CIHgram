/**
 * Domain parsing and validation utilities for Organization Admission.
 */

/**
 * Safely extracts and normalizes the domain from an authenticated email.
 * Guarantees case-insensitivity, whitespace trimming, and validation.
 * Returns null for missing, malformed, or suspicious email addresses.
 */
export function extractEmailDomain(email?: string | null): string | null {
  if (!email || typeof email !== "string") {
    return null;
  }

  const trimmed = email.trim().toLowerCase();

  // Find delimiter
  const atIndex = trimmed.indexOf("@");
  const lastAtIndex = trimmed.lastIndexOf("@");

  // Must contain exactly one '@' character and not at boundaries
  if (atIndex <= 0 || atIndex !== lastAtIndex || atIndex === trimmed.length - 1) {
    return null;
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);

  // Local part must not be empty or exceed standard length
  if (!localPart || localPart.length > 64) {
    return null;
  }

  // Domain must match valid domain syntax with at least one dot
  // and valid label characters (letters, digits, hyphens)
  const domainRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  if (!domainRegex.test(domainPart) || domainPart.length > 255) {
    return null;
  }

  return domainPart;
}

/**
 * Checks if a user's domain matches any allowed domain from an organization.
 * Strict comparison prevents suffix spoofing (e.g. "evilcih.org" will NEVER match "cih.org").
 * 
 * @param userDomain The normalized domain from the authenticated user's email
 * @param allowedDomains Array of authorized organization domains
 * @param allowSubdomains Whether to allow subdomains of allowed domains (e.g. "team.cih.org")
 */
export function isDomainAllowed(
  userDomain: string | null | undefined,
  allowedDomains: string[],
  allowSubdomains = false
): boolean {
  if (!userDomain || !Array.isArray(allowedDomains) || allowedDomains.length === 0) {
    return false;
  }

  const normalizedUserDomain = userDomain.trim().toLowerCase();

  return allowedDomains.some((allowed) => {
    if (!allowed || typeof allowed !== "string") {
      return false;
    }

    const normalizedAllowed = allowed.trim().toLowerCase();
    if (!normalizedAllowed) {
      return false;
    }

    // Exact domain match
    if (normalizedUserDomain === normalizedAllowed) {
      return true;
    }

    // Optional subdomain match (requires preceding dot)
    if (allowSubdomains && normalizedUserDomain.endsWith("." + normalizedAllowed)) {
      return true;
    }

    return false;
  });
}
