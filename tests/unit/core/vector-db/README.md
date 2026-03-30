# VectorDB Test Suite

**TASK-VDB-001**: Comprehensive unit tests for VectorDB implementation

## Test Files

### 1. `test-helpers.ts`
Shared utilities for generating test vectors:
- `createRandomNormalizedVector()` - Random L2-normalized vectors
- `createSimpleNormalizedVector()` - Simple [1, 0, ...] vectors
- `createBatchVectors()` - Generate multiple test vectors
- `createOrthogonalVectors()` - Perpendicular vectors (cosine = 0)
- `createIdenticalVectors()` - Same vectors (cosine = 1)
- `createOppositeVectors()` - Opposite vectors (cosine = -1)
- `expectNormalized()` - Assert vector normalization
- `expectVectorsEqual()` - Compare vectors with tolerance

### 2. `vector-db.test.ts` (18KB, ~500 lines)
Core VectorDB CRUD operation tests:

#### Constructor & Basic Setup
- Default and custom options
- Custom dimensions and metrics

#### insert() Validation ✅
- ✅ Accepts valid 1536D L2-normalized vectors (TASK-VEC-001-008: updated from 768D)
- ✅ Rejects 768D vectors (legacy dimension mismatch)
- ✅ Rejects 767D vectors
- ✅ Rejects non-normalized vectors
- ✅ Rejects NaN values
- ✅ Rejects Infinity values
- ✅ Includes context in error messages

#### insert() Return Values ✅
- ✅ Returns unique VectorID for each insertion
- ✅ Returns UUID-format strings
- ✅ Increments count after each insert

#### search() Basic Functionality ✅
- ✅ Returns k nearest neighbors
- ✅ Returns all vectors if k > count
- ✅ Returns results sorted by similarity (best first)
- ✅ Returns exact match as top result
- ✅ Includes vector data when requested
- ✅ Returns empty array for empty database

#### search() Validation ✅
- ✅ Validates query vector dimensions
- ✅ Rejects 768D query vectors (legacy dimension)
- ✅ Rejects non-normalized queries
- ✅ Rejects queries with NaN values

#### getVector() ✅
- ✅ Returns original vector for valid ID
- ✅ Returns undefined for invalid ID
- ✅ Returns a copy (not reference)
- ✅ Works for all inserted vectors

#### delete() ✅
- ✅ Removes vector and returns true on success
- ✅ Returns false for invalid ID
- ✅ Allows deleting multiple vectors
- ✅ Updates search results after deletion
- ✅ Handles deleting same ID twice

#### count() ✅
- ✅ Returns 0 for empty database
- ✅ Returns correct count after insertions
- ✅ Returns correct count after deletions
- ✅ Returns correct count after clear

#### batchInsert() ✅
- ✅ Inserts multiple vectors with unique IDs
- ✅ Validates all vectors before inserting
- ✅ Handles empty batches
- ✅ Includes batch index in error messages
- ✅ Handles large batches (100+ vectors)

### 3. `distance-metrics.test.ts` (13KB, ~400 lines)
Distance metric calculation tests:

#### cosineSimilarity ✅
- ✅ Returns 1.0 for identical vectors
- ✅ Returns 0.0 for orthogonal vectors
- ✅ Returns -1.0 for opposite vectors
- ✅ Is symmetric (a·b = b·a)
- ✅ Returns value in range [-1, 1]
- ✅ Throws for dimension mismatch
- ✅ Equals dot product for L2-normalized vectors

#### euclideanDistance ✅
- ✅ Returns 0 for identical vectors
- ✅ Calculates correct distance (3-4-5 triangle)
- ✅ Is symmetric
- ✅ Returns positive distances
- ✅ Throws for dimension mismatch
- ✅ Satisfies triangle inequality

#### dotProduct ✅
- ✅ Calculates correct dot product
- ✅ Same as cosine for normalized vectors
- ✅ Is symmetric
- ✅ Returns 0 for orthogonal vectors
- ✅ Handles negative values

#### manhattanDistance ✅
- ✅ Returns 0 for identical vectors
- ✅ Calculates correct L1 distance
- ✅ Is symmetric
- ✅ Returns positive distances
- ✅ Greater than or equal to Euclidean

