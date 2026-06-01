import userEvent from '@testing-library/user-event';

/**
 * Shared user-event setup with the per-keystroke delay disabled. Use this
 * everywhere instead of a bare `userEvent.setup()` (enforced by
 * no-restricted-syntax in eslint.config.mjs).
 *
 * Issue #70: user-event's default `delay: 0` awaits a real `setTimeout(0)`
 * macrotask before EVERY keystroke (see user-event's `wait.js` — it skips the
 * wait only when `delay` is not a number). Under heavy parallel CPU load
 * (several concurrent vitest processes) that timer queue starves: a long
 * `type()` blows the 5s test timeout, and the keystrokes still queued when
 * vitest aborts that test are NOT cancelled — they live in the shared per-file
 * process timer queue and fire during the next sequential test, injecting stray
 * characters into its focused input (the `aaaaaTayapaeada…` interleaving). With
 * `delay: null` typing is synchronous: no per-keystroke macrotask, so no timeout
 * and no cross-test keystroke bleed. No test in this repo drives `userEvent`
 * while fake timers are active, so the `advanceTimers` coupling does not apply.
 */
export function setupUser() {
  return userEvent.setup({ delay: null });
}
