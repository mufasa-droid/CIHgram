import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MessageComposer } from "./message-composer";
import * as sendService from "@/lib/messaging/send-service";
import type { PublicMember } from "@/lib/directory/types";

const mockRecipient: PublicMember = {
  id: "recip-1",
  username: "alice",
  displayName: "Alice Walker",
  avatarUrl: null,
};

describe("MessageComposer Component (71UI Transient Modal)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <MessageComposer
        recipient={mockRecipient}
        isOpen={false}
        onClose={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render when recipient is null", () => {
    const { container } = render(
      <MessageComposer
        recipient={null}
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders recipient details and privacy disclaimer when open", () => {
    render(
      <MessageComposer
        recipient={mockRecipient}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Send to Alice Walker")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText(/End-to-end encrypted & anonymous/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Write a thoughtful, honest note/i)).toBeInTheDocument();
  });

  it("disables send button when textarea is empty", () => {
    render(
      <MessageComposer
        recipient={mockRecipient}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    const sendBtn = screen.getByRole("button", { name: /send anonymously/i });
    expect(sendBtn).toBeDisabled();
  });

  it("tracks character count and enables send button upon valid input", () => {
    render(
      <MessageComposer
        recipient={mockRecipient}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    const textarea = screen.getByRole("textbox");
    const sendBtn = screen.getByRole("button", { name: /send anonymously/i });

    fireEvent.change(textarea, { target: { value: "Hello Alice!" } });

    expect(screen.getByText("12 / 2,000")).toBeInTheDocument();
    expect(sendBtn).toBeEnabled();
  });

  it("disables send button when character count exceeds limit", () => {
    render(
      <MessageComposer
        recipient={mockRecipient}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    const textarea = screen.getByRole("textbox");
    const sendBtn = screen.getByRole("button", { name: /send anonymously/i });

    fireEvent.change(textarea, { target: { value: "a".repeat(2001) } });

    expect(sendBtn).toBeDisabled();
  });

  it("submits message and transitions to success state upon successful send", async () => {
    vi.spyOn(sendService, "sendAnonymousMessage").mockResolvedValue({
      success: true,
      messageId: "msg-123",
    });

    const onSentSuccess = vi.fn();
    render(
      <MessageComposer
        recipient={mockRecipient}
        isOpen={true}
        onClose={vi.fn()}
        onSentSuccess={onSentSuccess}
      />
    );

    const textarea = screen.getByRole("textbox");
    const sendBtn = screen.getByRole("button", { name: /send anonymously/i });

    fireEvent.change(textarea, { target: { value: "Secret anonymous feedback" } });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText("Message Delivered")).toBeInTheDocument();
    });

    expect(onSentSuccess).toHaveBeenCalledWith("msg-123");
    expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
  });

  it("displays error message and preserves text when send fails", async () => {
    vi.spyOn(sendService, "sendAnonymousMessage").mockResolvedValue({
      success: false,
      error: "You are sending messages too quickly. Please wait a moment.",
    });

    render(
      <MessageComposer
        recipient={mockRecipient}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    const textarea = screen.getByRole("textbox");
    const sendBtn = screen.getByRole("button", { name: /send anonymously/i });

    fireEvent.change(textarea, { target: { value: "Attempted feedback note" } });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(
        screen.getByText("You are sending messages too quickly. Please wait a moment.")
      ).toBeInTheDocument();
    });

    // Plaintext draft must remain in textarea so user does not lose writing
    expect((textarea as HTMLTextAreaElement).value).toBe("Attempted feedback note");
  });

  it("calls onClose when Cancel button or close icon is clicked", () => {
    const onClose = vi.fn();
    render(
      <MessageComposer
        recipient={mockRecipient}
        isOpen={true}
        onClose={onClose}
      />
    );

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
