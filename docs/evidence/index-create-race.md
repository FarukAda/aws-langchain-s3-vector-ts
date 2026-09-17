# T3-23 — the winner's configuration is readable the moment a creation race is lost

Run conditions: run 3 in [`README.md`](./README.md).

When two stores write to the same new index, one `CreateIndex` wins and the
other is refused. The refusal means the index exists, which is the requested
state — but it exists with the *winner's* configuration, and a non-filterable
key set is fixed at creation. A loser that records "the index exists" and asks
nothing else will budget metadata against a set the index does not have, for as
long as it lives.

Five races, each two concurrent `CreateIndex` calls on a fresh index name, with
different non-filterable key sets (`['_page_content']` against
`['_page_content', 'other']`), `maxAttempts: 1` on both clients. The loser then
issued `GetIndex` immediately.

```
trial 1  loser → ConflictException, HTTP 409   "An index with the specified name already exists"
         GetIndex 141 ms → metadataConfiguration { nonFilterableMetadataKeys: ['_page_content'] }
trial 2  loser → ConflictException, HTTP 409   GetIndex 128 ms → the winner's keys
trial 3  loser → ConflictException, HTTP 409   GetIndex 134 ms → the winner's keys
trial 4  loser → InternalServerException, HTTP 500  "Internal server error"
         GetIndex 137 ms → the winner's keys
trial 5  loser → ConflictException, HTTP 409   GetIndex 136 ms → the winner's keys

control  CreateIndex (uncontended) then GetIndex at once → found
```

## What this establishes

- **A `GetIndex` issued straight after the conflict returns the winner's
  configuration** — 5 of 5, in 128–141 ms. There is no window in which the index
  exists but reads as unconfigured, so the loser can check what it joined. That
  is what `internal/index-lifecycle.ts` now does, at the cost of one request on
  the race path only.
- **A racing `CreateIndex` may fail with a 500 rather than the conflict.** 1 of 5
  losers got `InternalServerException`. With the SDK's default retries that is
  retried and then meets the conflict; with `maxAttempts: 1` it surfaces as
  `SERVICE_UNAVAILABLE`. Worth knowing before reading a 500 here as a service
  outage.

## Guarded by

`test/integration/index-create-race.test.ts` — "a loser can read the winner's
configuration immediately".
