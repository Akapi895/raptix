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

describe("resolveControlUrl", () => {
  it("prefers an explicit control-plane URL over the port default", async () => {
    const { resolveControlUrl } = await import("./apiUrl.js");
    const saved = { url: process.env.RAPTIX_CONTROL_URL, port: process.env.WEB_API_PORT };
    try {
      process.env.RAPTIX_CONTROL_URL = " http://127.0.0.1:9090 ";
      expect(resolveControlUrl()).toBe("http://127.0.0.1:9090");
      delete process.env.RAPTIX_CONTROL_URL;
      process.env.WEB_API_PORT = "8200";
      expect(resolveControlUrl()).toBe("http://127.0.0.1:8200");
      delete process.env.WEB_API_PORT;
      expect(resolveControlUrl()).toBe("http://127.0.0.1:8081");
    } finally {
      if (saved.url === undefined) delete process.env.RAPTIX_CONTROL_URL; else process.env.RAPTIX_CONTROL_URL = saved.url;
      if (saved.port === undefined) delete process.env.WEB_API_PORT; else process.env.WEB_API_PORT = saved.port;
    }
  });
});
