# Support

This is an open-source project maintained by one person in their own time. Response times are best effort.

- **Bugs and feature requests**: open an issue using the templates. They ask for the package, peer and Node versions and which features (`createIndexIfNotExist`, `pageContentMetadataKey`, `nonFilterableMetadataKeys`, an injected client) are configured, which is what a useful reproduction needs.
- **Questions**: open an issue; a blank issue is fine when none of the templates fit.
- **Security**: see [SECURITY.md](SECURITY.md) — never in a public issue.
- **What is stable**: see [docs/STABILITY.md](docs/STABILITY.md) for the API, storage-layout and peer-range promises of `1.x`.

Before reporting, check the README's *Errors*, *Rate Limits, Payload Limits and Cost*, *IAM Permissions* and *Concurrency* sections: most runtime surprises (an `AccessDeniedException` on the first write, throttling during bulk ingest, what `deleteAll` removes, a stale index after an out-of-band recreate) are described there together with what to do.
