import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as React from "react";
import { RecipientInbox } from "./recipient-inbox";
import * as inboxService from "@/lib/messaging/inbox-service";
import * as messagingActions from "@/lib/messaging/actions";
import * as identityCrypto from "@/lib/crypto/identity";
import type { RecipientInboxMessage } from "@/lib/messaging/types";

describe("Prompt 008: RecipientInbox Component Tests", () => {
  const sampleRawMessages: RecipientInboxMessage[] = [
    {
      id: "msg-001",
      ciphertext: "c2VjcmV0LWNpcGhlcnRleHQtMQ==",
      keyId: "key-001",
      protocolVersion: 1,
      createdAt: "2026-10-09T08:00:00.000Z",
      isRead: false,
      isStarred: false,
    },
    {
      id: "msg-002",
      ciphertext: "c2VjcmV0LWNpcGhlcnRleHQtMg==",
      keyId: "key-001",
      protocolVersion: 1,
      createdAt: "2026-10-09T08:30:00.000Z",
      isRead: true,
      isStarred: true,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders empty inbox state when there are no messages", async () => {
    vi.spyOn(inboxService, "decryptInboxMessages").mockResolvedValue({
      items: [],
      keyState: "ready",
    });

    render(<RecipientInbox initialMessages={[]} />);

    expect(await screen.findByText(/your inbox is empty/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse people/i })).toBeInTheDocument();
  });

  it("renders decrypted messages and strictly NEVER displays sender identity", async () => {
    vi.spyOn(inboxService, "decryptInboxMessages").mockResolvedValue({
      items: [
        {
          id: "msg-001",
          plaintext: "I really appreciate your guidance on the project!",
          keyId: "key-001",
          protocolVersion: 1,
          createdAt: "2026-10-09T08:00:00.000Z",
          isRead: false,
          isStarred: false,
          decryptionStatus: "decrypted",
        },
      ],
      keyState: "ready",
    });

    const { container } = render(
      <RecipientInbox initialMessages={[sampleRawMessages[0]]} initialUnreadCount={1} />
    );

    // Verify plaintext renders
    expect(
      await screen.findByText("I really appreciate your guidance on the project!")
    ).toBeInTheDocument();

    // Verify unread badge
    expect(screen.getByText("1 unread")).toBeInTheDocument();

    // CRITICAL PRIVACY & ANONYMITY CHECKS:
    expect(screen.queryByText(/sender/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/from:/i)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("sender_id");
    expect(container.innerHTML).not.toContain("senderId");
  });

  it("toggles star state optimistically and calls setMessageStarredAction", async () => {
    vi.spyOn(inboxService, "decryptInboxMessages").mockResolvedValue({
      items: [
        {
          id: "msg-001",
          plaintext: "Starred test note",
          keyId: "key-001",
          protocolVersion: 1,
          createdAt: "2026-10-09T08:00:00.000Z",
          isRead: true,
          isStarred: false,
          decryptionStatus: "decrypted",
        },
      ],
      keyState: "ready",
    });

    const mockStarAction = vi.spyOn(
      messagingActions,
      "setMessageStarredAction"
    ).mockResolvedValue({
      success: true,
      isStarred: true,
    });

    render(<RecipientInbox initialMessages={[sampleRawMessages[0]]} />);

    const starBtn = await screen.findByRole("button", { name: /star message/i });
    await waitFor(() => {
      fireEvent.click(starBtn);
    });

    await waitFor(() => {
      expect(mockStarAction).toHaveBeenCalledWith("msg-001", true);
    });
  });

  it("marks an unread message as read on click", async () => {
    vi.spyOn(inboxService, "decryptInboxMessages").mockResolvedValue({
      items: [
        {
          id: "msg-001",
          plaintext: "Unread test message",
          keyId: "key-001",
          protocolVersion: 1,
          createdAt: "2026-10-09T08:00:00.000Z",
          isRead: false,
          isStarred: false,
          decryptionStatus: "decrypted",
        },
      ],
      keyState: "ready",
    });

    const mockMarkRead = vi.spyOn(
      messagingActions,
      "markMessageReadAction"
    ).mockResolvedValue({
      success: true,
      updated: true,
    });

    render(
      <RecipientInbox initialMessages={[sampleRawMessages[0]]} initialUnreadCount={1} />
    );

    const markReadBtn = await screen.findByRole("button", { name: /mark as read/i });
    await waitFor(() => {
      fireEvent.click(markReadBtn);
    });

    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith("msg-001");
    });
  });

  it("handles delete with confirmation and removes message on confirmation", async () => {
    vi.spyOn(inboxService, "decryptInboxMessages").mockResolvedValue({
      items: [
        {
          id: "msg-001",
          plaintext: "To be deleted",
          keyId: "key-001",
          protocolVersion: 1,
          createdAt: "2026-10-09T08:00:00.000Z",
          isRead: true,
          isStarred: false,
          decryptionStatus: "decrypted",
        },
      ],
      keyState: "ready",
    });

    const mockDeleteAction = vi.spyOn(
      messagingActions,
      "deleteMessageAction"
    ).mockResolvedValue({
      success: true,
      deleted: true,
    });

    render(<RecipientInbox initialMessages={[sampleRawMessages[0]]} />);

    // Click trash button
    const trashBtn = await screen.findByRole("button", { name: /delete message from inbox/i });
    fireEvent.click(trashBtn);

    // Confirmation prompt should appear
    expect(screen.getByText(/remove this message from your inbox\?/i)).toBeInTheDocument();

    // Confirm deletion
    const confirmBtn = screen.getByRole("button", { name: /^delete$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockDeleteAction).toHaveBeenCalledWith("msg-001");
      expect(screen.queryByText("To be deleted")).not.toBeInTheDocument();
    });
  });

  it("displays calm decryption error when a message cannot be decrypted and NEVER shows raw ciphertext", async () => {
    vi.spyOn(inboxService, "decryptInboxMessages").mockResolvedValue({
      items: [
        {
          id: "msg-corrupt",
          plaintext: null,
          keyId: "key-001",
          protocolVersion: 1,
          createdAt: "2026-10-09T08:00:00.000Z",
          isRead: false,
          isStarred: false,
          decryptionStatus: "failed",
          error: "This message could not be decrypted with your current key.",
        },
      ],
      keyState: "ready",
    });

    const { container } = render(
      <RecipientInbox
        initialMessages={[
          {
            id: "msg-corrupt",
            ciphertext: "UNREADABLE_RAW_CIPHERTEXT_BASE64",
            keyId: "key-001",
            protocolVersion: 1,
            createdAt: "2026-10-09T08:00:00.000Z",
            isRead: false,
            isStarred: false,
          },
        ]}
      />
    );

    expect(
      await screen.findByText(/this message could not be decrypted with your current key/i)
    ).toBeInTheDocument();

    // CRITICAL: Ensure raw ciphertext is NEVER displayed to user
    expect(container.innerHTML).not.toContain("UNREADABLE_RAW_CIPHERTEXT_BASE64");
  });

  it("displays missing key recovery banner when local key is not available", async () => {
    vi.spyOn(inboxService, "decryptInboxMessages").mockResolvedValue({
      items: [],
      keyState: "missing_key",
      serverKeyRegistered: true,
    });

    const mockRestore = vi.spyOn(identityCrypto, "restoreIdentity").mockResolvedValue({
      id: "active_identity",
      publicKey: new Uint8Array(32),
      privateKey: new Uint8Array(32),
      createdAt: Date.now(),
    });

    render(<RecipientInbox initialMessages={[]} />);

    expect(
      await screen.findByText(/encryption key not found on this device/i)
    ).toBeInTheDocument();

    const input = screen.getByLabelText(/recovery phrase/i);
    fireEvent.change(input, { target: { value: "1111-2222-3333-4444-5555-6666-7777-8888" } });

    const restoreBtn = screen.getByRole("button", { name: /restore key & decrypt/i });
    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(mockRestore).toHaveBeenCalledWith("1111-2222-3333-4444-5555-6666-7777-8888");
    });
  });
});
