"""Pure Slither parser failure behavior and dedicated observation kinds."""

import pytest
from raptix_contracts.slither import parse_slither_json


@pytest.mark.parametrize(
    "payload", ["invalid-json", {"success": False}, {"results": {"detectors": []}}]
)
def test_failed_or_empty_slither_run_produces_no_observations(payload) -> None:
    assert parse_slither_json(payload) == (0, [])


def test_slither_preserves_stable_ids_and_all_affected_elements() -> None:
    count, observations = parse_slither_json(
        {
            "success": True,
            "results": {
                "detectors": [
                    {
                        "id": "stable-id",
                        "check": "reentrancy-eth",
                        "impact": "High",
                        "description": "call before write",
                        "elements": [
                            {
                                "type": "function",
                                "name": "withdraw",
                                "source_mapping": {
                                    "filename_relative": "Vault.sol",
                                    "start": 10,
                                    "lines": [3, 7],
                                },
                            },
                            {
                                "type": "variable",
                                "name": "balances",
                                "source_mapping": {
                                    "filename_relative": "Vault.sol",
                                    "start": 20,
                                    "lines": [4],
                                },
                            },
                        ],
                    }
                ]
            },
        }
    )
    assert count == 1
    vulnerability = next(
        observation
        for observation in observations
        if observation["key"] == "slither::vuln::reentrancy-eth::stable-id"
    )
    assert len(vulnerability["edges_out"]) == 2
    assert any(observation["props"].get("lines") == [3, 7] for observation in observations)


def test_detector_without_stable_id_fails_before_any_batch_is_emitted() -> None:
    with pytest.raises(ValueError, match="missing the stable 'id'"):
        parse_slither_json({"results": {"detectors": [{"check": "reentrancy-eth"}]}})
