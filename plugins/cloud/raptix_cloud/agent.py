"""Cloud hunter identity and baseline capability declaration."""

from raptix_sdk import DomainAgentDefinition, PromptResource, domain_subagent

DEFINITION = DomainAgentDefinition(
    role="cloud_hunter",
    description=(
        "AWS / Azure / GCP / Kubernetes exploitation specialist. Use for "
        "IAM policy privesc, S3 bucket takeover, Kubernetes RBAC / hostPath "
        "escapes, Terraform state secret extraction, and cloud metadata "
        "pivoting after an SSRF is confirmed by recon or analyst."
    ),
    tool_names=(
        "iam_policy_audit",
        "s3_buckets_from_text",
        "user_data_secrets",
        "k8s_audit",
        "tfstate_audit",
        "metadata_endpoints",
        "cve_lookup",
        "bash",
        "bash_output",
        "bash_kill",
        "bash_status",
    ),
    recursion_limit=1000,
    priority=60,
)
SUBAGENT_SPEC = domain_subagent(DEFINITION)
create_cloud_hunter_agent = SUBAGENT_SPEC.factory
PROMPTS = (PromptResource("cloud_hunter", "raptix_cloud", "prompts/cloud_hunter.md"),)
