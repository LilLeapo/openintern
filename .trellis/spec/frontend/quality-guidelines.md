# Frontend Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

This project follows **strict React + TypeScript quality standards** with automated enforcement.

**Key principles**:
- Components are small and focused
- All props are typed (no any)
- Hooks follow Rules of Hooks
- Accessibility is mandatory
- Tests cover critical paths

**Reference**: Based on backend/quality-guidelines.md adapted for React.

---

## Code Style

### Formatting (Prettier)

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "jsxSingleQuote": false,
  "trailingComma": "es5",
  "tabWidth": 2,
  "printWidth": 100,
  "arrowParens": "avoid"
}
```

### Linting (ESLint)

```json
// .eslintrc.json
{
  "extends": [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "react/react-in-jsx-scope": "off",
    "react/prop-types": "off",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "react/jsx-key": "error",
    "react/self-closing-comp": "error"
  }
}
```

---

## Forbidden Patterns

### ❌ Don't Use `any` Without Documentation

```tsx
// ❌ Bad: Silent type escape
function Component({ data }: { data: any }) {
  return <div>{data.value}</div>;
}

// ✅ Good: Proper types
interface Data {
  value: string;
}
function Component({ data }: { data: Data }) {
  return <div>{data.value}</div>;
}

// ✅ Acceptable: External lib (documented)
// TODO: Add types for external-lib
const data = externalLib.getData() as any;
```

### ❌ Don't Put Logic in Components

```tsx
// ❌ Bad: Business logic in component
export function ChatMessages() {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    fetch('/api/messages')
      .then(res => res.json())
      .then(data => {
        const filtered = data.filter(m => !m.deleted);
        const sorted = filtered.sort((a, b) => a.timestamp - b.timestamp);
        setMessages(sorted);
      });
  }, []);

  return <div>{/* ... */}</div>;
}

// ✅ Good: Logic in hook
export function ChatMessages() {
  const messages = useMessages(); // Hook handles all logic
  return <MessageList messages={messages} />;
}
```

### ❌ Don't Use Index as Key

```tsx
// ❌ Bad: Index as key
{items.map((item, i) => (
  <Item key={i} data={item} />
))}

// ✅ Good: Unique ID as key
{items.map(item => (
  <Item key={item.id} data={item} />
))}
```

### ❌ Don't Violate Rules of Hooks

```tsx
// ❌ Bad: Conditional hook call
if (condition) {
  const data = useData(); // WRONG
}

// ❌ Bad: Hook in loop
items.forEach(() => {
  const data = useData(); // WRONG
});

// ✅ Good: Hooks at top level
const data = useData();
if (condition) {
  // Use data here
}
```

### ❌ Don't Nest Components

```tsx
// ❌ Bad: Component defined inside component
export function Parent() {
  function Child() { // WRONG: Creates new component on every render
    return <div>Child</div>;
  }

  return <Child />;
}

// ✅ Good: Components at module level
function Child() {
  return <div>Child</div>;
}

export function Parent() {
  return <Child />;
}
```

---

## Required Patterns

### ✅ Always Type Props

```tsx
// ✅ Good: Explicit interface
interface ButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}

export function Button({ onClick, children, variant = 'primary' }: ButtonProps) {
  // ...
}
```

### ✅ Always Handle Loading/Error States

```tsx
export function Component() {
  const { data, isLoading, error } = useData();

  if (error) return <ErrorView error={error} />;
  if (isLoading) return <Spinner />;
  if (!data) return <EmptyState />;

  return <DataView data={data} />;
}
```

### ✅ Always Use Accessibility Attributes

```tsx
// ✅ Good: ARIA attributes
<button
  onClick={handleClick}
  aria-label="Close dialog"
  aria-disabled={isDisabled}
>
  ×
</button>

<input
  type="text"
  aria-label="Search"
  aria-describedby="search-help"
