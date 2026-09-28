# SEC1 Common Password Corpus

This directory vendors the exact source data used to generate Shawtie's server-only common-password admission corpus.

Source repository: `danielmiessler/SecLists`

Pinned repository commit:

`2e3e92569043d24297ca6c35070078e5cf41651e`

Pinned source path:

`Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt`

Pinned Git blob SHA:

`38eb37702244f55fda75cab281eb2145cd7685b6`

Source entry count: 99,839.

License: MIT, as published by SecLists. The generated TypeScript file also carries the MIT notice.

The raw vendored source is not loaded by the application. It exists only to make generation deterministic and reviewable.

Generation:

```text
npm run sec1:passwords:generate
```

Verification without modifying files:

```text
npm run sec1:passwords:check
```

Generation normalizes each entry to Unicode NFC, folds case for admission comparison, decodes valid `$HEX[...]` UTF-8 entries, removes duplicates, and emits only entries that can survive Shawtie's structural password bounds. Short entries remain represented by the structural minimum-length rule and do not need to occupy runtime memory.
