import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchYahooProfiles, __test__setClient } from "../profile-enricher";

// ── Mock yahoo-finance2 ──────────────────────────────────────────────────

const mockQuoteSummary = vi.fn();
vi.mock("yahoo-finance2", () => {
  // Must use a function declaration (not arrow) so `new` works as constructor
  const MockYahooFinance = function () {
    return { quoteSummary: mockQuoteSummary };
  } as unknown as typeof import("yahoo-finance2").default;
  return { default: MockYahooFinance };
});

// ── fetchYahooProfiles Tests ─────────────────────────────────────────────

describe("fetchYahooProfiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the lazy singleton client so each test starts fresh
    __test__setClient(null);
  });

  describe("happy path", () => {
    it("returns sector and industry for a single valid symbol", async () => {
      mockQuoteSummary.mockResolvedValueOnce({
        assetProfile: {
          sector: "Technology",
          industry: "Consumer Electronics",
        },
      });

      const result = await fetchYahooProfiles(["AAPL"]);
      expect(result.size).toBe(1);
      expect(result.get("AAPL")).toEqual({
        symbol: "AAPL",
        sector: "Technology",
        industry: "Consumer Electronics",
      });
      expect(result.get("AAPL")?.error).toBeUndefined();
    });

    it("returns sector and industry for multiple valid symbols", async () => {
      mockQuoteSummary
        .mockResolvedValueOnce({
          assetProfile: {
            sector: "Technology",
            industry: "Consumer Electronics",
          },
        })
        .mockResolvedValueOnce({
          assetProfile: {
            sector: "Technology",
            industry: "Software—Infrastructure",
          },
        });

      const result = await fetchYahooProfiles(["AAPL", "MSFT"]);
      expect(result.size).toBe(2);
      expect(result.get("AAPL")?.sector).toBe("Technology");
      expect(result.get("MSFT")?.industry).toBe("Software—Infrastructure");
      expect(result.get("AAPL")?.error).toBeUndefined();
      expect(result.get("MSFT")?.error).toBeUndefined();
    });

    it("deduplicates duplicate symbols and makes one API call", async () => {
      mockQuoteSummary.mockResolvedValueOnce({
        assetProfile: {
          sector: "Technology",
          industry: "Consumer Electronics",
        },
      });

      const result = await fetchYahooProfiles(["AAPL", "AAPL", "AAPL"]);
      expect(result.size).toBe(1);
      expect(result.get("AAPL")?.sector).toBe("Technology");
      expect(mockQuoteSummary).toHaveBeenCalledTimes(1);
    });

    it("returns empty map when all symbols fail", async () => {
      mockQuoteSummary.mockRejectedValue(new Error("API error"));

      const result = await fetchYahooProfiles(["AAPL", "MSFT", "GOOGL"]);
      expect(result.size).toBe(0);
    });
  });

  describe("error paths", () => {
    it("handles a symbol with no assetProfile gracefully (returns undefined sector/industry)", async () => {
      mockQuoteSummary.mockResolvedValueOnce({});

      const result = await fetchYahooProfiles(["NO_PROFILE"]);
      expect(result.size).toBe(1);
      expect(result.get("NO_PROFILE")?.symbol).toBe("NO_PROFILE");
      expect(result.get("NO_PROFILE")?.sector).toBeUndefined();
      expect(result.get("NO_PROFILE")?.industry).toBeUndefined();
      expect(result.get("NO_PROFILE")?.error).toBeUndefined();
    });

    it("handles assetProfile with null sector and industry", async () => {
      mockQuoteSummary.mockResolvedValueOnce({
        assetProfile: { sector: null, industry: null },
      });

      const result = await fetchYahooProfiles(["NULL_CASE"]);
      expect(result.size).toBe(1);
      expect(result.get("NULL_CASE")?.sector).toBeUndefined();
      expect(result.get("NULL_CASE")?.industry).toBeUndefined();
    });

    it("handles assetProfile with empty sector and industry strings", async () => {
      mockQuoteSummary.mockResolvedValueOnce({
        assetProfile: { sector: "", industry: "" },
      });

      const result = await fetchYahooProfiles(["EMPTY_STR"]);
      expect(result.size).toBe(1);
      expect(result.get("EMPTY_STR")?.sector).toBe("");
      expect(result.get("EMPTY_STR")?.industry).toBe("");
    });

    it("handles network errors gracefully by omitting the failed symbol", async () => {
      mockQuoteSummary.mockRejectedValueOnce(new Error("Network failure"));

      const result = await fetchYahooProfiles(["AAPL"]);
      // Rejected symbols are silently skipped
      expect(result.size).toBe(0);
    });

    it("handles non-Error rejection (plain string) gracefully", async () => {
      mockQuoteSummary.mockRejectedValueOnce("Some string error");

      const result = await fetchYahooProfiles(["AAPL"]);
      expect(result.size).toBe(0);
    });

    it("recovers from partial failures — one symbol fails, others succeed", async () => {
      mockQuoteSummary
        .mockRejectedValueOnce(new Error("Rate limited"))
        .mockResolvedValueOnce({
          assetProfile: {
            sector: "Technology",
            industry: "Consumer Electronics",
          },
        });

      const result = await fetchYahooProfiles(["FAIL", "AAPL"]);
      // Failed symbol is omitted; successful one is present
      expect(result.size).toBe(1);
      expect(result.has("FAIL")).toBe(false);
      expect(result.get("AAPL")?.sector).toBe("Technology");
    });
  });

  describe("edge cases", () => {
    it("returns empty map for empty symbols array", async () => {
      const result = await fetchYahooProfiles([]);
      expect(result.size).toBe(0);
      expect(mockQuoteSummary).not.toHaveBeenCalled();
    });

    it("handles case-insensitive input by upper-casing symbols", async () => {
      mockQuoteSummary.mockResolvedValueOnce({
        assetProfile: {
          sector: "Technology",
          industry: "Consumer Electronics",
        },
      });

      const result = await fetchYahooProfiles(["aapl"]);
      expect(result.size).toBe(1);
      // Map key is upper-cased
      expect(result.has("AAPL")).toBe(true);
      expect(result.get("AAPL")?.sector).toBe("Technology");
    });

    it("handles mix of upper and lower case duplicate symbols", async () => {
      mockQuoteSummary.mockResolvedValueOnce({
        assetProfile: {
          sector: "Technology",
          industry: "Consumer Electronics",
        },
      });

      const result = await fetchYahooProfiles(["AAPL", "aapl", "Aapl"]);
      // All resolve to the same upper-cased symbol: one API call, one entry
      expect(result.size).toBe(1);
      expect(mockQuoteSummary).toHaveBeenCalledTimes(1);
    });

    it("does not set error field when assetProfile is missing", async () => {
      mockQuoteSummary.mockResolvedValueOnce({});

      const result = await fetchYahooProfiles(["BLANK"]);
      expect(result.size).toBe(1);
      expect(result.get("BLANK")?.error).toBeUndefined();
    });

    it("handles a response with assetProfile but no sector or industry keys", async () => {
      mockQuoteSummary.mockResolvedValueOnce({
        assetProfile: { longBusinessSummary: "A company" },
      });

      const result = await fetchYahooProfiles(["SUMMARY_ONLY"]);
      expect(result.size).toBe(1);
      expect(result.get("SUMMARY_ONLY")?.sector).toBeUndefined();
      expect(result.get("SUMMARY_ONLY")?.industry).toBeUndefined();
    });
  });
});
