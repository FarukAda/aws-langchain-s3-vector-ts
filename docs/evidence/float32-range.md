# T3-28 — vector components are judged after conversion to float32

Run conditions: run 5 in [`README.md`](./README.md).

**Claim settled.** S3 Vectors converts each component to float32 and then
applies its rules to the converted value: a finite double that rounds to
Infinity is refused as a non-finite value, and a cosine vector whose components
all round to zero is refused as a zero vector. The PutVectors reference says
wider values are converted before storing; it does not say the rules apply
after that conversion.

## Measurements

Index: dimension 4, `cosine`.

| Vector | `Math.fround` of the first component | Result |
|---|---|---|
| `[1e39, 1, 1, 1]` | `Infinity` | refused: `vector contains NaNs or Infs` |
| `[3.40282357e38, 1, 1, 1]` | `Infinity` | refused: `vector contains NaNs or Infs` |
| `[3.4028235e38, 1, 1, 1]` | `3.4028234663852886e38` (FLT_MAX) | accepted, stored as FLT_MAX |
| `[1e-46, 1e-46, 1e-46, 1e-46]` | `0` | refused: `cosine distance does not support vectors with zero norm` |
| `[1.5e-45, …]` | `1.401298464324817e-45` (smallest subnormal) | accepted, stored as that value |

As a query vector, `[1e39, 1, 1, 1]` and `[1e-46, 1e-46, 1e-46, 1e-46]` were both
refused with `Query vector contains invalid values or is invalid for this index`.

## Consequence for the contracts

A component is checked as `Math.fround(component)`: not finite is refused, and
on a cosine index the norm is taken over the rounded values. That is exactly the
service's rule, so nothing it accepts is refused locally.
`test/integration/evidence-guards-run5.test.ts` re-checks the overflow, the
float32 zero vector and the query refusal.
