# Improve Web Chat UI - Fix Scrolling and Add Markdown Rendering

## Problems

Three UI issues in the web chat interface:

1. **Auto-scroll behavior issue**: When receiving messages, the webpage jumps to an unexpected position
2. **Page-level scrolling**: The entire page scrolls instead of just the chat messages area
3. **No markdown rendering**: Messages are displayed as plain text, not formatted markdown

## Requirements

### 1. Fix Auto-scroll Behavior

**Current Issue**:
- `messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })` may cause unexpected scrolling
- The scroll target might not be correct

**Expected Behavior**:
- When new messages arrive, smoothly scroll to the bottom of the messages container
- Should not affect the page-level scroll position
- Should only scroll the messages container itself

### 2. Make Messages Container Independently Scrollable

**Current Issue**:
- Messages container grows with content, causing page-level scrolling
- No fixed height or overflow handling

**Expected Behavior**:
- Messages container should have a fixed height (or flex-grow to fill available space)
- Messages container should have `overflow-y: auto` for independent scrolling
- Page layout should not scroll when messages overflow
- Scrollbar should appear only on the messages container

### 3. Add Markdown Rendering

**Current Issue**:
- Messages display as plain text
- No formatting for code blocks, lists, bold, italic, etc.

**Expected Behavior**:
- User and assistant messages should render markdown:
  - Code blocks with syntax highlighting
  - Inline code with backticks
  - Bold, italic, strikethrough
  - Lists (ordered and unordered)
  - Links
  - Blockquotes
  - Tables
- Preserve line breaks and whitespace where appropriate
- Safe HTML rendering (prevent XSS)

## Implementation Plan

### 1. Fix Auto-scroll

**File**: `web/src/components/Chat/ChatWindow.tsx`

Current code (line 40-43):
```typescript
useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [messages]);
```

**Solution**:
- Use `scrollTop` instead of `scrollIntoView` for more control
- Get the messages container ref and scroll it directly
- Ensure we're scrolling the container, not the page

```typescript
const messagesContainerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (messagesContainerRef.current) {
    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
  }
}, [messages]);
```

### 2. Make Messages Container Scrollable

**File**: `web/src/components/Chat/Chat.module.css`

**Changes needed**:

```css
.messagesContainer {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 1rem;
  /* Remove any height: auto or min-height that allows unlimited growth */
}

.chatWindow {
  display: flex;
  flex-direction: column;
  height: 100%; /* or a fixed height like calc(100vh - header) */
  overflow: hidden; /* Prevent page-level scrolling */
}
```

The key is:
- `.chatWindow` should have a fixed height and `overflow: hidden`
- `.messagesContainer` should have `flex: 1` to fill available space and `overflow-y: auto`

### 3. Add Markdown Rendering

**Dependencies**:
- Install `react-markdown` for markdown parsing
- Install `remark-gfm` for GitHub Flavored Markdown (tables, strikethrough, etc.)
- Install `react-syntax-highlighter` for code syntax highlighting

```bash
cd web
pnpm add react-markdown remark-gfm react-syntax-highlighter
pnpm add -D @types/react-syntax-highlighter
```

**File**: `web/src/components/Chat/ChatMessage.tsx`

Current code (line 20-30):
```typescript
<div className={styles.messageContent}>
  {message.content}
</div>
```

**New code**:
```typescript
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

<div className={styles.messageContent}>
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      code({ node, inline, className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || '');
        return !inline && match ? (
          <SyntaxHighlighter
            style={oneDark}
            language={match[1]}
            PreTag="div"
            {...props}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        ) : (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    }}
  >
    {message.content}
  </ReactMarkdown>
</div>
```

**CSS Updates** (`Chat.module.css`):

Add styles for markdown elements:

