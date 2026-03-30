# VectorDB Benchmark Harness

**Implements:** TASK-VDB-002
**Dependencies:** TASK-VDB-001 (VectorDB implementation)

## Overview

This benchmark harness provides comprehensive performance validation for the VectorDB implementation against the targets specified in the God Agent PRD.

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| **Insert** | <50µs per operation | Individual insert latency |
| **Search (10k vectors, k=10)** | <1ms median | Median latency target |
| **Search (10k vectors, k=10)** | <3ms p99 | 99th percentile latency |
| **Construction (10k vectors)** | <12s | Total time to build index |
| **Index Size (10k vectors)** | ~30MB | Memory footprint |

Note: Native backend targets are more aggressive (0.3ms median for search). The fallback TypeScript implementation may not meet these targets but establishes the benchmark framework.

## File Structure

```
tests/benchmarks/
├── README.md                    # This file
├── vector-db.bench.ts          # Main benchmark suite
└── utils/
    ├── test-vectors.ts         # Random vector generation
    ├── statistics.ts           # Statistical analysis functions
    └── reporters.ts            # Result formatting and reporting
```

## Running Benchmarks

### Quick Start

```bash
# Run benchmarks (recommended: with garbage collection exposed)
npm run benchmark

# Run benchmarks in CI mode with verbose output
npm run benchmark:ci

# Run using vitest directly
npm run test:benchmarks
```

### Full Benchmark Suite

The benchmark runs the following tests for each dataset size (1k, 10k vectors):

1. **Insert Performance** - Individual vector insertion latency
2. **Batch Insert Performance** - Batch insertion throughput
3. **Search Performance** - k=10 nearest neighbor search latency
4. **Construction Time** - Time to build complete index
5. **Memory Usage** - Heap and external memory consumption

### Benchmark Configurations

**Small Dataset (1k vectors):**
- Search iterations: 1,000
- Insert iterations: 1,000
- Warmup iterations: 100

**Medium Dataset (10k vectors):**
- Search iterations: 1,000
- Insert iterations: 1,000
- Warmup iterations: 100

**Large Dataset (100k vectors):** *(commented out by default)*
- Search iterations: 500
- Insert iterations: 500
- Warmup iterations: 50

To enable large dataset benchmarks, uncomment the configuration in `vector-db.bench.ts`.

## Understanding Results

### Latency Metrics

- **Min**: Fastest operation (best case)
- **Median (p50)**: Middle value, typical performance
- **Mean**: Average across all operations
- **p95**: 95th percentile, good representation of normal operation
- **p99**: 99th percentile, captures tail latency (important for consistency)
- **Max**: Slowest operation (worst case)
- **StdDev**: Spread of values (consistency indicator)

### Throughput

- **Ops/sec**: Operations per second (higher is better)

### Memory Usage

- **Heap Used**: JavaScript heap memory
- **External**: Native memory (C++ allocations)
- **Bytes/Vector**: Average memory per vector

## Interpreting Output

### Console Output

```
================================================================================
Benchmark: Insert (Medium Dataset)
================================================================================
Vectors: 10,000
Iterations: 1,000

Latency Statistics:
  Min:    23.45µs
  Median: 42.18µs (p50)
  Mean:   45.32µs
  p95:    48.90µs
  p99:    52.17µs
  Max:    67.43µs
  StdDev: 5.21µs

Throughput: 22,075 ops/sec
================================================================================
```

### Markdown Report

A markdown report is generated with a comparison table:

```markdown
# VectorDB Benchmark Results

| Benchmark | Vectors | Median | p95 | p99 | Ops/sec | Memory |
|-----------|---------|--------|-----|-----|---------|--------|
| Insert (Medium Dataset) | 10,000 | 42.18µs | 48.90µs | 52.17µs | 22,075 | N/A |
| Search k=10 (Medium Dataset) | 10,000 | 0.85ms | 1.12ms | 2.87ms | 1,176 | N/A |
```

## Validation Against Targets

The benchmark automatically validates results against PRD targets:

✅ **Pass**: All targets met
❌ **Fail**: One or more targets exceeded

Failed benchmarks will print detailed failure messages:

```
⚠️  PERFORMANCE TARGETS NOT MET:

  ❌ Insert (Medium Dataset): Insert median 67.45µs exceeds 50µs target
  ❌ Search k=10 (Medium Dataset): Search median 1.23ms exceeds 1ms target
```

## Best Practices

### Running Benchmarks

1. **Close other applications** - Minimize system noise
2. **Run with --expose-gc** - Get accurate memory measurements
3. **Multiple runs** - Run 3-5 times and take median results
4. **Warm up system** - First run may be slower (JIT compilation)

### Interpreting Results

1. **Focus on median** - More stable than mean for latency
2. **Watch p99** - Critical for user experience consistency
3. **Compare datasets** - Check scaling behavior
4. **Memory trends** - Linear growth expected with vector count

### CI Integration

For CI pipelines, use `npm run benchmark:ci`:
- Verbose output for logs
- Exit code 1 if targets not met
- Generates markdown and JSON reports

## Benchmarking Methodology

### Warmup Phase

All benchmarks include a warmup phase (100 iterations) to:
- Stabilize JIT compilation
- Warm up CPU caches
- Remove first-run artifacts

### Iteration Count

Sufficient iterations (1000+) reduce noise from:
- OS scheduling variability
- CPU frequency scaling
- Background processes

### Test Vector Quality

Vectors are truly random and L2-normalized:
- Uniform distribution across dimensions
- Representative of real embeddings
- Seeded option for reproducibility

### Statistical Rigor

Report percentiles (p50, p95, p99) instead of just averages:
- **p50 (median)**: Typical performance
- **p95**: Good representation of normal operation
- **p99**: Critical for understanding tail latency

## Troubleshooting

### Benchmarks Running Slowly

- Check dataset size configuration
- Reduce iterations for initial testing
- Comment out large dataset benchmarks

### Memory Measurements Inaccurate

- Ensure running with `--expose-gc` flag
- Check for memory leaks in implementation
- Run garbage collection between tests

### High Variance in Results

- Close background applications
- Run on quieter system
- Increase iteration count
- Check for thermal throttling

## Future Enhancements

When native backend is implemented:

1. Add backend comparison benchmarks (native vs fallback)
2. Test different HNSW parameters (M, efConstruction, efSearch)
3. Add recall quality benchmarks
4. Benchmark different distance metrics
5. Add concurrent search benchmarks
6. Profile with perf/flamegraph tools

## References

- **PRD**: `docs2/god-agent-prd-complete.md`
- **Constitution**: `docs/constitution.md`
- **Task Spec**: `docs/god-agent-specs/tasks/TASK-VDB-002.md`
- **VectorDB Implementation**: `src/god-agent/core/vector-db/`
