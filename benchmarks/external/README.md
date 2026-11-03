# Operator-managed upstream checkouts

External challenge repositories are not benchmark engine source and are ignored
by Git and Python analysis. Default provider locations are:

- `xbow-validation-benchmarks/benchmarks/`
- `MHBench/`
- `cybench/benchmark/`
- `cybergym/` (configured through the CyberGym YAML spec)
- `buttercup/upstream/` (used by the standalone provider API)

See the guides in `../docs/` for prerequisites. `.gitmodules` records the intended
XBOW/MHBench locations; a checkout without their gitlinks must explicitly clone
or register those repositories before running the corresponding provider.
