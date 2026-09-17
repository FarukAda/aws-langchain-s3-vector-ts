# T3-15 — an unpaired UTF-16 surrogate fails the whole request

Run conditions: run 2 in [`README.md`](./README.md).

A JavaScript string is UTF-16. A character outside the Basic Multilingual Plane —
every emoji, many CJK characters — is a surrogate *pair* of two code units, and
text cut by code unit (`slice`, a byte budget applied to `length`, a naive
splitter) can leave one half behind. `JSON.stringify` writes that lone half as an
escape (`"\ud800"`), and the service refuses the request carrying it:

```
SerializationException, HTTP 400
message: "UnknownError"
```

The same answer came back for a lone surrogate in every position probed:

| Command | Position |
|---|---|
| `PutVectors` | a metadata value — a high surrogate (`'x\ud800'`) and a low one (`'\udc00x'`) |
| `PutVectors` | an element of a metadata array |
| `PutVectors` | a metadata key |
| `PutVectors` | a vector key |
| `GetVectors` | a key |
| `DeleteVectors` | a key |
| `QueryVectors` | a filter's shorthand string, and an element of `$in` |
| `CreateIndex` | a tag key, a tag value, a non-filterable metadata key, and a KMS key ARN |

The KMS key ARN row was not among the probes; it was established by its guard in
`test/integration/evidence-guards.test.ts`, which sends the request through the
raw SDK and received the same answer on the suite's first live run.

Controls in the same run: the surrogate *pair* `'😀'` was accepted as a
metadata value, as a vector key and as a filter string.

## What this establishes

- The failure is the request, not the record: one chunk of page content cut
  mid-emoji fails its entire `PutVectors` batch.
- The response names nothing — not the field, not the record, not the reason —
  and `SerializationException` is not an exception the service model declares.
  Unchecked, this package can only ever surface it as `AWS_REQUEST_FAILED`.
- Any string this package sends can carry the problem, so the rule applies at
  every boundary a caller's string crosses: metadata keys and values (page
  content included), vector ids on write, read and delete, filter field names and
  strings, and the tags, non-filterable keys and KMS key ARN an index is created
  with. A string passes when `String.prototype.isWellFormed()` is `true`.
