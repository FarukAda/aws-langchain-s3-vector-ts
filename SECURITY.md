# Security Policy

## Supported Versions

This project is pre-1.0 (`0.x`). Security fixes are made against the latest published version; older `0.x` releases are not separately patched.

| Version | Supported |
| ------- | --------- |
| Latest `0.x` release | ✅ |
| Older releases | ❌ |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report privately using one of:

1. [GitHub Security Advisories](https://github.com/FarukAda/aws-langchain-s3-vector-ts/security/advisories/new) for this repository (preferred — supports coordinated disclosure).
2. Email **info@farukada.com** with a description of the issue, steps to reproduce, and any relevant logs or proof-of-concept code (please don't include real AWS credentials or account IDs).

You should receive an acknowledgement within 5 business days. Once a fix is available, it's released as a new `0.x` version and noted in [`CHANGELOG.md`](./CHANGELOG.md); credit is given in the release notes unless you ask to remain anonymous.

## Scope

This package is a thin client wrapper around `@aws-sdk/client-s3vectors` — it does not itself store, transmit, or process AWS credentials beyond passing them to the AWS SDK's own credential provider chain. Vulnerabilities in the AWS SDK itself, or in Amazon S3 Vectors, should be reported to AWS directly via [aws.amazon.com/security/vulnerability-reporting](https://aws.amazon.com/security/vulnerability-reporting/).
