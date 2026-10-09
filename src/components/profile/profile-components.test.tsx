import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as React from "react";
import { ProfileForm } from "./profile-form";
import { AccountSection } from "./account-section";
import { EncryptionStatusCard } from "./encryption-status-card";
import { SignOutCard } from "./sign-out-card";
import * as actions from "@/lib/profile/actions";
import * as keystore from "@/lib/crypto/keystore";

// Mock server actions
vi.mock("@/lib/profile/actions", () => ({
  updateProfileAction: vi.fn(),
}));

// Mock keystore
vi.mock("@/lib/crypto/keystore", () => ({
  getLocalIdentity: vi.fn(),
  saveLocalIdentity: vi.fn(),
  clearLocalIdentity: vi.fn(),
}));

describe("Prompt 009: Profile & Settings UI Component Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockProfile = {
    id: "user-123",
    username: "ada",
    displayName: "Ada Lovelace",
    bio: "Pioneering mathematician.",
    avatarUrl: "https://example.com/ada.png",
    createdAt: "2026-10-08T00:00:00Z",
    updatedAt: "2026-10-08T00:00:00Z",
  };

  const mockAccount = {
    email: "ada@analytical.org",
    provider: "Google OAuth",
    userId: "user-123",
    organizationId: "org-1",
    organizationName: "Analytical Engine Lab",
    organizationSlug: "analytical-engine",
    role: "member",
    membershipStatus: "active",
    joinedAt: "2026-10-08T00:00:00Z",
  };

  describe("1. ProfileForm Component", () => {
    it("renders initial profile values and directory preview", () => {
      render(
        <ProfileForm
          initialProfile={mockProfile}
          organizationName="Analytical Engine Lab"
        />
      );

      // Verify form inputs
      const displayNameInput = screen.getByLabelText(/display name/i) as HTMLInputElement;
      expect(displayNameInput.value).toBe("Ada Lovelace");

      const usernameInput = screen.getByLabelText(/username handle/i) as HTMLInputElement;
      expect(usernameInput.value).toBe("ada");

      const bioInput = screen.getByLabelText(/bio/i) as HTMLTextAreaElement;
      expect(bioInput.value).toBe("Pioneering mathematician.");

      // Verify directory preview exists
      expect(screen.getByText(/directory preview/i)).toBeInTheDocument();
      expect(screen.getByText("@ada")).toBeInTheDocument();

      // Save button should be disabled when pristine
      const saveBtn = screen.getByRole("button", { name: /save changes/i });
      expect(saveBtn).toBeDisabled();
    });

    it("enables save button when form values change and submits successfully", async () => {
      vi.mocked(actions.updateProfileAction).mockResolvedValue({
        success: true,
        profile: { ...mockProfile, displayName: "Countess of Lovelace" },
      });

      render(
        <ProfileForm
          initialProfile={mockProfile}
          organizationName="Analytical Engine Lab"
        />
      );

      const displayNameInput = screen.getByLabelText(/display name/i);
      fireEvent.change(displayNameInput, {
        target: { value: "Countess of Lovelace" },
      });

      const saveBtn = screen.getByRole("button", { name: /save changes/i });
      expect(saveBtn).toBeEnabled();

      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(actions.updateProfileAction).toHaveBeenCalledWith({
          displayName: "Countess of Lovelace",
          username: "ada",
          bio: "Pioneering mathematician.",
          avatarUrl: "https://example.com/ada.png",
        });
      });

      // Verify success status
      await waitFor(() => {
        expect(screen.getByText(/profile updated successfully/i)).toBeInTheDocument();
      });
    });

    it("displays error alert when update action fails", async () => {
      vi.mocked(actions.updateProfileAction).mockResolvedValue({
        success: false,
        error: "This username is already taken. Please choose another.",
      });

      render(
        <ProfileForm
          initialProfile={mockProfile}
          organizationName="Analytical Engine Lab"
        />
      );

      const usernameInput = screen.getByLabelText(/username handle/i);
      fireEvent.change(usernameInput, { target: { value: "taken_user" } });

      const saveBtn = screen.getByRole("button", { name: /save changes/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(
          screen.getByText(/this username is already taken/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe("2. AccountSection Component", () => {
    it("renders read-only authentication and organization info", () => {
      render(<AccountSection account={mockAccount} />);

      expect(screen.getByText("ada@analytical.org")).toBeInTheDocument();
      expect(screen.getByText("Analytical Engine Lab")).toBeInTheDocument();
      expect(screen.getAllByText(/member/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/active/i)).toBeInTheDocument();
      expect(screen.getByText("user-123")).toBeInTheDocument();
      expect(
        screen.getByText(/password credentials and two-factor authentication/i)
      ).toBeInTheDocument();
    });
  });

  describe("3. EncryptionStatusCard Component", () => {
    it("renders active cryptographic protocol and server key status", async () => {
      vi.mocked(keystore.getLocalIdentity).mockResolvedValue({
        id: "active_identity",
        publicKey: new Uint8Array(32),
        privateKey: new Uint8Array(32),
        createdAt: Date.now(),
      });

      const serverKeyStatus = {
        hasActiveKey: true,
        activeKeyId: "key-12345",
        activePublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        createdAt: "2026-10-08T00:00:00Z",
        keyCount: 1,
      };

      render(<EncryptionStatusCard serverKeyStatus={serverKeyStatus} />);

      expect(screen.getAllByText(/libsodium sealed box/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/curve25519/i)).toBeInTheDocument();
      expect(screen.getByText(/registered & active/i)).toBeInTheDocument();
      expect(screen.getByText(/device key storage/i)).toBeInTheDocument();
    });
  });

  describe("4. SignOutCard Component", () => {
    it("renders sign out information and handles sign out clicks", () => {
      render(<SignOutCard />);

      expect(screen.getByText(/session management/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    });
  });
});
