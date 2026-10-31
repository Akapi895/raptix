import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeRuntime } from "../support/fake-runtime.js";

describe("batch-tasks routes", () => {
  let app: FastifyInstance;
  let token: string;
  let runtime: FakeRuntime;

  afterEach(async () => {
    await app.close();
  });

  const headers = () => ({ authorization: `Bearer ${token}` });

  async function createQueue(payload: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: "POST",
      url: "/api/batch-tasks",
      headers: headers(),
      payload: { title: "Recon sweep", tasks: ["scan host A", "scan host B"], ...payload },
    });
    return response.json();
  }

  it("rejects an unauthenticated request", async () => {
    runtime = new FakeRuntime();
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const response = await app.inject({ method: "GET", url: "/api/batch-tasks" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects create with no title or tasks", async () => {
    runtime = new FakeRuntime();
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const response = await app.inject({ method: "POST", url: "/api/batch-tasks", headers: headers(), payload: { title: "X" } });
    expect(response.statusCode).toBe(400);
  });

  it("creates a queue with one task per message, lists and reads it back", async () => {
    runtime = new FakeRuntime();
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const queue = await createQueue();
    expect(queue).toMatchObject({ title: "Recon sweep", status: "pending" });
    expect(queue.tasks).toHaveLength(2);
    expect(queue.tasks[0]).toMatchObject({ message: "scan host A", status: "pending" });

    const list = await app.inject({ method: "GET", url: "/api/batch-tasks", headers: headers() });
    expect(list.json()).toMatchObject({ total: 1, total_pages: 1 });

    const detail = await app.inject({ method: "GET", url: `/api/batch-tasks/${queue.id}`, headers: headers() });
    expect(detail.json().id).toBe(queue.id);
  });

  it("start runs every task for real through the runtime and marks the queue completed", async () => {
    runtime = new FakeRuntime();
    runtime.queueRunStatuses("success", "success");
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const queue = await createQueue();

    await app.inject({ method: "POST", url: `/api/batch-tasks/${queue.id}/start`, headers: headers() });
    // Fire-and-forget: give the background processor a tick to finish (both tasks resolve immediately).
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = await app.inject({ method: "GET", url: `/api/batch-tasks/${queue.id}`, headers: headers() });
    const body = after.json();
    expect(body.status).toBe("completed");
    expect(body.tasks.every((t: { status: string }) => t.status === "completed")).toBe(true);
    expect(runtime.createdThreads).toHaveLength(2);
    expect(runtime.createdRuns).toHaveLength(2);
  });

  it("executeNow on create starts the queue immediately", async () => {
    runtime = new FakeRuntime();
    runtime.queueRunStatuses("success", "success");
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const queue = await createQueue({ executeNow: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = await app.inject({ method: "GET", url: `/api/batch-tasks/${queue.id}`, headers: headers() });
    expect(after.json().status).toBe("completed");
  });

  it("a failed task is reflected honestly, not silently marked completed", async () => {
    runtime = new FakeRuntime();
    runtime.queueRunStatuses("error", "success");
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const queue = await createQueue();
    await app.inject({ method: "POST", url: `/api/batch-tasks/${queue.id}/start`, headers: headers() });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = await app.inject({ method: "GET", url: `/api/batch-tasks/${queue.id}`, headers: headers() });
    const body = after.json();
    expect(body.lastRunError).toContain("1 task(s) failed");
    expect(body.tasks.some((t: { status: string }) => t.status === "failed")).toBe(true);
  });

  it("pause, metadata, schedule and schedule-enabled update the queue", async () => {
    runtime = new FakeRuntime();
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const queue = await createQueue();

    const paused = await app.inject({ method: "POST", url: `/api/batch-tasks/${queue.id}/pause`, headers: headers() });
    expect(paused.json().status).toBe("paused");

    const metadata = await app.inject({ method: "PUT", url: `/api/batch-tasks/${queue.id}/metadata`, headers: headers(), payload: { title: "Renamed" } });
    expect(metadata.json().title).toBe("Renamed");

    const schedule = await app.inject({ method: "PUT", url: `/api/batch-tasks/${queue.id}/schedule`, headers: headers(), payload: { scheduleMode: "cron", cronExpr: "*/5 * * * *" } });
    expect(schedule.json()).toMatchObject({ scheduleMode: "cron", cronExpr: "*/5 * * * *" });

    const enabled = await app.inject({ method: "PUT", url: `/api/batch-tasks/${queue.id}/schedule-enabled`, headers: headers(), payload: { enabled: false } });
    expect(enabled.json().scheduleEnabled).toBe(false);
  });

  it("add, edit and delete a single task", async () => {
    runtime = new FakeRuntime();
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const queue = await createQueue();

    const added = await app.inject({ method: "POST", url: `/api/batch-tasks/${queue.id}/tasks`, headers: headers(), payload: { message: "scan host C" } });
    expect(added.json().message).toBe("scan host C");
    const taskId = added.json().id;

    const edited = await app.inject({ method: "PUT", url: `/api/batch-tasks/${queue.id}/tasks/${taskId}`, headers: headers(), payload: { message: "scan host C (retry)" } });
    expect(edited.json().message).toBe("scan host C (retry)");

    const deleted = await app.inject({ method: "DELETE", url: `/api/batch-tasks/${queue.id}/tasks/${taskId}`, headers: headers() });
    expect(deleted.json()).toEqual({ success: true });
  });

  it("runs lists completed tasks across queues", async () => {
    runtime = new FakeRuntime();
    runtime.queueRunStatuses("success", "success");
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const queue = await createQueue();
    await app.inject({ method: "POST", url: `/api/batch-tasks/${queue.id}/start`, headers: headers() });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const runs = await app.inject({ method: "GET", url: "/api/batch-tasks/runs", headers: headers() });
    expect(runs.json().runs).toHaveLength(2);
    expect(runs.json().runs[0]).toMatchObject({ title: "Recon sweep" });
  });

  it("deletes a queue", async () => {
    runtime = new FakeRuntime();
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const queue = await createQueue();
    const deleted = await app.inject({ method: "DELETE", url: `/api/batch-tasks/${queue.id}`, headers: headers() });
    expect(deleted.json()).toEqual({ success: true });
    const missing = await app.inject({ method: "GET", url: `/api/batch-tasks/${queue.id}`, headers: headers() });
    expect(missing.statusCode).toBe(404);
  });
});
