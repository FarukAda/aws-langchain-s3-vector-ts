# Support

This is an open-source project maintained by one person in their own time. Response times are best effort.

- **Bugs and feature requests**: open an issue using the templates. They ask for the package, peer and Node versions and which features (`createIndexIfNotExist`, `pageContentMetadataKey`, `nonFilterableMetadataKeys`, an injected client) are configured, which is what a useful reproduction needs.
- **Questions**: open an issue; a blank issue is fine when none of the templates fit.
- **Security**: see [SECURITY.md](SECURITY.md) — never in a public issue.

Before reporting, check the README's *Errors*, *Rate Limits, Payload Limits and Cost*, *IAM Permissions* and *Concurrency* sections: most runtime surprises (an `AccessDeniedException` on the first write, throttling during bulk ingest, what `deleteIndex()` removes, a stale index after an out-of-band recreate) are described there together with what to do.
