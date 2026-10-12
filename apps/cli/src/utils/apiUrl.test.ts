import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveApiUrl } from "./apiUrl.js";

describe("resolveApiUrl", () => {
  beforeEach(() => {
    delete process.env.RAPTIX_API_URL;
    delete process.env.LANGGRAPH_PORT;
  });

  afterEach(() => {
    delete process.env.RAPTIX_API_URL;
    delete process.env.LANGGRAPH_PORT;
  });

  it("prefers an explicit RAPTIX_API_URL over the port", () => {
    process.env.RAPTIX_API_URL = "http://127.0.0.1:9999";
    process.env.LANGGRAPH_PORT = "2400";
    expect(resolveApiUrl()).toBe("http://127.0.0.1:9999");
  });

  it("derives the URL from LANGGRAPH_PORT when RAPTIX_API_URL is unset", () => {
    process.env.LANGGRAPH_PORT = "2400";
    expect(resolveApiUrl()).toBe("http://localhost:2400");
  });

  it("trims CRLF/whitespace off the port (Windows-authored .env)", () => {
    process.env.LANGGRAPH_PORT = "2400\r\n";
    expect(resolveApiUrl()).toBe("http://localhost:2400");
  });

  it("falls back to the compose default when nothing is configured", () => {
    expect(resolveApiUrl()).toBe("http://localhost:2024");
  });
});
