// Register jest-dom matchers from within the app: jest-dom's own
// '@testing-library/jest-dom/vitest' entry imports 'vitest' from its hoisted
// package location, which can bind a different vitest instance than the one
// this workspace's tests use. Importing the matchers and extending the
// app-local expect keeps a single vitest identity.
import * as matchers from '@testing-library/jest-dom/matchers'
import { configure } from '@testing-library/react'
import { expect } from 'vitest'

expect.extend(matchers)

// Full-suite runs share the machine with other work; the 1s default makes
// findBy/waitFor on large shells flaky. A generous ceiling does not slow passing tests.
configure({ asyncUtilTimeout: 5000 })
