# SEC1 common-password source data

This directory contains the pinned source data used to generate Shawtie's server-side common-password admission corpus.

Source:

- repository: `danielmiessler/SecLists`
- commit: `2e3e92569043d24297ca6c35070078e5cf41651e`
- path: `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt`
- Git blob SHA-1: `38eb37702244f55fda75cab281eb2145cd7685b6`
- source entries: 99,839
- license: MIT, copyright Daniel Miessler

The raw source is committed so regeneration is offline and reproducible. Run:

```text
npm run sec1:passwords:generate
```

The generator verifies the pinned Git blob checksum before writing `apps/api/src/security/common-passwords.generated.ts`. Runtime admission uses only entries that can survive Shawtie's structural password bounds, preserves NFC-normalized case exactly, and performs full-password membership checks only.

This data is public security test/reference material. It is not derived from Shawtie users or production credentials.
