import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

// Drive the real eslint.config.js so the test asserts production behaviour,
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

  it('does NOT flag setTimeout with an inner if-statement (the BookmarkFormModal shape)', async () => {
    // BookmarkFormModal.tsx:128 uses setTimeout(() => { if (...) setAutoTitlePhase("idle"); }, 600).
    // Both selectors must skip it via the timer-function exclusion.
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
