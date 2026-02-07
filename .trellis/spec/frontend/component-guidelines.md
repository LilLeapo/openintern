# Component Guidelines

> How components are built in this project.

---

## Overview

This project uses **functional React components** with TypeScript and hooks.

**Key principles**:
- Components are pure render functions
- Props are explicitly typed (no PropTypes)
- Composition over inheritance
- Single responsibility (one component = one UI concern)

**Reference**: Based on patterns in directory-structure.md and type-safety.md.

---

## Component Structure

### Standard Component Template

```tsx
// src/web/components/chat/ChatInput.tsx

// 1. Imports (grouped: React → external → internal)
import { useState, useCallback } from 'react';
import { Button } from '@/web/components/common/Button';

// 2. Types (props interface)
interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
}

// 3. Component (export named function)
export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Type a message...',
  maxLength = 10000,
}: ChatInputProps) {
  // State
  const [text, setText] = useState('');

  // Event handlers
  const handleSubmit = useCallback(() => {
    if (text.trim()) {
      onSend(text);
      setText('');
    }
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  // Render
  return (
    <div className="chat-input">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
      />
      <Button onClick={handleSubmit} disabled={disabled || !text.trim()}>
        Send
      </Button>
    </div>
  );
}
```

**Order**:
1. Imports
2. Types (interfaces, type aliases)
3. Component function
4. Helper functions (if component-specific)

---

## Props Conventions

### Always Type Props

```tsx
// ✅ Good: Explicit interface
interface MessageItemProps {
  message: string;
  timestamp: string;
  sender: 'user' | 'assistant';
  onRetry?: () => void;
}

export function MessageItem(props: MessageItemProps) {
  // ...
}

// ❌ Bad: Untyped props
export function MessageItem(props) {
  // ...
}
```

### Use Destructuring with Defaults

```tsx
// ✅ Good: Destructure with defaults
export function Button({
  variant = 'primary',
  size = 'medium',
  disabled = false,
  onClick,
  children,
}: ButtonProps) {
  // ...
}

// ❌ Bad: Access via props object
export function Button(props: ButtonProps) {
  const variant = props.variant || 'primary';
  // ...
}
```

### Event Handler Naming

```tsx
interface ChatInputProps {
  // ✅ Good: on* prefix for event handlers
  onSend: (message: string) => void;
  onChange?: (text: string) => void;
  onError?: (error: Error) => void;

  // ❌ Bad: Inconsistent naming
  sendMessage: (message: string) => void;
  handleChange?: (text: string) => void;
}
```

### Optional vs Required Props

```tsx
interface ComponentProps {
  // Required props (no ?)
  title: string;
  onClose: () => void;

  // Optional props (with ?)
  description?: string;
  variant?: 'default' | 'danger';

  // Optional with default in destructuring
  showIcon?: boolean; // Default in component: showIcon = true
}
```

---

## Composition Patterns

### Container/Presenter Pattern

```tsx
// Container (handles logic)
// src/web/components/chat/ChatMessages.tsx
import { useMessages } from './useMessages';
import { MessageList } from './MessageList';

export function ChatMessages() {
  const { messages, isLoading, error } = useMessages();

  if (error) return <ErrorView error={error} />;
  if (isLoading) return <Spinner />;

  return <MessageList messages={messages} />;
}

// Presenter (pure render)
// src/web/components/chat/MessageList.tsx
interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="message-list">
      {messages.map(msg => (
        <MessageItem key={msg.id} message={msg} />
      ))}
    </div>
  );
}
```

### Compound Components

```tsx
// src/web/components/common/Card.tsx

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}

Card.Header = function CardHeader({ children }: { children: React.ReactNode }) {
  return <div className="card-header">{children}</div>;
};

Card.Body = function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="card-body">{children}</div>;
};

// Usage
<Card>
  <Card.Header>Title</Card.Header>
  <Card.Body>Content</Card.Body>
</Card>
```

### Render Props (for complex logic sharing)

```tsx
interface RenderPropsExample {
  children: (data: Data, isLoading: boolean) => React.ReactNode;
}

export function DataProvider({ children }: RenderPropsExample) {
  const { data, isLoading } = useData();
  return <>{children(data, isLoading)}</>;
}

// Usage
<DataProvider>
  {(data, isLoading) => (
    isLoading ? <Spinner /> : <DataView data={data} />
  )}
</DataProvider>
```

---

## Component Size Guidelines

### Max Lines Per Component

- **Simple components**: ≤ 100 lines
- **Complex components**: ≤ 200 lines
- If longer, split into smaller components

### Single Responsibility

```tsx
// ❌ Bad: One component does too much
export function ChatPanel() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  // ... 150 more lines
  return (
    <div>
      {/* Messages list */}
      {/* Input field */}
      {/* Typing indicator */}
      {/* Error handling */}
    </div>
  );
}

// ✅ Good: Split by responsibility
export function ChatPanel() {
  return (
    <div>
      <ChatMessages />
      <TypingIndicator />
      <ChatInput />
    </div>
  );
}
```

