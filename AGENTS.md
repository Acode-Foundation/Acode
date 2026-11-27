# Acode — Coding Rules

## Non-Negotiable

1. **No redundant code.** If functionality already exists as a component or common function,
   reuse it. Never duplicate logic.

2. **No `_` prefixed variable names.** No `_temp`, `_private`, `_internal`, etc.
   Use proper descriptive names.

3. **Functions at the bottom.** All function definitions go after the main
   component/class logic, at file or closure scope. Never interleave function
   declarations with execution code.

4. **Maintainable and readable.** Prefer clarity over cleverness. Split files if they
   exceed ~200 lines. Use descriptive, self-documenting names.

5. **No unnecessary comments.** Comments only when the code itself can't explain *why*.
   Never comment *what* the code does — it should be obvious from the names and structure.

## Import Order

1. Non-JS imports first (SCSS, CSS, images, fonts)
2. Then library/package imports (React, third-party)
3. Then local imports from `"src"` root
4. Then same-directory relative imports (`./`)

Concrete example:
```typescript
import "./App.scss";         // 1. non-JS at top
import "res/icons/style.css";
import { useState } from "react";  // 2. packages
import Page from "components/Page";
import store from "lib/store";     // 3. src/ root imports
import localHelper from "./utils"; // 4. same-directory
```

## Biome Formatter Rules (from `biome.json`)

Run `pnpm format` before committing. Biome auto-fixes:

- **Tabs** for indentation (`indentStyle: "tab"`)
- **Double quotes** for strings (`quoteStyle: "double"`)
- **Organize imports** automatically (sorts + removes unused)
- All **recommended** linter rules enabled (except disabled ones below)
- Disabled a11y rules: `noLabelWithoutControl`, `useAnchorContent`, `noStaticElementInteractions`, `useKeyWithClickEvents`, `useMediaCaption`
- Disabled: `noDangerouslySetInnerHtml` (security), `noControlCharactersInRegex` (suspicious)

## Conventions (match existing codebase)

- `export default function/class/const` — default exports everywhere
- Imports from `"src"` root — webpack resolves `src/` as a module root
- React components: `export default function ComponentName()`
- Classes: `export default class ClassName` with `#private` fields
- Types: `interface` over `type`, named exports from `src/types/`
- SCSS: one `.scss` per component, co-located
- `const` everywhere, `let` only when reassignment is required
- `async/await` over raw Promises
- `try/catch` with `console.error` for errors
