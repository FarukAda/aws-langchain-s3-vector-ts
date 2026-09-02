# Security Policy

## Supported Versions

Security fixes are made against the **latest published release of the current major version**. Older releases — including any earlier major — are not separately patched; upgrade to the latest release to receive fixes.

| Version                                   | Supported |
| ----------------------------------------- | --------- |
| Latest release of the current major | ✅ |
| Older releases                            | ❌ |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report privately using one of:

1. [GitHub Security Advisories](https://github.com/FarukAda/aws-langchain-s3-vector-ts/security/advisories/new) for this repository (preferred — supports coordinated disclosure).
2. Email **info@farukada.com** with a description of the issue, steps to reproduce, and any relevant logs or proof-of-concept code (please don't include real AWS credentials or account IDs).

You should receive an acknowledgement within 5 business days. Once a fix is available, it's released as a new version and noted in [`CHANGELOG.md`](./CHANGELOG.md); credit is given in the release notes unless you ask to remain anonymous.

## Scope

This package is a thin client wrapper around `@aws-sdk/client-s3vectors`. It does not persist or transmit AWS credentials itself — `credentials` passed in the store config are handed to the AWS SDK's own credential provider chain and are **not** retained on the store object in any enumerable form (they are excluded from LangChain's `lc_kwargs` snapshot, and regression tests assert that `util.inspect`, `console.log` and `JSON.stringify` of a store or of an error carrying one never contain credential material). Vulnerabilities in the AWS SDK itself, or in Amazon S3 Vectors, should be reported to AWS directly via [aws.amazon.com/security/vulnerability-reporting](https://aws.amazon.com/security/vulnerability-reporting/).

Things that **are** in scope for this project:

- Credential or other secret material reaching logs, error messages, error context, or serialized output through this library's own code paths.
- Input handling that lets caller-supplied data alter which bucket/index a call targets, or bypass the client-side validation this library documents.
- Supply-chain integrity of the published package (provenance, lockfile, release pipeline).