#### Helper Functions ✅
- ✅ getMetricFunction() returns correct functions
- ✅ isSimilarityMetric() identifies similarity vs distance

### 4. `persistence.test.ts` (14KB, ~450 lines)
Save/load and persistence tests:

#### Save and Load Roundtrip ✅
- ✅ Saves and loads empty database
- ✅ Preserves vector data after save/load
- ✅ Preserves large number of vectors (100+)
- ✅ Preserves search functionality
- ✅ Handles multiple save operations
- ✅ Returns false for nonexistent file

#### Insert + Restart + Count ✅
- ✅ Persists count after restart
- ✅ Maintains consistency across multiple restart cycles

#### File Format Validation ✅
- ✅ Creates directory if not exists
- ✅ Rejects file with wrong version
- ✅ Rejects file with wrong dimension
- ✅ Handles corrupted files gracefully

#### Auto-save Feature ✅
- ✅ Auto-saves on insert when enabled
- ✅ Does not auto-save when disabled
- ✅ Auto-saves on delete when enabled
- ✅ Auto-saves on batch insert when enabled

#### Different Metrics ✅
- ✅ Preserves vectors with Euclidean metric
- ✅ Works with Manhattan metric

#### Edge Cases ✅
- ✅ Handles very long vector IDs
- ✅ Handles special characters in IDs (UTF-8, emojis)
- ✅ Preserves vector precision
- ✅ Clears before loading

## Validation Criteria Coverage

All TASK-VDB-001 validation criteria are covered:

| Criterion | Test File | Status |
|-----------|-----------|--------|
| VectorDB.insert() validates dimensions and rejects 768D (legacy) | vector-db.test.ts | ✅ |
| VectorDB.insert() returns unique VectorID | vector-db.test.ts | ✅ |
| VectorDB.search() returns k nearest neighbors sorted | vector-db.test.ts | ✅ |
| VectorDB.search() validates query dimensions | vector-db.test.ts | ✅ |
| VectorDB.getVector() returns original vector | vector-db.test.ts | ✅ |
| VectorDB.delete() removes and returns true | vector-db.test.ts | ✅ |
| Persistence: insert + restart + count | persistence.test.ts | ✅ |
| Cosine similarity equals dot product (normalized) | distance-metrics.test.ts | ✅ |
| All tests pass with >80% coverage | To be verified | ⏳ |

## Test Statistics

- **Total Test Files**: 4 (including helpers)
- **Total Test Suites**: 3
- **Approximate Test Count**: 120+ tests
- **Code Coverage Target**: >80% (all VectorDB code paths)

## Running Tests

```bash
# Run all VectorDB tests
npm run test tests/unit/core/vector-db

# Run specific test file
npm run test tests/unit/core/vector-db/vector-db.test.ts

# Run with coverage
npm run test:coverage tests/unit/core/vector-db

# Run in watch mode
npm run test:watch tests/unit/core/vector-db
```

## Test Patterns Used

1. **Arrange-Act-Assert**: Clear three-phase test structure
2. **Test Helpers**: Reusable vector generation utilities
3. **Edge Case Coverage**: NaN, Infinity, boundaries, empty inputs
4. **Error Message Validation**: Context-aware error messages
5. **Isolation**: Each test is independent (beforeEach/afterEach)
6. **Parametric Testing**: Multiple iterations for randomized tests
7. **Integration Testing**: End-to-end persistence workflows

## Next Steps

1. ✅ Tests created and organized
2. ⏳ Run tests to verify all pass
3. ⏳ Generate coverage report
4. ⏳ Address any failing tests
5. ⏳ Verify >80% code coverage achieved
6. ⏳ Review with coder agent for any missing scenarios

## Notes

- Tests use Vitest framework (matching existing project setup)
- All vectors are L2-normalized per VEC-04 requirement
- Helper functions prevent code duplication
- Comprehensive edge case coverage included
- Persistence tests use temporary `.agentdb-test/` directory
- All async operations properly awaited
- Error types validated (GraphDimensionMismatchError, etc.)
