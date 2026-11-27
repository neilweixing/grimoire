import { expect, it } from "vitest";
import { normalizeBrowserUrl } from "../apps/grimoire-web/src/browser-url";

it("normalizes web and local development addresses", () => {
  expect(normalizeBrowserUrl(" example.com/docs?q=pi ")).toBe(
    "https://example.com/docs?q=pi",
  );
  expect(normalizeBrowserUrl("example.com:8080/path")).toBe(
    "https://example.com:8080/path",
  );
  expect(normalizeBrowserUrl("localhost:5173")).toBe("http://localhost:5173/");
  expect(normalizeBrowserUrl("127.0.0.1:5180/path")).toBe(
    "http://127.0.0.1:5180/path",
  );
  expect(normalizeBrowserUrl("[::1]:8080/path")).toBe("http://[::1]:8080/path");
  expect(normalizeBrowserUrl("https://example.com")).toBe(
    "https://example.com/",
  );
});
it.each([
  "",
  "not a website",
  "javascript:alert(1)",
  "file:///etc/passwd",
  "data:text/html,test",
  "ftp://example.com",
  "https://user:password@example.com",
  "https://",
  "https://example.com/" + "a".repeat(8192),
])("rejects invalid and non-web navigation", (input) => {
  expect(() => normalizeBrowserUrl(input)).toThrow();
});
