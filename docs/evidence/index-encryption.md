# T3-22 — `CreateIndex` enforces the KMS pairing in both directions

Run conditions: run 3 in [`README.md`](./README.md).

The API reference marks `kmsKeyArn` as `Required: No` and says it "is allowed if
and only if `sseType` is set to `aws:kms`". What it does not say is that the
service enforces *both* halves of that, including the case where `sseType` is
left out entirely.

```
CreateIndex  encryptionConfiguration: { sseType: 'AES256', kmsKeyArn: <key> }
→ ValidationException, HTTP 400               requestId 1334d4eb-78be-8422-87b6-37ee4216de69
   "kmsKeyArn must not be specified when sseType is AES256."
   fieldList: [{ path: "EncryptionConfiguration", … }]

CreateIndex  encryptionConfiguration: { kmsKeyArn: <key> }        (no sseType)
→ ValidationException, HTTP 400               requestId 1f4d2b15-a6e2-897d-965d-0ca4eb3b0755
   "kmsKeyArn must not be specified when sseType is AES256."

CreateIndex  encryptionConfiguration: { sseType: 'aws:kms' }      (no key)
→ ValidationException, HTTP 400               requestId 134376be-9a26-8c11-a0dd-9b937462c7ae
   "kmsKeyArn must be specified when sseType is set to aws:kms"

CreateIndex  encryptionConfiguration: { sseType: 'aws:kms', kmsKeyArn: <nonexistent key> }
→ AccessDeniedException, HTTP 403             requestId 1c55c10b-127b-8ec0-8c43-a8f912122949
   "Key 'arn:aws:kms:…:key/00000000-…' does not exist (kms_request_id=…)"

CreateIndex  encryptionConfiguration: { sseType: 'AES256' }
→ HTTP 200; GetIndex then reports encryptionConfiguration { sseType: 'AES256' }
```

## What this establishes

- **An omitted `sseType` is `AES256`,** so a `kmsKeyArn` on its own is refused
  with the same message as the explicit pairing.
- **`aws:kms` requires a key.** There is no default or AWS-managed key for an
  index; the service refuses the creation.
- Both rules are checkable before any request, which is where
  `shared/validation.ts` applies them. Left to the service they arrive at the
  first write — after that batch has been embedded and paid for.
- **A key that does not exist is `AccessDeniedException` (403), not a KMS
  error.** This package maps it to `ACCESS_DENIED`, which is what an operator
  needs to see; it is recorded because the four `Kms*Exception` classes would
  have been the natural guess and are not what arrives.

## Guarded by

`test/integration/index-encryption.test.ts` — "refuses a KMS key with AES256,
and aws:kms without one".
