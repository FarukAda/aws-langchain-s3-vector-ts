# T3-29 — CreateIndex enforces its documented tag rules

Run conditions: run 6 in [`README.md`](./README.md).

**Claim settled.** `CreateIndex` refuses every tag this package refuses before
sending it: more than 50 tags, a key under the reserved `aws:` prefix, and a key
or value with a character outside its documented pattern
`^([\p{L}\p{Z}\p{N}_.:/=+\-@]*)$`. It accepts what that pattern and count admit.
The CreateIndex API reference states the pattern and the tagging guide the
count ("up to 50 tag key-value pairs"); the `aws:` rule comes from AWS's general
tagging guidance. None of the three had been checked against the service.

## Method

One `CreateIndex` per case, each on its own index name, raw SDK with
`maxAttempts: 1`. Index: dimension 4, `cosine`, `float32`. Every index that was
created was deleted at once, and the bucket after the run.

## Measurements

Controls — accepted, which also shows the caller may create a tagged index at
all (`s3vectors:TagResource`):

| Tags | Result |
|---|---|
| `{ team: 'search' }` | accepted |
| `{ 'Ünï cödé_.:/=+-@9': 'välue 1_.:/=+-@' }` — every documented class | accepted |
| 50 tags | accepted |
| `{ team: '' }` | accepted |
| `{ 'k𝒜': 'v𝒜' }` — a letter outside the Basic Multilingual Plane | accepted |

What this package refuses before `CreateIndex` — every one refused by the
service too, each with `ValidationException` (HTTP 400):

| Tags | Service's message |
|---|---|
| 51 tags | `Too many tags specified` |
| `{ 'aws:owner': 'x' }` | `System tags cannot be added/updated by requester` |
| an emoji in a value, or in a key | `Member must satisfy regular expression pattern: ^([\p{L}\p{Z}\p{N}_.:/=+\-@]*)$` |
| a tab, or a newline, in a value | the same pattern message |
| each of `` ! " # $ % & ' ( ) * , ; < > ? [ \ ] ^ ` { \| } ~ `` in a value | the same pattern message, for each of the 24 |
| `#`, `&`, `!` or `*` in a key | the same pattern message, at path `/tags` |

A value's failure names its path, `/tags/team`; a key's names `/tags`.

Accepted by this package, and asked only to know whether the service agrees:

| Tags | Result |
|---|---|
| `{ team: 'aws:x' }` — a value starting `aws:` | accepted |
| `{ ' team': 'x' }` — a key with a leading space | accepted |
| `{ 'AWS:owner': 'x' }` — the prefix in upper case | refused: `Invalid System Tag: AWS:owner must be prefixed with "aws:" in lowercase.` |

## Consequence for the contracts

The three rules this package applies before `CreateIndex` are the service's
own, so refusing them early refuses nothing the service would have accepted.
They are applied only when this store creates the index, because an index that
already exists never receives the tags. `test/integration/evidence-guards-run6.test.ts`
re-checks the refusals and the controls.

One refusal the service makes is not made here: a key whose `aws:` prefix is
not in lower case, such as `AWS:owner`. It still fails, at `CreateIndex`, with
the message above.
