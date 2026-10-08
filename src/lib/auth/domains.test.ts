import { describe, it, expect } from "vitest";
import { extractEmailDomain, isDomainAllowed } from "./domains";

describe("Domain Extraction and Validation", () => {
  describe("extractEmailDomain", () => {
    it("extracts and normalizes valid domains", () => {
      expect(extractEmailDomain("alice@cih.org")).toBe("cih.org");
      expect(extractEmailDomain("BOB@EXAMPLE.COM")).toBe("example.com");
      expect(extractEmailDomain("  user.name@sub.domain.co.uk  ")).toBe("sub.domain.co.uk");
    });

    it("rejects malformed email addresses", () => {
      expect(extractEmailDomain("")).toBeNull();
      expect(extractEmailDomain(null)).toBeNull();
      expect(extractEmailDomain(undefined)).toBeNull();
      expect(extractEmailDomain("plainaddress")).toBeNull();
      expect(extractEmailDomain("@missinglocal.com")).toBeNull();
      expect(extractEmailDomain("missingdomain@")).toBeNull();
      expect(extractEmailDomain("two@@at.com")).toBeNull();
      expect(extractEmailDomain("user@domain@extra.com")).toBeNull();
      expect(extractEmailDomain("user@nodot")).toBeNull();
      expect(extractEmailDomain("user@.dotstart.com")).toBeNull();
      expect(extractEmailDomain("user@dotend.com.")).toBeNull();
      expect(extractEmailDomain("user@bad_char.com")).toBeNull();
    });
  });

  describe("isDomainAllowed", () => {
    const allowed = ["cih.org", "internal.cih.org", "partner.io"];

    it("matches exact allowed domains case-insensitively", () => {
      expect(isDomainAllowed("cih.org", allowed)).toBe(true);
      expect(isDomainAllowed("CIH.ORG", allowed)).toBe(true);
      expect(isDomainAllowed("internal.cih.org", allowed)).toBe(true);
      expect(isDomainAllowed("partner.io", allowed)).toBe(true);
    });

    it("STRICTLY rejects suffix attacks", () => {
      // Must NEVER match just because it ends with the string "cih.org"
      expect(isDomainAllowed("evilcih.org", allowed)).toBe(false);
      expect(isDomainAllowed("notcih.org", allowed)).toBe(false);
      expect(isDomainAllowed("attackpartner.io", allowed)).toBe(false);
      expect(isDomainAllowed("fake-internal.cih.org", allowed)).toBe(false);
    });

    it("rejects unauthorized domains", () => {
      expect(isDomainAllowed("gmail.com", allowed)).toBe(false);
      expect(isDomainAllowed("outlook.com", allowed)).toBe(false);
      expect(isDomainAllowed("", allowed)).toBe(false);
      expect(isDomainAllowed(null, allowed)).toBe(false);
    });

    it("handles subdomains correctly according to flag", () => {
      // By default, strict exact match only
      expect(isDomainAllowed("dev.cih.org", ["cih.org"], false)).toBe(false);
      // With allowSubdomains = true
      expect(isDomainAllowed("dev.cih.org", ["cih.org"], true)).toBe(true);
      expect(isDomainAllowed("evilcih.org", ["cih.org"], true)).toBe(false);
    });
  });
});
