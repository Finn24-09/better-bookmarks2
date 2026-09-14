// Vitest 5 stopped reading matcher types from the global `jest.Matchers`
// interface, which is the only surface `@testing-library/jest-dom` 7.0.1
// augments, so every jest-dom matcher vanished from `expect()` at the type
// level. Runtime is unaffected: the setup file's import still registers the
// matchers through `expect.extend`. Augment the `Matchers<R, T>` extension
// point Vitest 5 documents instead. Delete this file once jest-dom ships
// Vitest 5 support (testing-library/jest-dom#738).
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  interface Matchers<R, T> extends TestingLibraryMatchers<unknown, R> {}
}
