"""Unit tests for migrate_legacy_project.py, on synthetic snapshots only. Run: python -m unittest -v (from this folder)."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import migrate_legacy_project as tool


def make_checkpoints(path: Path, threads: dict[str, int]) -> None:
    conn = sqlite3.connect(path)
    conn.execute("create table checkpoints (thread_id text, checkpoint_ns text, checkpoint_id text, parent_checkpoint_id text, type text, checkpoint blob, metadata blob, primary key (thread_id, checkpoint_ns, checkpoint_id))")
    conn.execute("create table writes (thread_id text, checkpoint_ns text, checkpoint_id text, task_id text, idx integer, channel text, type text, value blob, primary key (thread_id, checkpoint_ns, checkpoint_id, task_id, idx))")
    for thread, count in threads.items():
        for index in range(count):
            conn.execute("insert into checkpoints values (?, '', ?, null, 'json', x'00', x'00')", (thread, f"{thread}-{index}"))
            conn.execute("insert into writes values (?, '', ?, 'task', 0, 'messages', 'json', x'00')", (thread, f"{thread}-{index}"))
    conn.commit()
    conn.close()


def make_mailbox(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute("create table instances (thread_id text, dispatch_id text, attempt integer, role text, state text, started_at text, updated_at text, finished_at text, primary key (thread_id, dispatch_id, attempt))")
    conn.execute("create table messages (message_id text primary key, thread_id text, dispatch_id text, attempt integer, seq integer, body text, state text, accepted_at text)")
    conn.execute("create table grants (command_id text primary key, thread_id text, source_dispatch_id text, source_attempt integer, kind text, target_dispatch_id text, target_role text, intent text)")
    conn.commit()
    conn.close()


class MigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="legacy-migration-test-"))
        self.snapshot = self.root / "snapshot"
        (self.snapshot / "state").mkdir(parents=True)
        (self.snapshot / "workspace" / "alpha" / "findings").mkdir(parents=True)
        (self.snapshot / "workspace" / "alpha" / "plan.md").write_text("plan", encoding="utf-8")
        (self.snapshot / "workspace" / "alpha" / "findings" / "f1.md").write_text("finding", encoding="utf-8")
        make_checkpoints(self.snapshot / "state" / "checkpoints.sqlite", {"t-1": 3, "t-2": 5, "other": 4})
        make_mailbox(self.snapshot / "state" / "instance_mailbox.sqlite")
        (self.snapshot / "state" / "store.pckl").write_bytes(b"global")
        self.threads_file = self.root / "threads.json"
        self.threads_file.write_text(json.dumps(["t-1", "t-2"]), encoding="utf-8")
        self.target = self.root / "target"

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.root, ignore_errors=True)

    def dry_run(self) -> dict:
        return tool.dry_run(self.snapshot, "alpha", tool.load_threads(self.threads_file), self.target)

    def environment_store(self) -> tuple[Path, Path]:
        state = self.root / "env-state"
        state.mkdir(exist_ok=True)
        for name in ("checkpoints.sqlite", "instance_mailbox.sqlite"):
            (state / name).unlink(missing_ok=True)
        make_checkpoints(state / "checkpoints.sqlite", {})
        make_mailbox(state / "instance_mailbox.sqlite")
        return state, self.root / "env-workspace" / "alpha"

    def test_dry_run_copies_only_the_chosen_threads_and_verifies(self) -> None:
        report = self.dry_run()
        self.assertTrue(report["verified"])
        self.assertEqual(report["rows"]["target"]["checkpoints.sqlite"], {"checkpoints": 8, "writes": 8})
        self.assertEqual(report["workspace"]["source"], report["workspace"]["target"])
        self.assertIn("store.pckl", [item["file"] for item in report["not_migrated_global_stores"]])
        conn = sqlite3.connect(self.target / "state" / "checkpoints.sqlite")
        self.assertEqual(conn.execute("select count(*) from checkpoints where thread_id = 'other'").fetchone()[0], 0, "a thread outside the project is never copied")
        conn.close()
        self.assertEqual(tool.verify(self.snapshot, "alpha", ["t-1", "t-2"], self.target)["verified"], True)

    def test_dry_run_refuses_a_target_inside_the_snapshot_and_a_non_empty_target(self) -> None:
        with self.assertRaises(SystemExit):
            tool.dry_run(self.snapshot, "alpha", ["t-1"], self.snapshot / "inside")
        self.target.mkdir()
        (self.target / "keep.txt").write_text("x", encoding="utf-8")
        with self.assertRaises(SystemExit):
            self.dry_run()

    def test_apply_writes_the_history_and_workspace_into_a_stopped_environment(self) -> None:
        self.dry_run()
        state, workspace = self.environment_store()
        applied = tool.apply(self.target, state, workspace)
        self.assertEqual(applied["rows_applied"]["checkpoints.sqlite"], {"checkpoints": 8, "writes": 8})
        conn = sqlite3.connect(state / "checkpoints.sqlite")
        self.assertEqual(conn.execute("select count(*) from checkpoints").fetchone()[0], 8)
        conn.close()
        self.assertEqual((workspace / "findings" / "f1.md").read_text(encoding="utf-8"), "finding")

    def test_apply_refuses_missing_store_mismatched_schema_existing_history_and_an_unverified_run(self) -> None:
        self.dry_run()
        state, workspace = self.environment_store()
        (state / "checkpoints.sqlite").unlink()
        with self.assertRaises(SystemExit):
            tool.apply(self.target, state, workspace)
        state, workspace = self.environment_store()
        conn = sqlite3.connect(state / "checkpoints.sqlite")
        conn.execute("alter table writes add column extra text")
        conn.commit()
        conn.close()
        with self.assertRaises(SystemExit):
            tool.apply(self.target, state, workspace)
        state, workspace = self.environment_store()
        conn = sqlite3.connect(state / "checkpoints.sqlite")
        conn.execute("insert into checkpoints values ('t-2', '', 'live', null, 'json', x'00', x'00')")
        conn.commit()
        conn.close()
        with self.assertRaises(SystemExit):
            tool.apply(self.target, state, workspace)
        report_path = self.target / "report.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        report["verified"] = False
        report_path.write_text(json.dumps(report), encoding="utf-8")
        with self.assertRaises(SystemExit):
            tool.apply(self.target, *self.environment_store())

    def test_unapply_removes_exactly_what_apply_wrote(self) -> None:
        self.dry_run()
        state, workspace = self.environment_store()
        tool.apply(self.target, state, workspace)
        removed = tool.unapply(self.target, state, workspace)
        self.assertEqual(removed["removed_rows"]["checkpoints.sqlite"], {"checkpoints": 8, "writes": 8})
        conn = sqlite3.connect(state / "checkpoints.sqlite")
        self.assertEqual(conn.execute("select count(*) from checkpoints").fetchone()[0], 0)
        conn.close()
        self.assertFalse((workspace / "findings" / "f1.md").exists())
        self.assertTrue((self.target / "unapply.json").exists())

    def test_rollback_refuses_a_directory_without_the_dry_run_marker(self) -> None:
        self.target.mkdir()
        with self.assertRaises(SystemExit):
            tool.rollback(self.target)
        self.dry_run()
        tool.rollback(self.target)
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
