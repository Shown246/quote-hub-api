import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../../src/infrastructure/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Resend Email Infrastructure", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("simulates email delivery when RESEND_API_KEY is not configured", async () => {
    // In test environment, RESEND_API_KEY is undefined by default
    const { sendVerificationEmail, sendPasswordResetEmail } = await import(
      "../../../src/infrastructure/email/resend"
    );

    const verifyResult = await sendVerificationEmail(
      "user@example.com",
      "https://quote-hub.local/verify?token=abc"
    );
    expect(verifyResult).toBe(true);

    const resetResult = await sendPasswordResetEmail(
      "user@example.com",
      "https://quote-hub.local/reset?token=xyz"
    );
    expect(resetResult).toBe(true);
  });

  it("sends verification email using Resend client when configured", async () => {
    const mockSend = vi.fn().mockResolvedValue({ data: { id: "email-123" }, error: null });
    vi.doMock("resend", () => {
      return {
        Resend: vi.fn().mockImplementation(() => ({
          emails: {
            send: mockSend,
          },
        })),
      };
    });

    vi.doMock("../../../src/app/config/env", () => ({
      env: {
        RESEND_API_KEY: "re_mock_api_key_12345",
        EMAIL_FROM: "Quote-Hub <noreply@quotehub.app>",
      },
    }));

    const { sendVerificationEmail } = await import("../../../src/infrastructure/email/resend");

    const result = await sendVerificationEmail("user@example.com", "https://quote-hub.local/verify?token=abc");
    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Quote-Hub <noreply@quotehub.app>",
        to: "user@example.com",
        subject: expect.stringContaining("Verify"),
        html: expect.stringContaining("https://quote-hub.local/verify?token=abc"),
      })
    );
  });

  it("sends password reset email using Resend client when configured", async () => {
    const mockSend = vi.fn().mockResolvedValue({ data: { id: "email-456" }, error: null });
    vi.doMock("resend", () => {
      return {
        Resend: vi.fn().mockImplementation(() => ({
          emails: {
            send: mockSend,
          },
        })),
      };
    });

    vi.doMock("../../../src/app/config/env", () => ({
      env: {
        RESEND_API_KEY: "re_mock_api_key_12345",
        EMAIL_FROM: "Quote-Hub <noreply@quotehub.app>",
      },
    }));

    const { sendPasswordResetEmail } = await import("../../../src/infrastructure/email/resend");

    const result = await sendPasswordResetEmail("user@example.com", "https://quote-hub.local/reset?token=xyz");
    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Quote-Hub <noreply@quotehub.app>",
        to: "user@example.com",
        subject: expect.stringContaining("password"),
        html: expect.stringContaining("https://quote-hub.local/reset?token=xyz"),
      })
    );
  });

  it("handles Resend API error gracefully and returns false", async () => {
    const mockSend = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.doMock("resend", () => {
      return {
        Resend: vi.fn().mockImplementation(() => ({
          emails: {
            send: mockSend,
          },
        })),
      };
    });

    vi.doMock("../../../src/app/config/env", () => ({
      env: {
        RESEND_API_KEY: "re_mock_api_key_12345",
        EMAIL_FROM: "Quote-Hub <noreply@quotehub.app>",
      },
    }));

    const { sendVerificationEmail } = await import("../../../src/infrastructure/email/resend");

    const result = await sendVerificationEmail("user@example.com", "https://quote-hub.local/verify?token=abc");
    expect(result).toBe(false);
  });
});