---

## Styling Patterns

### CSS Modules (Recommended)

```tsx
// ChatInput.module.css
.container {
  display: flex;
  gap: 8px;
}

.textarea {
  flex: 1;
  resize: none;
}

// ChatInput.tsx
import styles from './ChatInput.module.css';

export function ChatInput() {
  return (
    <div className={styles.container}>
      <textarea className={styles.textarea} />
      <Button>Send</Button>
    </div>
  );
}
```

### Conditional Classes

```tsx
import clsx from 'clsx';

interface ButtonProps {
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export function Button({ variant = 'primary', disabled = false }: ButtonProps) {
  return (
    <button
      className={clsx(
        'button',
        `button--${variant}`,
        disabled && 'button--disabled'
      )}
    >
      {/* ... */}
    </button>
  );
}
```

---

## Error Handling

### Error Boundaries

```tsx
// src/web/components/common/ErrorBoundary.tsx

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <pre>{this.state.error?.message}</pre>
        </div>
      );
    }

    return this.props.children;
  }
}

// Usage
<ErrorBoundary>
  <ChatPanel />
</ErrorBoundary>
```

### Graceful Degradation

```tsx
export function ChatMessages() {
  const { messages, error, isLoading } = useMessages();

  // Error state
  if (error) {
    return (
      <div className="error">
        <p>Failed to load messages</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return <Spinner />;
  }

  // Empty state
  if (messages.length === 0) {
    return <EmptyState message="No messages yet" />;
  }

  // Success state
  return <MessageList messages={messages} />;
}
```

---

## Accessibility

### Required A11y Attributes

```tsx
export function Button({ onClick, children, disabled }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={typeof children === 'string' ? children : undefined}
    >
      {children}
    </button>
  );
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      hidden={!isOpen}
    >
      <h2 id="modal-title">{title}</h2>
      {children}
      <button onClick={onClose} aria-label="Close modal">
        ×
      </button>
    </div>
  );
}
```

### Keyboard Navigation

```tsx
export function Menu({ items }: MenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        items[selectedIndex].onClick();
        break;
    }
  };

  return (
    <ul role="menu" onKeyDown={handleKeyDown}>
      {items.map((item, i) => (
        <li
          key={item.id}
          role="menuitem"
          aria-selected={i === selectedIndex}
          tabIndex={i === selectedIndex ? 0 : -1}
        >
          {item.label}
        </li>
      ))}
    </ul>
  );
}
```

---

## Anti-patterns

### ❌ Don't Use Class Components (unless Error Boundary)

```tsx
// ❌ Bad: Class component
class ChatInput extends React.Component {
  // ...
}

// ✅ Good: Functional component
export function ChatInput() {
  // ...
}
```

### ❌ Don't Mutate Props

```tsx
// ❌ Bad: Mutating props
export function Component({ items }: { items: Item[] }) {
  items.push(newItem); // WRONG: mutates prop
}

// ✅ Good: Create new array
export function Component({ items }: { items: Item[] }) {
  const newItems = [...items, newItem];
}
```

### ❌ Don't Use Inline Function Definitions in JSX

```tsx
// ❌ Bad: Creates new function on every render
<Button onClick={() => handleClick(id)}>Click</Button>

// ✅ Good: Use useCallback
const handleButtonClick = useCallback(() => {
  handleClick(id);
}, [id, handleClick]);

<Button onClick={handleButtonClick}>Click</Button>

// ✅ Also acceptable for simple handlers (no dependencies)
<Button onClick={() => setOpen(false)}>Close</Button>
```

### ❌ Don't Use Indexes as Keys

```tsx
// ❌ Bad: Index as key (causes re-render issues)
{messages.map((msg, i) => (
  <MessageItem key={i} message={msg} />
))}

// ✅ Good: Unique ID as key
{messages.map(msg => (
  <MessageItem key={msg.id} message={msg} />
))}
```

---

## Verification

### Component Checklist

- [ ] Props are typed (interface or type alias)
- [ ] Event handlers use `on*` naming
- [ ] Component is ≤ 200 lines
- [ ] No logic in render (extracted to hooks)
- [ ] Accessible (ARIA attributes where needed)
- [ ] Error states handled
- [ ] Loading states handled
- [ ] Empty states handled

### ESLint Rules

```json
{
  "rules": {
    "react/prop-types": "off",
    "react/jsx-key": "error",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "@typescript-eslint/no-explicit-any": "error"
  }
}
```

---

## Related Specs

- [Directory Structure](./directory-structure.md) - Where components live
- [Hook Guidelines](./hook-guidelines.md) - Custom hooks
- [Type Safety](./type-safety.md) - Props typing
- [State Management](./state-management.md) - State patterns
