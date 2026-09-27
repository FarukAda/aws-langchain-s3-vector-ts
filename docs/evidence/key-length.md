# T3-27 — a vector key is bounded in UTF-8 bytes as well as characters

Run conditions: run 5 in [`README.md`](./README.md).

**Claim settled.** A vector key is refused past **1,024 characters** by the
request's own validation, and past **1,024 UTF-8 bytes** by the service. The
byte bound applies to `PutVectors`, `GetVectors` and `DeleteVectors` alike. AWS
documents only "Length Constraints: Minimum length of 1. Maximum length of 1024",
with no unit.

## Measurements

Index: dimension 4, `cosine`. Each key written with empty metadata.

| Key | Characters (UTF-16 units) | UTF-8 bytes | Result |
|---|---|---|---|
| `a`×1024 | 1024 | 1024 | accepted, read back |
| `a`×1025 | 1025 | 1025 | refused (length) |
| `中`×341 | 341 | 1023 | accepted, read back |
| `中`×340 + `abcd` | 344 | 1024 | accepted |
| `中`×340 + `abcde` | 345 | 1025 | refused (bytes) |
| `中`×342 | 342 | 1026 | refused (bytes) |
| `中`×1024 | 1024 | 3072 | refused (bytes) |
| `😀`×256 | 512 | 1024 | accepted |
| `😀`×512 | 1024 | 2048 | refused (bytes) |
| `😀`×1024 | 2048 | 4096 | refused (bytes) |

Rejections, verbatim:

```
1 validation error detected. Value with length 1025 at '/vectors/0/key' failed
  to satisfy constraint: Member must have length between 1 and 1024, inclusive
Record key length exceeds the maximum allowed
```

`GetVectors` and `DeleteVectors` with the 1,026-byte key `中`×342 were both
refused with the second message.

## Consequence for the contracts

An id must be 1–1,024 characters **and** at most 1,024 UTF-8 bytes, checked on
every path that sends one. The byte bound is the one that binds for any id
outside ASCII. `test/integration/evidence-guards-run5.test.ts` re-checks the
1,024/1,025-byte boundary and the read and delete refusals.
