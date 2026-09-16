# T3-10 — a zero vector is rejected on a cosine index

Run conditions: see [`README.md`](./README.md) in this directory. Index: dimension 4, `cosine`.

**Claim settled: AWS rejects it, on both paths.**

Writing one:

```
PutVectors  vectors: [{ key: 'zero', data: { float32: [0,0,0,0] } }]
→ ValidationException, HTTP 400
   "Invalid record for key 'zero': cosine distance does not support vectors with zero norm"
   fieldList: [{ path: "vectors[0]",
                 message: "cosine distance does not support vectors with zero norm" }]
```

Querying with one:

```
QueryVectors  queryVector: { float32: [0,0,0,0] }
→ ValidationException, HTTP 400
   "Query vector contains invalid values or is invalid for this index"
   fieldList: [{ path: "vector",
                 message: "Invalid input: cosine distance does not support vectors with zero norm" }]
```

## What this establishes

A zero vector is invalid to write **and** to query on a cosine index. This is
reachable without misuse: an embeddings model handed an empty string, or a
normalisation step dividing by a zero norm, produces exactly this.

**The rule is metric-specific.** Both messages name *cosine* distance, so the
rejection follows from the metric rather than the data type, and a euclidean
index is not covered by this evidence. A local check must therefore apply only
when `distanceMetric` is `cosine`. Asserting it unconditionally would reject
writes a euclidean index may well accept, and nothing here establishes what a
euclidean index does with a zero vector.
