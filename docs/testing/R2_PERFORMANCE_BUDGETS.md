# R2 Performance Budgets

These are release regression budgets, not claims that every device will perceive the application as fast.

The automated build gate measures raw production artifact sizes:

- complete web distribution: 24 MiB maximum
- JavaScript total: 6 MiB maximum
- largest JavaScript file: 4 MiB maximum
- CSS total: 2 MiB maximum
- WebAssembly total: 10 MiB maximum

Run after the production web build:

```text
node scripts/performance/web-budget.mjs
```

The defaults are deliberately broad enough for the reviewed OpenMLS/WASM architecture but tight enough to detect accidental multi-megabyte regressions. Tighten them after real production measurements.

Stable Release also requires manual mid-range Android evidence for:

- cold application start
- Home
- Talk with representative history
- Ours
- voice/video call UI
- constrained network and reconnect
- service-worker update/cache growth

Record the final measurements in the R2 manual evidence ledger. Automated bundle size is not a substitute for device performance.
