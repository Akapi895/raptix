import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FilesystemSkillsCorpus } from "../../src/adapters/skills/corpus.js";

describe("skills routes", () => {
  describe("writes (stubbed -- Skillogy's REST surface has no unconditional list, corpus writes need its own pipeline)", () => {
    let app: FastifyInstance;
    let token: string;

    beforeEach(async () => {
      ({ app, token } = await buildAuthedTestApp());
    });

    afterEach(async () => {
      await app.close();
    });

    it.each([
      ["POST", "/api/skills"],
      ["PUT", "/api/skills/oauth"],
      ["DELETE", "/api/skills/oauth"],
      ["GET", "/api/skills/oauth/bound-roles"],
      ["PUT", "/api/skills/oauth/file"],
      ["DELETE", "/api/skills/oauth/stats"],
      ["DELETE", "/api/skills/stats"],
    ] as const)("%s %s is stubbed 501", async (method, url) => {
      const response = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: {} });
      expect(response.statusCode).toBe(501);
    });

    it("rejects an unauthenticated request", async () => {
      const response = await app.inject({ method: "GET", url: "/api/skills" });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("reads (real -- straight off a Git-authored SKILL.md corpus on disk)", () => {
    let app: FastifyInstance;
    let token: string;
    let corpusDir: string;

    beforeAll(async () => {
      corpusDir = await mkdtemp(path.join(tmpdir(), "raptix-skills-test-"));
      const activeRecon = path.join(corpusDir, "standard", "recon", "active-recon");
      await mkdir(path.join(activeRecon, "references"), { recursive: true });
      await writeFile(
        path.join(activeRecon, "SKILL.md"),
        [
          "---",
          "name: active-recon",
          'description: "Active target probing"',
          "metadata:",
          "  subdomain: reconnaissance",
          "  tags: nmap, port-scan",
          "---",
          "",
          "# Active Reconnaissance",
          "",
          "Body content here.",
        ].join("\n"),
      );
      await writeFile(path.join(activeRecon, "references", "cheatsheet.md"), "nmap -sS -sV <TARGET>");

      const oauth = path.join(corpusDir, "standard", "web", "oauth");
      await mkdir(oauth, { recursive: true });
      await writeFile(path.join(oauth, "SKILL.md"), ["---", "name: oauth", 'description: "OAuth flaw hunting"', "---", "", "Body."].join("\n"));
    });

    afterAll(async () => {
      await rm(corpusDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      ({ app, token } = await buildAuthedTestApp({ skillsCorpus: new FilesystemSkillsCorpus(corpusDir) }));
    });

    afterEach(async () => {
      await app.close();
    });

    it("lists every skill found in the corpus, paginated", async () => {
      const response = await app.inject({ method: "GET", url: "/api/skills", headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(2);
      expect(body.skills.map((skill: { name: string }) => skill.name).sort()).toEqual(["active-recon", "oauth"]);
      expect(body.skills.find((skill: { name: string }) => skill.name === "active-recon")).toMatchObject({
        id: "active-recon",
        description: "Active target probing",
        tags: ["nmap", "port-scan"],
        path: "standard/recon/active-recon",
        file_count: 1,
      });
    });

    it("filters by search across name, description and tags", async () => {
      const response = await app.inject({ method: "GET", url: "/api/skills?search=oauth", headers: { authorization: `Bearer ${token}` } });
      const body = response.json();
      expect(body.total).toBe(1);
      expect(body.skills[0].name).toBe("oauth");
    });

    it("returns a skill's full content by name", async () => {
      const response = await app.inject({ method: "GET", url: "/api/skills/active-recon", headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: "active-recon", content: "# Active Reconnaissance\n\nBody content here." });
    });

    it("depth=summary omits the content body", async () => {
      const response = await app.inject({ method: "GET", url: "/api/skills/active-recon?depth=summary", headers: { authorization: `Bearer ${token}` } });
      expect(response.json().content).toBeUndefined();
    });

    it("404s for an unknown skill name", async () => {
      const response = await app.inject({ method: "GET", url: "/api/skills/does-not-exist", headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(404);
    });

    it("lists a skill's package files alongside SKILL.md", async () => {
      const response = await app.inject({ method: "GET", url: "/api/skills/active-recon/files", headers: { authorization: `Bearer ${token}` } });
      expect(response.json()).toEqual({ files: [{ path: "references/cheatsheet.md" }] });
    });

    it("reads one package file's content", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/skills/active-recon/file?path=" + encodeURIComponent("references/cheatsheet.md"),
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.json()).toEqual({ content: "nmap -sS -sV <TARGET>" });
    });

    it("rejects a path-traversal attempt on a package file", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/skills/active-recon/file?path=" + encodeURIComponent("../../../etc/passwd"),
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
    });

    it("stats reflects a real corpus count with honestly-zero invocation telemetry", async () => {
      const response = await app.inject({ method: "GET", url: "/api/skills/stats", headers: { authorization: `Bearer ${token}` } });
      expect(response.json()).toEqual({ total_skills: 2, total_calls: 0, total_success: 0, total_failed: 0, stats: [] });
    });
  });
});
