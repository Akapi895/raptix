import { describe, expect, it } from "vitest";
import web from "./web.js";
import type { CommandContext } from "./types.js";

function fakeContext(): { ctx: CommandContext; events: string[] } {
  const events: string[] = [];
  return {
    ctx: { addSystemEvent: (msg: string) => events.push(msg) } as unknown as CommandContext,
    events,
  };
}

describe("/web command (post-W20 retirement)", () => {
  it("/web url reports the web-raptix dashboard URL", async () => {
    const { ctx, events } = fakeContext();

    await web.execute("url", ctx);

    expect(events).toHaveLength(1);
    expect(events[0]).toContain("http://localhost:3000");
  });

  it("bare /web also reports the URL", async () => {
    const { ctx, events } = fakeContext();

    await web.execute("", ctx);

    expect(events).toHaveLength(1);
    expect(events[0]).toContain("Web dashboard URL: http://localhost:3000");
  });

  it("lifecycle args point at the new-stack host commands instead of compose", async () => {
    const { ctx, events } = fakeContext();

    await web.execute("up", ctx);

    expect(events).toHaveLength(1);
    expect(events[0]).toContain("docker-compose.web-raptix.yml");
    expect(events[0]).toContain("W20");
  });
});