/>
<span id="search-help">Enter keywords to search</span>
```

### ✅ Always Memoize Context Values

```tsx
// ✅ Good: Memoized context value
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');

  const value = useMemo(
    () => ({ theme, setTheme }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ❌ Bad: New object every render
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

---

## Component Size Guidelines

### Max Lines Per Component

- **Simple components**: ≤ 100 lines
- **Complex components**: ≤ 200 lines
- **Page components**: ≤ 300 lines (composition only)

### Max Props Per Component

- **Limit**: 7 props
- If more, consider:
  - Grouping related props into object
  - Splitting into smaller components

```tsx
// ❌ Bad: Too many props
function Component({
  title,
  subtitle,
  description,
  icon,
  iconColor,
  onClick,
  onHover,
  isActive,
  isDisabled,
}: Props) { /* ... */ }

// ✅ Good: Group related props
interface ComponentProps {
  content: {
    title: string;
    subtitle?: string;
    description?: string;
  };
  icon?: {
    name: string;
    color: string;
  };
  state: {
    isActive: boolean;
    isDisabled: boolean;
  };
  onClick: () => void;
  onHover?: () => void;
}
```

---

## Testing Requirements

### Unit Tests (Components)

```tsx
// src/web/components/chat/ChatInput.test.tsx

import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from './ChatInput';

describe('ChatInput', () => {
  it('should call onSend when submit button is clicked', () => {
    const onSend = jest.fn();
    render(<ChatInput onSend={onSend} />);

    const input = screen.getByRole('textbox');
    const button = screen.getByRole('button', { name: /send/i });

    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(button);

    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  it('should not call onSend when input is empty', () => {
    const onSend = jest.fn();
    render(<ChatInput onSend={onSend} />);

    const button = screen.getByRole('button', { name: /send/i });
    fireEvent.click(button);

    expect(onSend).not.toHaveBeenCalled();
  });

  it('should clear input after sending', () => {
    const onSend = jest.fn();
    render(<ChatInput onSend={onSend} />);

    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    const button = screen.getByRole('button', { name: /send/i });

    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(button);

    expect(input.value).toBe('');
  });
});
```

### Integration Tests

```tsx
// src/web/pages/chat/__tests__/ChatPage.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import { ChatPage } from '../ChatPage';

jest.mock('@/web/api/runs', () => ({
  runsApi: {
    create: jest.fn().mockResolvedValue({ run_id: 'run_123' }),
  },
}));

describe('ChatPage', () => {
  it('should render chat interface', () => {
    render(<ChatPage />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('should send message and display it', async () => {
    render(<ChatPage />);

    const input = screen.getByRole('textbox');
    const button = screen.getByRole('button', { name: /send/i });

    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });
  });
});
```

### Coverage Target

- **Components**: 80% coverage
- **Hooks**: 90% coverage
- **Utils**: 95% coverage

---

## Accessibility Requirements

### Required Attributes

```tsx
// Buttons
<button aria-label="Close">×</button>

// Inputs
<input aria-label="Search" aria-describedby="search-hint" />
<span id="search-hint">Type to search</span>

// Modals
<div role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <h2 id="modal-title">Modal Title</h2>
</div>

// Lists
<ul role="list">
  <li role="listitem">Item</li>
</ul>
```

### Keyboard Navigation

```tsx
// All interactive elements must be keyboard accessible
<button onClick={handleClick} onKeyDown={handleKeyDown}>
  Click or press Enter
</button>

// Tab order must be logical
<form>
  <input tabIndex={1} />
  <input tabIndex={2} />
  <button tabIndex={3}>Submit</button>
</form>
```

### Focus Management

```tsx
export function Modal({ isOpen, onClose }: ModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [isOpen]);

  return (
    <div role="dialog" aria-modal="true">
      {/* content */}
      <button ref={closeButtonRef} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
```

---

## Performance Guidelines

### Use React.memo for Expensive Components

```tsx
// ✅ Good: Memoize expensive component
export const ExpensiveComponent = React.memo(function ExpensiveComponent({
  data,
}: {
  data: Data;
}) {
  // Expensive rendering logic
  return <div>{/* ... */}</div>;
});
```

### Use useMemo for Expensive Calculations

```tsx
export function Component({ events }: { events: Event[] }) {
  // ✅ Good: Memoize expensive calculation
  const filteredEvents = useMemo(
    () => events.filter(e => e.type === 'tool.called'),
    [events]
  );

  return <EventList events={filteredEvents} />;
}
```

### Use useCallback for Event Handlers

```tsx
export function Component({ onSave }: { onSave: (data: Data) => void }) {
  const [data, setData] = useState<Data>({});

  // ✅ Good: Memoize callback
  const handleSave = useCallback(() => {
    onSave(data);
  }, [data, onSave]);

  return <button onClick={handleSave}>Save</button>;
}
```

---

## Code Review Checklist

### Before Submitting PR

- [ ] All tests pass (`pnpm test`)
- [ ] No TypeScript errors (`pnpm tsc --noEmit`)
- [ ] No linting errors (`pnpm eslint .`)
- [ ] No console.log statements
- [ ] Accessibility attributes added
- [ ] Loading/error states handled

### During Review

**Type Safety**
- [ ] All props typed (no `any`)
- [ ] Event handlers typed
- [ ] State typed

**Component Quality**
- [ ] Component ≤ 200 lines
- [ ] Single responsibility
- [ ] No nested components
- [ ] Props ≤ 7

**Hooks**
- [ ] Follow Rules of Hooks
- [ ] Dependencies correct
- [ ] Cleanup functions provided

**Accessibility**
- [ ] ARIA attributes present
- [ ] Keyboard navigation works
- [ ] Focus management correct

**Performance**
- [ ] Context values memoized
- [ ] Expensive calcs memoized
- [ ] No unnecessary re-renders

**Testing**
- [ ] Critical paths tested
- [ ] Edge cases covered
- [ ] Error paths tested

---

## Verification

### Run All Checks

```bash
# TypeScript
pnpm tsc --noEmit        # Type check
pnpm eslint .            # Lint
pnpm prettier --check .  # Format check
pnpm test                # Tests
pnpm test --coverage     # Coverage

# Accessibility
pnpm axe                 # A11y audit (if configured)
```

### Pre-commit Hook

```bash
# .husky/pre-commit
#!/bin/sh
pnpm tsc --noEmit || exit 1
pnpm eslint src/web/ || exit 1
pnpm test --passWithNoTests || exit 1
```

---

## Anti-patterns Summary

| Anti-pattern | Why Bad | Solution |
|--------------|---------|----------|
| `any` without docs | Loses type safety | Use proper types |
| Logic in components | Hard to test | Extract to hooks |
| Index as key | Re-render issues | Use unique ID |
| Conditional hooks | Violates Rules | Always call hooks |
| Nested components | Creates new component every render | Define at module level |
| No loading states | Bad UX | Handle all states |
| No accessibility | Excludes users | Add ARIA attributes |
| No memoization | Performance issues | Use memo/useMemo/useCallback |

---

## Related Specs

- [Component Guidelines](./component-guidelines.md) - Component patterns
- [Hook Guidelines](./hook-guidelines.md) - Hook patterns
- [Type Safety](./type-safety.md) - TypeScript types
- [State Management](./state-management.md) - State patterns
