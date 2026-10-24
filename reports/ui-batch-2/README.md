# UI Batch 2 verification bundle

This folder records the UI batch 2 implementation and verification for `fix/ui-batch-2`.

- Baseline: tag `before-batch-2` (`e1ae74e`)
- Full report: [report.md](./report.md)
- Before/after montage: [acceptance-desktop-before-after.png](./acceptance-desktop-before-after.png), [acceptance-mobile-before-after.png](./acceptance-mobile-before-after.png)
- Key states: [acceptance-states.png](./acceptance-states.png)
- Reproduce: start `harness/mock-server.mjs` with `MOCK_DIST` pointing at `player/dist`, then run the capture scripts in `harness/` against headless Chrome on port 9222.
