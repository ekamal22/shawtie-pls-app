# SEC1 Common Password Corpus

Shawtie uses a server-only, offline exact-match corpus to reject newly chosen common passwords.

The repository intentionally does **not** vendor the plaintext source password list. The public repository follows a synthetic-data-only rule, so only exact SHA-256 membership digests for structurally relevant entries are committed in:

`apps/api/src/security/common-passwords.generated.ts`

SHA-256 here is only a local set-representation mechanism. Account credentials continue to be stored with Argon2id.

## Pinned source

Source repository: `danielmiessler/SecLists`

Pinned repository commit:

`2e3e92569043d24297ca6c35070078e5cf41651e`

Pinned source path:

`Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt`

Pinned Git blob SHA:

`38eb37702244f55fda75cab281eb2145cd7685b6`

Source entry count: 99,839.

Effective entries after Shawtie's 15 to 128 code-point structural policy, NFC normalization, case folding, UTF-8 size bound, decoding of valid `$HEX[...]` rows, and deduplication: 327.

Canonical sorted digest-set SHA-256:

`2614e892e747d06fd0861733ffc0c9187b5c242a8aae8e029e938db860a537ca`

License: MIT, as published by SecLists.

## Regeneration

Obtain the exact pinned source file outside the repository and set:

```text
SEC1_COMMON_PASSWORD_SOURCE_FILE=<path-to-pinned-source>
```

Then run:

```text
npm run sec1:passwords:generate
```

The generator verifies the source Git blob SHA and source entry count before writing output. A wrong or modified source fails closed.

The source file must remain untracked.

## Normal closure verification

SEC1 closure does not need the plaintext source file. It runs:

```text
npm run sec1:passwords:check
```

That check verifies the committed hash-only corpus shape, pinned source metadata, expected digest count, deterministic ordering, uniqueness, canonical digest-set checksum, and absence of known plaintext sentinel entries.

The digest-set checksum is intentionally independent of the generated TypeScript formatting. It commits the exact normalized membership set produced from the pinned source, which prevents an accidentally stale or double-hashed runtime corpus from passing metadata-only checks.

## SecLists license notice

Copyright (c) 2018 Daniel Miessler

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
