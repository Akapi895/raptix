// Register jest-dom matchers from within the app: jest-dom's own
// '@testing-library/jest-dom/vitest' entry imports 'vitest' from its hoisted
// package location, which can bind a different vitest instance than the one
// this workspace's tests use. Importing the matchers and extending the
// app-local expect keeps a single vitest identity.
import * as matchers from '@testing-library/jest-dom/matchers'
import { expect } from 'vitest'

expect.extend(matchers)
