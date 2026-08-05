/**
 * URL normalization tests.
 */

import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../src/lib/search";

describe("normalizeUrl", () => {
  it("strips URL fragment", () => {
    const result = normalizeUrl("http://example.com/page#section");
    expect(result).toBe("http://example.com/page");
  });

  it("lowercases the hostname", () => {
    const result = normalizeUrl("HTTP://EXAMPLE.COM/");
    expect(result).toBe("http://example.com/");
  });

  it("returns null for chrome:// URLs (restricted)", () => {
    expect(normalizeUrl("chrome://newtab")).toBeNull();
  });

  it("returns null for file:// URLs (restricted)", () => {
    expect(normalizeUrl("file:///Users/me/doc.html")).toBeNull();
  });

  it("returns null for ftp:// URLs (non-http)", () => {
    expect(normalizeUrl("ftp://example.com")).toBeNull();
  });

  it("returns null for credential-bearing URLs", () => {
    expect(normalizeUrl("https://user:pass@example.com/page")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeUrl("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeUrl("   ")).toBeNull();
  });

  it("preserves path and query string", () => {
    const result = normalizeUrl("https://Example.COM/path?foo=bar");
    expect(result).toBe("https://example.com/path?foo=bar");
  });

  it("handles https:// correctly", () => {
    const result = normalizeUrl("https://example.com/page");
    expect(result).toBe("https://example.com/page");
  });

  it("strips fragment but keeps query", () => {
    const result = normalizeUrl("https://example.com/search?q=test#results");
    expect(result).toBe("https://example.com/search?q=test");
  });

  it("returns null for data: URLs", () => {
    expect(normalizeUrl("data:text/html,<h1>hi</h1>")).toBeNull();
  });

  it("returns null for javascript: URLs", () => {
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
  });

  it("returns null for about: URLs", () => {
    expect(normalizeUrl("about:blank")).toBeNull();
  });

  it("returns null for invalid URL strings", () => {
    expect(normalizeUrl("not a url at all")).toBeNull();
  });
});