```css
.messageContent {
  /* Existing styles */
}

/* Markdown styles */
.messageContent pre {
  background: #282c34;
  border-radius: 4px;
  padding: 1rem;
  overflow-x: auto;
  margin: 0.5rem 0;
}

.messageContent code {
  background: rgba(0, 0, 0, 0.1);
  padding: 0.2rem 0.4rem;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
}

.messageContent pre code {
  background: none;
  padding: 0;
}

.messageContent p {
  margin: 0.5rem 0;
}

.messageContent ul,
.messageContent ol {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

.messageContent blockquote {
  border-left: 3px solid #ccc;
  padding-left: 1rem;
  margin: 0.5rem 0;
  color: #666;
}

.messageContent table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5rem 0;
}

.messageContent th,
.messageContent td {
  border: 1px solid #ddd;
  padding: 0.5rem;
  text-align: left;
}

.messageContent th {
  background: #f5f5f5;
  font-weight: bold;
}

.messageContent a {
  color: #0066cc;
  text-decoration: none;
}

.messageContent a:hover {
  text-decoration: underline;
}
```

## Acceptance Criteria

### 1. Auto-scroll
- [ ] New messages cause smooth scroll to bottom of messages container
- [ ] Page-level scroll position is not affected
- [ ] Scroll behavior is smooth and not jarring

### 2. Scrollable Container
- [ ] Messages container has independent scrollbar
- [ ] Page does not scroll when messages overflow
- [ ] Container fills available vertical space
- [ ] Scrollbar appears only when needed

### 3. Markdown Rendering
- [ ] Code blocks render with syntax highlighting
- [ ] Inline code renders with monospace font and background
- [ ] Bold, italic, strikethrough work correctly
- [ ] Lists (ordered and unordered) render properly
- [ ] Links are clickable and styled
- [ ] Tables render with borders
- [ ] Blockquotes are visually distinct
- [ ] No XSS vulnerabilities (react-markdown handles this)

## Testing Plan

### Manual Testing

1. **Auto-scroll**:
   - Send multiple messages
   - Verify smooth scroll to bottom after each message
   - Scroll up manually, send new message, verify it scrolls to bottom
   - Check that page doesn't jump

2. **Scrollable Container**:
   - Send many messages to overflow the container
   - Verify scrollbar appears on messages container, not page
   - Scroll messages up/down
   - Verify page body doesn't scroll

3. **Markdown Rendering**:
   - Send message with code block: ` ```typescript\nconst x = 1;\n``` `
   - Send message with inline code: `` `console.log()` ``
   - Send message with **bold** and *italic*
   - Send message with list
   - Send message with link: `[Google](https://google.com)`
   - Verify all render correctly

### Test Messages

```markdown
# Test Message 1: Code Block
Here's some TypeScript code:
```typescript
function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

# Test Message 2: Inline Code
Use `console.log()` to debug your code.

# Test Message 3: Formatting
This is **bold** and this is *italic* and this is ~~strikethrough~~.

# Test Message 4: List
Here's a list:
- Item 1
- Item 2
  - Nested item
- Item 3

# Test Message 5: Link
Check out [OpenAI](https://openai.com) for more info.

# Test Message 6: Table
| Feature | Status |
|---------|--------|
| Markdown | ✅ |
| Scrolling | ✅ |
```

## Technical Notes

### Dependencies

- `react-markdown`: ^9.0.0 (markdown parser)
- `remark-gfm`: ^4.0.0 (GitHub Flavored Markdown)
- `react-syntax-highlighter`: ^15.5.0 (code highlighting)
- `@types/react-syntax-highlighter`: ^15.5.0 (TypeScript types)

### Performance Considerations

- `react-markdown` is performant for typical chat messages
- Syntax highlighting is only applied to code blocks, not inline code
- Consider memoizing the markdown component if performance issues arise

### Security

- `react-markdown` is safe by default (no dangerouslySetInnerHTML)
- It sanitizes HTML and prevents XSS attacks
- Links open in the same tab by default (consider adding `target="_blank"` if needed)

## Non-Goals

- ❌ Custom markdown syntax
- ❌ Message editing
- ❌ Copy code button (can be added later)
- ❌ Collapsible code blocks
- ❌ Custom syntax highlighting themes (using oneDark for now)

## Future Enhancements (Out of Scope)

- Copy button for code blocks
- Collapsible long messages
- Image rendering in markdown
- LaTeX/math rendering
- Custom emoji support
