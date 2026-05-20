// This test does not live next to its source under test.
// `eslint.config.mjs` sits at the project root (ESLint convention), but
// `vite.config.ts`'s `test.include` glob is `src/**/*.test.{ts,tsx}` so
// the test file must live under `src/`. `src/test/` is the project's
// established home for config-level test suites (see `src/test/setup.ts`).

import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

// Drive the real eslint.config.mjs so the test asserts production behaviour,
// not a fixture config. `cwd` defaults to process.cwd(); vitest runs from
// the project root so the workspace config is picked up.
const eslint = new ESLint();

async function lint(code: string) {
  // filePath must match one of the config's `files` globs so the rule
  // applies. Any path under `src/**/*.tsx` works; the file does NOT need
  // to exist on disk — lintText operates on the passed-in string.
  const [result] = await eslint.lintText(code, { filePath: 'src/__fixture__.tsx' });
  return result;
}

describe('no-restricted-syntax: side-effects inside React setState updaters', () => {
  // -------- POSITIVE: rule MUST fire --------

  it('flags a side-effecting CallExpression directly inside an arrow updater body', async () => {
    const code = `
      function Comp() {
        setState((s) => {
          sideEffect();
          return s;
        });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(1);
    expect(result.messages[0].nodeType).toBe('CallExpression');
    expect(result.messages[0].message).toMatch(/setState.*updater/);
  });

  it('flags the exact PR #44 regression shape (setAuthToken inside setState updater)', async () => {
    const code = `
      function Comp() {
        setState((s) => {
          setAuthToken(token);
          return { ...s, token };
        });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(1);
    expect(result.messages[0].message).toMatch(/setState.*updater/);
  });

  it('flags a FunctionExpression updater the same as an ArrowFunctionExpression', async () => {
    const code = `
      function Comp() {
        setState(function (s) {
          sideEffect();
          return s;
        });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(1);
  });

  it('flags a side-effect nested one level inside an if-consequent (bypass selector)', async () => {
    const code = `
      function Comp() {
        setState((s) => {
          if (s.userId === sub) {
            setAuthToken(token);
            return { ...s, token };
          }
          return s;
        });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(1);
    expect(result.messages[0].message).toMatch(/setState.*updater/);
  });

  it('flags a side-effect inside an else branch (alternate BlockStatement)', async () => {
    const code = `
      function Comp() {
        setState((s) => {
          if (s.userId === sub) return s;
          else {
            setAuthToken(token);
            return { ...s, token };
          }
        });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(1);
  });

  it('flags an unbraced if-branch side-effect (no BlockStatement wrapper)', async () => {
    // PR #63 review item 1: AST is IfStatement > ExpressionStatement
    // directly (no BlockStatement hop). The original two selectors
    // missed this; Selector 3 closes the gap.
    const code = `
      function Comp() {
        setState((s) => {
          if (s.userId === sub) setAuthToken(token);
          return s;
        });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(1);
    expect(result.messages[0].message).toMatch(/setState.*updater/);
  });

  it('flags an unbraced else-branch side-effect', async () => {
    const code = `
      function Comp() {
        setState((s) => {
          if (s.userId === sub) return s;
          else setAuthToken(token);
          return s;
        });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(1);
  });

  it('flags two violations when braced consequent + unbraced alternate both contain side-effects', async () => {
    // Selectors 2 and 3 are mutually exclusive on the same node but
    // can fire on different nodes within the same if/else — pin the
    // behaviour so a future selector consolidation does not silently
    // change it.
    const code = `
      function Comp() {
        setState((s) => {
          if (s.userId === sub) { sideEffect(); }
          else doOther();
          return s;
        });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(2);
  });

  // -------- NEGATIVE: rule MUST NOT fire --------

  it('does NOT flag a pure expression-body updater', async () => {
    const code = `
      function Comp() {
        setState((s) => ({ ...s, x: 1 }));
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(0);
  });

  it('does NOT flag a setter called with a non-function argument', async () => {
    const code = `
      function Comp() {
        setState({ ...newState });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(0);
  });

  it('does NOT flag a callee that starts with "set" but is not setState-shaped', async () => {
    // "setup" — lowercase letter after "set" → does not match /^set[A-Z]/
    const code = `
      function Comp() {
        setup(() => {
          doThing();
        });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(0);
  });

  it('does NOT flag setTimeout / setInterval / setImmediate (timer-function exclusion)', async () => {
    // This is the false-positive that broke the prior selector design.
    // setInterval at DeleteAccountModal.tsx:89 must continue to pass lint.
    const code = `
      function Comp() {
        setInterval(() => {
          const elapsed = Date.now();
          setHoldProgress(elapsed);
        }, 16);
        setTimeout(() => {
          emit("ping");
        }, 100);
        setImmediate(() => {
          flushQueue();
        });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(0);
  });

  it('does NOT flag setTimeout with an unbraced inner if-statement (the BookmarkFormModal shape)', async () => {
    // BookmarkFormModal.tsx:128 uses setTimeout(() => { if (...) setAutoTitlePhase("idle"); }, 600).
    // The inner if-statement is unbraced (single ExpressionStatement consequent),
    // so this covers BOTH the braced-if and unbraced-if (Selectors 2 and 3)
    // timer-exclusion paths — all three selectors must skip it at the outer
    // callee level via SETTER_NAME_RE.
    const code = `
      function Comp() {
        setTimeout(() => {
          if (controller.aborted) setAutoTitlePhase("idle");
        }, 600);
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(0);
  });

  it('does NOT flag side-effects nested inside an inner closure (returned via state)', async () => {
    // doThing() lives inside an inner ArrowFunctionExpression's body, which
    // is itself nested inside an ObjectExpression nested inside a ReturnStatement.
    // It is not an ExpressionStatement direct child of the outer BlockStatement
    // and not a one-level IfStatement child either. Documented trade-off:
    // descendant traversal would over-report this case.
    const code = `
      function Comp() {
        setState((s) => {
          return { ...s, handler: () => { doThing(); } };
        });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(0);
  });

  it('does NOT flag a CallExpression returned from the updater (return doThing(s))', async () => {
    // CallExpression inside a ReturnStatement is not an ExpressionStatement.
    // Returning the result of a pure transform from an updater is the
    // documented expected pattern. Side-effects in such transforms remain
    // the responsibility of runtime tests + StrictMode.
    const code = `
      function Comp() {
        setState((s) => {
          return mapState(s);
        });
      }
    `;
    const result = await lint(code);
    expect(result.errorCount).toBe(0);
  });
});
