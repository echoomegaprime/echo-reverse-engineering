# Security Policy

## Reporting
Email security concerns to bobbymcwilliams@echo-op.com. Do not open public issues for secrets.

## Guarantees
- No raw shell exposure
- Mutating tools require exact `confirm: "EXECUTE"`
- Secrets never returned in tool results
- Audit log under `data/audit.jsonl`

## MCP resource
Production audience path: `/oauth-mcp-pentest-v1`
