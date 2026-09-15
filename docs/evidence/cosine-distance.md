# T3-5 — cosine distance is `1 − cosine_similarity`

Run conditions: see [`README.md`](./README.md) in this directory. Index: dimension 4, `cosine`.

**Claim confirmed, exactly.** Four vectors stored, queried with `[1,0,0,0]`,
`returnDistance: true`:

| Key | Stored vector | cosine similarity | Expected `1 − sim` | Returned `distance` |
|---|---|---|---|---|
| `same` | `[1,0,0,0]` | 1 | 0 | **0** |
| `scaled` | `[5,0,0,0]` | 1 | 0 | **0** |
| `orth` | `[0,1,0,0]` | 0 | 1 | **1** |
| `opp` | `[-1,0,0,0]` | −1 | 2 | **2** |

`distanceMetric` on the response: `"cosine"`.

## What this establishes

- `cosineRelevanceScoreFn(d) = 1.0 - d` is the exact inverse of the returned
  value, not an approximation.
- The distance range is **[0, 2]**, so the relevance score range is **[−1, 1]**.
  A caller thresholding at 0 is asking for "no worse than orthogonal".
- `scaled` returning 0 confirms the measure is magnitude-independent — cosine
  similarity, not an inner product.
