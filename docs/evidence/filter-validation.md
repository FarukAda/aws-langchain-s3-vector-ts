# T3-1 and T3-11 — filter validation

Run conditions: see `README.md`. Index: dimension 4, `cosine`, one stored vector
with metadata `{ g: 'a' }`.

Every rejection below is `ValidationException`, HTTP 400, with an identical body:

```
message:   "Invalid filter"
fieldList: [{ path: "filter", message: "Invalid filter" }]
```

| Filter | Result |
|---|---|
| `{}` | **rejected** — T3-1 confirmed |
| `{ g: { $eg: 'a' } }` (typo for `$eq`) | **rejected** — T3-11 confirmed |
| `{ g: { $schema: 'https://example.com' } }` | **rejected** |
| `{ g: { $in: [] } }` | **rejected** — the documented non-empty rule confirmed |

## What this establishes

**T3-1.** `{}` is not "no filter"; it is invalid. The package's existing
rejection is correct, and it matters because a filter assembled dynamically —
conditions added only when a UI field is set — becomes `{}` on its own whenever
nothing applies.

**T3-11, and it removes the objection to local vocabulary checking.** The concern
was that a `$`-prefixed key might be a legitimate literal rather than a mistyped
operator, making local rejection a false rejection. `{ g: { $schema: … } }`
settles it: AWS rejects that too. There is no legitimate `$`-prefixed literal in
a filter position, so this package can reject an unknown operator locally without
ever refusing something the service would have accepted.

**Local checking is worth more than usual here**, because the service's own
diagnosis is the bare string "Invalid filter" — no indication of which operator,
which field, or what was wrong with it. A local check can name all three.
