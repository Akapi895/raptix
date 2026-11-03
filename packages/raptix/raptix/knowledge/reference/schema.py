"""Map normalized corpus types and relationships to reference-only labels."""

TYPE_LABELS = {
    ("attack", "technique"): "KrgAttackTechnique",
    ("attack", "subtechnique"): "KrgAttackTechnique",
    ("attack", "tactic"): "KrgAttackTactic",
    ("attack", "mitigation"): "KrgMitigation",
    ("attack", "group"): "KrgAttackGroup",
    ("attack", "software"): "KrgAttackSoftware",
    ("attack", "campaign"): "KrgAttackCampaign",
    ("cwe", "weakness"): "KrgCwe",
    ("capec", "attack_pattern"): "KrgCapec",
    ("cisa", "kev_entry"): "KrgCisaKev",
    **{
        ("owasp", kind): "KrgOwaspControl"
        for kind in ("cheatsheet", "risk_category", "test", "verification_requirement")
    },
    ("atlas", "case-study"): "KrgAtlasCase",
    ("atlas", "technique"): "KrgAtlasTechnique",
    ("atlas", "tactic"): "KrgAtlasTactic",
}
LABELS = frozenset(TYPE_LABELS.values()) | {"KrgUnresolvedRef"}
RELATIONSHIPS = {
    "child_of": "CHILD_OF",
    "childof": "CHILD_OF",
    "related_weakness": "RELATED_WEAKNESS",
    "maps_to_weakness": "RELATED_WEAKNESS",
    "employs": "EMPLOYS",
    "enriches": "ENRICHES",
    "references": "REFERENCES",
    "uses": "USES",
    "mitigates": "MITIGATES",
    "subtechnique_of": "CHILD_OF",
    "subtechnique-of": "CHILD_OF",
    "specializes": "CHILD_OF",
    "achieves": "IMPLEMENTS_TACTIC",
    "maps_to": "MAPS_TO",
    "attributed-to": "ATTRIBUTED_TO",
    "can_precede": "CAN_PRECEDE",
    "canprecede": "CAN_PRECEDE",
    "can_follow": "CAN_FOLLOW",
    "peer_of": "PEER_OF",
    "peerof": "PEER_OF",
    "can_also_be": "CAN_ALSO_BE",
    "canalsobe": "CAN_ALSO_BE",
    "related_attack_pattern": "RELATED_ATTACK_PATTERN",
    "requires": "REQUIRES",
    "startswith": "STARTS_WITH",
    "belongs_to": "BELONGS_TO",
}
