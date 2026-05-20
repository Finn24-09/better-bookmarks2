// eslint.config.mjs
//
// Single-rule lint config: forbid side-effecting CallExpressions inside
// React `setState`-like updater bodies. The rule exists because React's
// dispatch semantics (StrictMode dev double-call, concurrent rendering
// speculative renders, reconciliation re-runs after batched dispatches)
// permit the updater to fire multiple times — a side-effect inside
// therefore re-runs, and any "should-have-been-once" mutation
// (`setAuthToken`, ref assignment, fetch, etc.) becomes a race. See
// issue #45 and the PR #44 fix (commit 5488389).
//
// File suffix is `.mjs` (not `.js`) so Node loads it natively as ESM.
// Package.json is not `"type": "module"`, so a `.js` ESLint config would
// be loaded via ESLint's optional `jiti` peer dependency — currently
// present only transitively via Vite + @tailwindcss/node, so a future
// upstream tree shift could silently disable this entire rule. `.mjs`
// removes that fragile dependency chain. See PR #63 review (item 2).
//
// Intentionally narrow: only this one rule, only on src/**/*.{ts,tsx}.
// Broader linting (typescript-eslint recommended, react-hooks, etc.) is
// a separate decision tracked in its own future PR.
//
// Selector coverage:
//   - Selector 1: direct ExpressionStatement > CallExpression children of
//     the updater BlockStatement (the literal PR #44 shape).
//   - Selector 2: ExpressionStatement > CallExpression one level inside a
//     BRACED IfStatement branch (consequent or alternate) of the updater
//     body — the most plausible bypass shape ("guarded by if").
//   - Selector 3: same as Selector 2 but for UNBRACED if/else branches
//     (`if (cond) sideEffect()` with no BlockStatement wrapper). Closes
//     the gap flagged in PR #63 review (item 1). Selectors 2 and 3 are
//     mutually exclusive on the same node — an IfStatement's consequent
//     and alternate are each EITHER a BlockStatement OR a bare
//     ExpressionStatement, never both — so they cannot double-fire.
//
// NOT covered (manual review required; see CLAUDE.md):
//   - `else if` chains (alternate is an IfStatement, not a BlockStatement
//     nor a bare ExpressionStatement).
//   - Side-effects two-or-more levels deep, or inside try/catch/switch.
//   - AwaitExpression / AssignmentExpression / UpdateExpression statements.
//   - `return doThing(s)` (CallExpression in a ReturnStatement is legitimate
//     for pure transforms; runtime tests + StrictMode catch the rest).
//
// Timer-function exclusion: setTimeout / setInterval / setImmediate match
// the basic /^set[A-Z]/ shape but are legitimate JS/DOM APIs that take
// BlockStatement-bodied function callbacks (e.g. DeleteAccountModal.tsx:89
// uses setInterval for hold-to-delete progress). The negative-lookahead
// `(?!(?:Timeout|Interval|Immediate)$)` excludes exactly those three.

import tsParser from '@typescript-eslint/parser';

// The `$` inside the negative lookahead is load-bearing: it anchors the
// excluded names to end-of-string at position 3. Without it, the lookahead
// would also reject names that merely START WITH one of the excluded
// stems — e.g. `setTimeoutHelper` would be excluded too, which is wrong:
// only the three stdlib globals (setTimeout / setInterval / setImmediate)
// should be excluded. Do not "simplify" by removing the `$`.
const SETTER_NAME_RE =
  "/^set(?!(?:Timeout|Interval|Immediate)$)[A-Z][a-zA-Z0-9_]*$/";

const DIRECT_BODY_SELECTOR =
  `CallExpression[callee.type='Identifier'][callee.name=${SETTER_NAME_RE}]` +
  ` > :matches(ArrowFunctionExpression, FunctionExpression)` +
  ` > BlockStatement` +
  ` > ExpressionStatement` +
  ` > CallExpression`;

const IF_BRANCH_SELECTOR =
  `CallExpression[callee.type='Identifier'][callee.name=${SETTER_NAME_RE}]` +
  ` > :matches(ArrowFunctionExpression, FunctionExpression)` +
  ` > BlockStatement` +
  ` > IfStatement` +
  ` > BlockStatement` +
  ` > ExpressionStatement` +
  ` > CallExpression`;

// Selector 3: same shape as Selector 2 (IfStatement direct child of the
// updater body) but for UNBRACED if/else branches. The AST shape is
// IfStatement > ExpressionStatement directly (no BlockStatement wrapper),
// because an unbraced `if (cond) doThing();` does not produce a
// BlockStatement. Closes the gap flagged in PR #63 review (item 1).
const IF_UNBRACED_SELECTOR =
  `CallExpression[callee.type='Identifier'][callee.name=${SETTER_NAME_RE}]` +
  ` > :matches(ArrowFunctionExpression, FunctionExpression)` +
  ` > BlockStatement` +
  ` > IfStatement` +
  ` > ExpressionStatement` +
  ` > CallExpression`;

const SIDE_EFFECT_MESSAGE =
  'Do not place side-effecting calls inside a React setState-like updater. ' +
  'React may re-invoke the updater (StrictMode dev double-call, concurrent ' +
  'rendering, batched dispatch reconciliation), so side-effects must be hoisted ' +
  'outside the updater. This rule catches direct ExpressionStatement children ' +
  'of the updater body and one-level IfStatement branches; deeper nesting ' +
  '(try/catch/switch/nested-if) still requires manual review. See issue #45 ' +
  'and PR #44 (commit 5488389) for the regression this guard prevents.';

export default [
  {
    // Belt-and-braces: src/**/*.{ts,tsx} below already restricts the lint
    // surface, but pinning ignores here protects against a future invocation
    // like `npx eslint .` accidentally walking into services or build output.
    ignores: ['dist/**', 'node_modules/**', 'services/**', 'docs/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: DIRECT_BODY_SELECTOR, message: SIDE_EFFECT_MESSAGE },
        { selector: IF_BRANCH_SELECTOR, message: SIDE_EFFECT_MESSAGE },
        { selector: IF_UNBRACED_SELECTOR, message: SIDE_EFFECT_MESSAGE },
      ],
    },
  },
];
