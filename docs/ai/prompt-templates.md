# Prompt Templates

Use these prompts with coding agents for consistent outcomes.

## 1) Targeted bug fix
```text
Fix a bug in <path/file>. Root cause: <brief description or symptom>.
Constraints:
- Minimal change set
- Keep public API unchanged
- Add/adjust tests only where relevant
Validation:
- Run focused tests first, then lint/typecheck for impacted package
Return:
- Summary of cause, fix, and commands run
```

## 2) New feature in existing module
```text
Implement <feature> in <path/module>.
Requirements:
- Follow existing architecture in <related paths>
- Use existing types/contracts
- Avoid new dependencies unless necessary
Also:
- Add docs update if behavior changes
- Add tests for happy path + key failure path
```

## 3) Refactor for clarity (no behavior change)
```text
Refactor <path/module> for readability/maintainability.
Must keep runtime behavior identical.
Do not change public interfaces.
Scope:
- Rename unclear internals
- Extract small helper functions
- Keep diff concise
Validation:
- Run existing tests for impacted package
```

## 4) Type-safety upgrade
```text
Improve typing in <path/module> by removing implicit any/weak unions.
Requirements:
- Preserve runtime behavior
- Strengthen exported API types
- Prefer discriminated unions and generics
Validation:
- Ensure package typecheck passes
```

## 5) Scraper engine enhancement
```text
Enhance scraper behavior in <engine/parser path>.
Requirements:
- Reuse `WebEngine`/`WebContentParser` contracts
- Keep `FetchResponse` success/error semantics
- Preserve metadata (`method`, `duration`, etc.)
- Handle blocked/captcha outcomes explicitly
Validation:
- Add or update tests for normal + blocked flow
```
