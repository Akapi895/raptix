"""A partial corpus must be reported before any retirement is considered."""

import json

from raptix.knowledge.reference.loader import read_corpus


def test_corpus_reports_invalid_records_and_hashes_valid_source(tmp_path):
    (tmp_path / "valid.yaml").write_text(
        json.dumps({"id": "cwe:CWE-1", "source": "cwe", "type": "weakness", "name": "Test"}),
        encoding="utf-8",
    )
    (tmp_path / "invalid.yaml").write_text("id: broken", encoding="utf-8")
    records, report = read_corpus(tmp_path)
    assert len(records) == 1
    assert report["errors"][0]["path"] == "invalid.yaml"
    assert len(report["sources"]["cwe"]["sha256"]) == 64


def test_duplicate_identity_is_not_silently_merged_in_the_corpus(tmp_path):
    for name in ("one.yaml", "two.yaml"):
        (tmp_path / name).write_text(
            json.dumps(
                {"id": "atlas:AML.T1", "source": "atlas", "type": "technique", "name": "Same ID"}
            ),
            encoding="utf-8",
        )
    records, report = read_corpus(tmp_path)
    assert len(records) == 1
    assert report["errors"][0]["error"] == "duplicate namespaced id"
