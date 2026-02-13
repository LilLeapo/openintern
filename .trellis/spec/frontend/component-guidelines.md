# Component Guidelines

> How components are built in this project.

---

## Overview

Components are React function components written in TypeScript. The project uses React 18 with no class components. Props are defined as exported interfaces. Styling is done with CSS Modules (`.module.css` files). All user-facing text uses the `useLocaleText()` hook for bilingual (English/Chinese) support.

---

## Component Structure

Every component file follows this structure (see `web/src/components/Chat/ChatWindow.tsx`):

```typescript
/**
 * ComponentName - brief description
 */

import { useState, useEffect, ... } from 'react';
import type { SomeType } from '../../types';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './Feature.module.css';

export interface ComponentNameProps {
  // typed props
}

export function ComponentName({ prop1, prop2 = defaultValue }: ComponentNameProps) {
  const { t } = useLocaleText();
  // hooks, state, effects
  return (
    <div className={styles.componentName}>
      {/* JSX */}
    </div>
  );
}
```

Key conventions:
- JSDoc comment at the top of the file describing the component
- Named exports only (no default exports)
- Props interface exported and named `<ComponentName>Props`
- Function declaration (not arrow function) for components
- Destructured props in the function signature with defaults

---

## Props Conventions

Props interfaces are defined directly above the component and exported. They use the `<ComponentName>Props` naming pattern.

```typescript
// See web/src/components/Chat/ChatWindow.tsx
export interface ChatWindowProps {
  messages: ChatMessageType[];
  onSend: (message: string) => void;
  isRunning?: boolean;
  error?: Error | null;
  onClear?: () => void;
  onOpenRun?: () => void;
  latestRunId?: string | null;
}
```

Patterns:
- Callback props use `on<Action>` naming (e.g., `onSend`, `onClear`, `onOpenTrace`, `onCancel`)
- Optional props use `?` and are given defaults in destructuring (e.g., `isRunning = false`)
- Nullable props use `| null` (e.g., `error?: Error | null`)
- Data props use domain types from `../../types` (e.g., `RunMeta`, `Event[]`, `ChatMessage[]`)
- Children are typed as `ReactNode` when needed (see `AppShell` in `web/src/components/Layout/AppShell.tsx`)

---

## Styling Patterns

The project uses CSS Modules exclusively. Each component group has one shared `.module.css` file.

```typescript
// Import the module
import styles from './Chat.module.css';

// Use in JSX
<div className={styles.chatWindow}>
  <div className={styles.messagesContainer}>
```

Conventions:
- One CSS module per component group (e.g., `Chat.module.css` for ChatWindow, ChatMessage, ChatInput)
- Class names in CSS are `camelCase` (e.g., `.chatWindow`, `.messagesContainer`, `.emptyState`)
- Dynamic classes use template literals: `` className={`${styles.status} ${styles[run.status]}`} ``
- Conditional classes: `` className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`} ``
- No inline styles except for dynamic values (e.g., textarea height adjustment in `ChatInput.tsx`)

---

## Accessibility

The codebase includes basic accessibility patterns:

- `aria-label` on interactive elements without visible text labels (see `ChatInput.tsx` line 66: `aria-label={t('Message input', '...')}`)
- `aria-live="polite"` on dynamic status regions (see `ChatWindow.tsx` line 82: typing indicator)
- `disabled` states on buttons during loading/running states
- Semantic HTML: `<article>` for cards, `<nav>` for navigation, `<main>` for content, `<aside>` for sidebars, `<section>` for content groups
- `title` attributes for truncated text (see `RunCard.tsx` line 50)
- Keyboard support: Enter to send, Shift+Enter for newline (see `ChatInput.tsx`)

---

## Common Mistakes

- **Forgetting `useLocaleText()`**: All user-facing strings must use `t(en, zh)` for bilingual support. Do not hardcode English-only strings in JSX.
- **Inline styles instead of CSS Modules**: Use CSS Module classes. Only use inline styles for truly dynamic values (e.g., computed heights).
- **Missing barrel exports**: When adding a new component to a group, update the `index.ts` barrel file.
- **Default exports**: The project uses named exports exclusively. Do not use `export default`.
- **Missing `key` prop**: When rendering lists with `.map()`, always provide a stable `key` (use `id` fields, not array index).
- **Forgetting `void` for fire-and-forget async calls**: Use `void loadRuns()` or `() => void sendMessage(prompt)` when calling async functions in event handlers or effects to satisfy the linter.
