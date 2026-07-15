import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  YahooFinanceProvider,
  MockMarketQuoteProvider,
  createMockQuoteResult,
  hasPrice,
  type QuoteResult,
} from "../market-quote";

// ── Mock yahoo-finance2 ──────────────────────────────────────────────────

const mockQuote = vi.fn();
vi.mock("yahoo-finance2", () => {
  // Must use a function declaration (not arrow) so `new` works as constructor
  const MockYahooFinance = function () {
    return { quote: mockQuote };
  } as unknown as typeof import("yahoo-finance2").default;
  return { default: MockYahooFinance };
});

// ── YahooFinanceProvider Tests ───────────────────────────────────────────

describe("YahooFinanceProvider", () => {
  let provider: YahooFinanceProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new YahooFinanceProvider();
  });

  describe("happy path", () => {
    it("returns correct price, marketState, source and timestamp for a valid symbol", async () => {
      mockQuote.mockResolvedValueOnce([
        {
          symbol: "AAPL",
          regularMarketPrice: 178.5,
          marketState: "REGULAR",
        },
      ]);

      const results = await provider.getQuote(["AAPL"]);
      expect(results).toHaveLength(1);
      expect(results[0].symbol).toBe("AAPL");
      expect(results[0].price).toBe(178.5);
      expect(results[0].marketState).toBe("REGULAR");
      expect(results[0].source).toBe("yahoo");
      expect(results[0].error).toBeUndefined();
      expect(results[0].fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("preserves input order even when Yahoo returns a different order", async () => {
      mockQuote.mockResolvedValueOnce([
        { symbol: "MSFT", regularMarketPrice: 420.0, marketState: "REGULAR" },
        { symbol: "AAPL", regularMarketPrice: 178.5, marketState: "REGULAR" },
      ]);

      const results = await provider.getQuote(["AAPL", "MSFT"]);
      expect(results).toHaveLength(2);
      expect(results[0].symbol).toBe("AAPL");
      expect(results[1].symbol).toBe("MSFT");
    });
  });

  describe("error paths", () => {
    it("returns error field for an unknown ticker with no matching data", async () => {
      mockQuote.mockResolvedValueOnce([
        { symbol: "AAPL", regularMarketPrice: 178.5, marketState: "REGULAR" },
      ]);

      const results = await provider.getQuote(["UNKNOWNSYM"]);
      expect(results).toHaveLength(1);
      expect(results[0].symbol).toBe("UNKNOWNSYM");
      expect(results[0].price).toBeNull();
      expect(results[0].error).toContain("No quote data available");
      expect(results[0].source).toBe("yahoo");
    });

    it("handles null/undefined price from Yahoo without crashing", async () => {
      mockQuote.mockResolvedValueOnce([
        {
          symbol: "PRE_IPO",
          regularMarketPrice: null,
          marketState: "PRE",
        },
      ]);

      const results = await provider.getQuote(["PRE_IPO"]);
      expect(results).toHaveLength(1);
      expect(results[0].price).toBeNull();
      expect(results[0].error).toBeUndefined();
    });

    it("handles network errors gracefully", async () => {
      mockQuote.mockRejectedValueOnce(new Error("Network failure"));

      const results = await provider.getQuote(["AAPL"]);
      expect(results).toHaveLength(1);
      expect(results[0].price).toBeNull();
      expect(results[0].error).toContain("Yahoo Finance API error");
      expect(results[0].error).toContain("Network failure");
      expect(results[0].source).toBe("yahoo");
    });

    it("handles non-Error network rejection (string)", async () => {
      mockQuote.mockRejectedValueOnce("Some string error");

      const results = await provider.getQuote(["AAPL"]);
      expect(results).toHaveLength(1);
      expect(results[0].price).toBeNull();
      expect(results[0].error).toContain("Some string error");
    });

    it("returns error for every symbol when a single API call fails", async () => {
      mockQuote.mockRejectedValueOnce(new Error("Rate limited"));

      const results = await provider.getQuote(["AAPL", "MSFT", "GOOGL"]);
      expect(results).toHaveLength(3);
      results.forEach((r) => {
        expect(r.price).toBeNull();
        expect(r.error).toContain("Rate limited");
      });
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty symbols input", async () => {
      const results = await provider.getQuote([]);
      expect(results).toEqual([]);
      expect(mockQuote).not.toHaveBeenCalled();
    });

    it("handles undefined regularMarketPrice", async () => {
      mockQuote.mockResolvedValueOnce([
        {
          symbol: "DELISTED",
          regularMarketPrice: undefined,
          marketState: "CLOSED",
        },
      ]);

      const results = await provider.getQuote(["DELISTED"]);
      expect(results).toHaveLength(1);
      expect(results[0].price).toBeNull();
    });

    it("handles missing symbol and marketState in Yahoo response", async () => {
      // Yahoo sometimes returns results without symbol field for unknown tickers
      mockQuote.mockResolvedValueOnce([
        { someOtherField: "thing" },
      ]);

      const results = await provider.getQuote(["MYSTERY"]);
      expect(results).toHaveLength(1);
      expect(results[0].price).toBeNull();
      expect(results[0].error).toContain("No quote data available");
    });

    it("extracts dayHigh/dayLow from Yahoo response", async () => {
      mockQuote.mockResolvedValueOnce([
        {
          symbol: "AAPL",
          regularMarketPrice: 178.5,
          regularMarketDayHigh: 182.0,
          regularMarketDayLow: 175.5,
          marketState: "REGULAR",
        },
      ]);

      const results = await provider.getQuote(["AAPL"]);
      expect(results).toHaveLength(1);
      expect(results[0].dayHigh).toBe(182.0);
      expect(results[0].dayLow).toBe(175.5);
    });

    it("handles null/undefined dayHigh and dayLow gracefully", async () => {
      mockQuote.mockResolvedValueOnce([
        {
          symbol: "AAPL",
          regularMarketPrice: 178.5,
          regularMarketDayHigh: null,
          regularMarketDayLow: undefined,
          marketState: "REGULAR",
        },
      ]);

      const results = await provider.getQuote(["AAPL"]);
      expect(results).toHaveLength(1);
      expect(results[0].dayHigh).toBeUndefined();
      expect(results[0].dayLow).toBeUndefined();
    });

    it("returns one result per symbol regardless of Yahoo result count", async () => {
      mockQuote.mockResolvedValueOnce([
        { symbol: "AAPL", regularMarketPrice: 150, marketState: "REGULAR" },
      ]);

      const results = await provider.getQuote(["AAPL", "MSFT"]);
      expect(results).toHaveLength(2);
      expect(results[0].price).toBe(150);
      expect(results[1].price).toBeNull();
      expect(results[1].error).toContain("No quote data available");
    });
  });
});

// ── MockMarketQuoteProvider Tests ────────────────────────────────────────

describe("MockMarketQuoteProvider", () => {
  it("returns configured responses from the map", async () => {
    const quotes = new Map<string, QuoteResult>([
      ["AAPL", createMockQuoteResult("AAPL", 178.5, "REGULAR")],
      ["MSFT", createMockQuoteResult("MSFT", 420.0, "REGULAR")],
    ]);

    const provider = new MockMarketQuoteProvider(quotes);
    const results = await provider.getQuote(["AAPL", "MSFT"]);

    expect(results).toHaveLength(2);
    expect(results[0].price).toBe(178.5);
    expect(results[1].price).toBe(420.0);
  });

  it("returns error for unconfigured symbols", async () => {
    const quotes = new Map<string, QuoteResult>();
    const provider = new MockMarketQuoteProvider(quotes);

    const results = await provider.getQuote(["UNKNOWN"]);
    expect(results).toHaveLength(1);
    expect(results[0].price).toBeNull();
    expect(results[0].error).toContain("No mock quote configured");
  });

  it("preserves case-insensitive matching (upper-cases input)", async () => {
    const quotes = new Map<string, QuoteResult>([
      ["AAPL", createMockQuoteResult("AAPL", 150.0)],
    ]);
    const provider = new MockMarketQuoteProvider(quotes);

    const results = await provider.getQuote(["aapl"]);
    expect(results).toHaveLength(1);
    expect(results[0].price).toBe(150.0);
  });

  it("returns empty array for empty input", async () => {
    const provider = new MockMarketQuoteProvider(new Map());
    const results = await provider.getQuote([]);
    expect(results).toEqual([]);
  });

  it("mixes configured and unconfigured symbols", async () => {
    const quotes = new Map<string, QuoteResult>([
      ["AAPL", createMockQuoteResult("AAPL", 150.0, "REGULAR")],
    ]);
    const provider = new MockMarketQuoteProvider(quotes);

    const results = await provider.getQuote(["AAPL", "MSFT"]);
    expect(results).toHaveLength(2);
    expect(results[0].price).toBe(150.0);
    expect(results[0].error).toBeUndefined();
    expect(results[1].price).toBeNull();
    expect(results[1].error).toContain("No mock quote configured");
  });
});

// ── createMockQuoteResult Tests ──────────────────────────────────────────

describe("createMockQuoteResult", () => {
  it("creates a QuoteResult with mock source", () => {
    const result = createMockQuoteResult("AAPL", 150.0, "REGULAR");
    expect(result.symbol).toBe("AAPL");
    expect(result.price).toBe(150.0);
    expect(result.marketState).toBe("REGULAR");
    expect(result.source).toBe("mock");
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("defaults marketState to UNKNOWN", () => {
    const result = createMockQuoteResult("AAPL", 150.0);
    expect(result.marketState).toBe("UNKNOWN");
  });

  it("allows null price", () => {
    const result = createMockQuoteResult("AAPL", null);
    expect(result.price).toBeNull();
  });

  it("returns source=mock for provenance tracking", () => {
    const result = createMockQuoteResult("AAPL", 100);
    expect(result.source).toBe("mock");
  });
});

// ── hasPrice Type Guard Tests ────────────────────────────────────────────

describe("hasPrice", () => {
  it("returns true for quotes with a number price", () => {
    const q = createMockQuoteResult("AAPL", 150.0);
    expect(hasPrice(q)).toBe(true);
  });

  it("returns false for quotes with null price", () => {
    const q = createMockQuoteResult("AAPL", null);
    expect(hasPrice(q)).toBe(false);
  });

  it("returns false for quotes with undefined price (via explicit check)", () => {
    const q: QuoteResult = {
      symbol: "AAPL",
      price: undefined as unknown as null,
      marketState: "UNKNOWN",
      fetchedAt: new Date().toISOString(),
      source: "mock",
    };
    // price is null at runtime (undefined coerced to null by assignment),
    // but hasPrice should still catch it
    expect(hasPrice(q)).toBe(false);
  });

  it("narrows type correctly when true", () => {
    const q: QuoteResult = createMockQuoteResult("AAPL", 150.0);
    if (hasPrice(q)) {
      expect(q.price * 2).toBe(300.0);
    }
  });
});
