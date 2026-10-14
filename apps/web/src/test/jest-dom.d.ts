// Project-owned jest-dom augmentation. @testing-library/jest-dom@7.0.1 ships a
// single-parameter `Assertion` augmentation that cannot merge with vitest 5's
// two-parameter declaration once the package hoists above the app's vitest
// install. This restates the augmentation with the vitest 5 signature.
/* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'
declare module 'vitest' {
  interface Assertion<R extends void | Promise<void> = void, T = unknown>
    extends TestingLibraryMatchers<any, R> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
