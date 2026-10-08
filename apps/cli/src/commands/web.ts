import type { Command, CommandContext } from "./types.js";

/**
 * `/web` slash command — print the URL of the web dashboard.
 *
 * W20 retirement: the legacy Next.js `web` compose service was removed
 * from docker-compose.yml; its archived GHCR image is pull-only for
 * emergency rollback. The active web tier is the web-raptix stack
 * (docker-compose.web-raptix.yml, same-origin port 3000) managed from
 * the host, so this command only reports the URL and points operators
 * at the new lifecycle commands.
 */
const web: Command = {
  name: "web",
  description: "Print the URL of the web-raptix dashboard",
  aliases: ["dashboard"],
  argumentHint: "[url]",
  execute: async (args, context) => {
    const arg = args.trim().toLowerCase();
    if (arg && arg !== "url") {
      context.addSystemEvent(RETIREMENT_NOTICE);
      return;
    }
    context.addSystemEvent(`Web dashboard URL: ${url()}`);
  },
};

export default web;

const RETIREMENT_NOTICE =
  "ℹ️ Dashboard lifecycle moved to the host with the W20 cutover: run " +
  "`docker compose -f docker-compose.web-raptix.yml up -d` (or `make webraptix-up`) " +
  "to start it, `down` to stop. The legacy raptix-web image is archived for rollback.";

function url(): string {
  return `http://localhost:${process.env["WEB_PORT"] ?? "3000"}`;
}
