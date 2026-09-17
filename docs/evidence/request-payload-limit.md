# T3-20 — the 20 MiB request body limit is exact, inclusive, and refused as a `ValidationException`

Run conditions: run 3 in [`README.md`](./README.md).

The limits page states "Request payload size: Up to 20 MiB" and says nothing
about where the boundary falls or what crossing it returns. Both matter here:
this package splits a write batch so its body stays inside the limit, and a
split computed against the wrong number is either useless or needlessly small.

Bodies were built to an exact byte count and sent with `maxAttempts: 1`, so no
retry could mask a response. Each vector carried 4,096 `float32` components and
39,000 characters of page content.

```
PutVectors  body 20,970,496 bytes  (20 MiB − 1 KiB)
→ HTTP 200                                    requestId 1c90b26b-070c-8cd7-ae98-897ed5d3e29d

PutVectors  body 20,971,520 bytes  (exactly 20 MiB)
→ HTTP 200                                    requestId 178ab190-f1d1-821c-a997-da51ee9438da

PutVectors  body 20,971,521 bytes  (one byte more)
→ ValidationException, HTTP 400               requestId 101d80c7-0120-845d-bec1-9f2a51be434f
   "Request body exceeds max allowed size"

PutVectors  body 20,972,544 bytes  (20 MiB + 1 KiB)
→ ValidationException, HTTP 400               requestId 19e2f2e3-6dfc-81e7-b3b4-d62fdcd55bd0

PutVectors  body 25,007,410 bytes  (~23.9 MiB)
→ ValidationException, HTTP 400               requestId 1ea19755-099b-8fe9-86c1-38b0696ac2bb
```

Each over-limit size was sent three times; all nine returned the same
`ValidationException`, in about 500 ms — the service answers on the declared
length, before reading the body.

## What this establishes

- **The limit is 20,971,520 bytes of request body, and it is inclusive.** A body
  of exactly that size is accepted; one byte more is refused. `internal/request-size.ts`
  uses that number directly.
- **The refusal is a `ValidationException`,** which this package maps to
  `AWS_REJECTED` with `retryable: false` — correct, since retrying cannot help.
- **The body is what is measured, and the body is `JSON.stringify` of the
  command input.** Verified locally byte for byte, and guarded on every run by
  `test/contract/request-body-is-json.test.ts`, because the split is computed
  from a count of bytes that never reach the wire as anything else.

## One response is not the refusal

In an earlier run of the same probe, one oversize send of ten came back as a
connection reset rather than a 400:

```
PutVectors  body 20,972,544 bytes
→ TimeoutError / ECONNRESET  "socket hang up"   (client-side, after 103 ms)
```

The service appears to answer and close while the client is still writing. That
shape reaches this package as the SDK's `TimeoutError`, which it classifies
`SERVICE_UNAVAILABLE` with `retryable: true` — advice to retry a request that
can never succeed. It is another reason the size is bounded locally rather than
left to the service to refuse.

## Guarded by

`test/integration/payload-limit.test.ts` — "accepts a body of exactly 20 MiB and
refuses one byte more". It uploads about 40 MB, which is why it is in the
on-demand live tier and nowhere else.
