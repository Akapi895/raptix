---
name: aws-iam-enum
description: Enumerate AWS IAM policies, detect privilege escalation paths per Rhino Security Labs canonical 21 primitives.
metadata:
  subdomain: cloud
  when_to_use: "aws iam enumeration privesc rhino security labs 21 primitives policy escalation"
  mitre_attack:
    - T1087.004
    - T1069.003
    - T1078.004
    - T1098.003
---

# AWS IAM Enumeration + Privesc

## 1. Identity check
```bash
aws sts get-caller-identity
aws iam get-account-summary
```

## 2. Attached policies
```bash
aws iam list-attached-user-policies --user-name ME --output json > /tmp/attached.json
aws iam list-user-policies          --user-name ME --output json > /tmp/inline.json
aws iam list-groups-for-user        --user-name ME --output json > /tmp/groups.json
```
For each attached policy ARN:
```bash
aws iam get-policy --policy-arn ARN --query 'Policy.DefaultVersionId'
aws iam get-policy-version --policy-arn ARN --version-id VID > /tmp/policy.json
```
Then:
```
iam_policy_audit(open("/tmp/policy.json").read())
```

## 3. Check each privesc primitive
Rhino Security's canonical 21 paths — any `Allow` on these is a chain step:
1. iam:CreateAccessKey (other user)
2. iam:CreateLoginProfile
3. iam:UpdateLoginProfile
4. iam:AttachUserPolicy / iam:AttachGroupPolicy / iam:AttachRolePolicy
5. iam:PutUserPolicy / iam:PutGroupPolicy / iam:PutRolePolicy
6. iam:CreatePolicyVersion (if SetAsDefault=true)
7. iam:SetDefaultPolicyVersion
8. iam:PassRole + lambda:CreateFunction + lambda:InvokeFunction
9. iam:PassRole + ec2:RunInstances
10. iam:PassRole + ecs:RunTask / UpdateService
11. glue:CreateDevEndpoint / UpdateDevEndpoint
12. cloudformation:CreateStack with iam:PassRole
13. datapipeline:CreatePipeline
14. lambda:UpdateFunctionCode (existing function with priv role)
15. iam:AddUserToGroup
16. iam:UpdateAssumeRolePolicy
17. iam:CreateRole + sts:AssumeRole
18. codebuild:CreateProject with iam:PassRole
19. sagemaker:CreateTrainingJob with iam:PassRole
20. aws-marketplace:Subscribe (rare, but noted)
21. sts:AssumeRole (direct)

## 4. Findings promotion
Note the primitive in your findings record (your role has no direct
KG write tool — the auto-ingest pipeline and the orchestrator own
graph writes): `IAM:CreateAccessKey → account takeover` (severity
critical, source aws-iam) reaching the crown jewel
`AWS Account 1234` (grants, weight 0.3).

## 5. Common chains
- Dev user has `iam:PassRole` + `lambda:CreateFunction` + a Lambda role
  with admin → create malicious Lambda → assume admin
- `iam:UpdateLoginProfile` + `sts:GetFederationToken` → temporary
  console access as another user
