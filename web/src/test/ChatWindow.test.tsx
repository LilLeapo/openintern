/**
 * ChatWindow component tests
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatWindow } from '../components/Chat/ChatWindow';

describe('ChatWindow', () => {
  it('renders empty state when no messages', () => {
    render(
      <ChatWindow
        messages={[]}
        onSend={vi.fn()}
      />
    );

    expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
  });

  it('renders messages', () => {
    const messages = [
      {
        id: 'msg_1',
        role: 'user' as const,
        content: 'Hello',
        timestamp: new Date().toISOString(),
      },
      {
        id: 'msg_2',
        role: 'assistant' as const,
        content: 'Hi there!',
        timestamp: new Date().toISOString(),
      },
    ];

    render(
      <ChatWindow
        messages={messages}
        onSend={vi.fn()}
      />
    );

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('shows typing indicator when running', () => {
    render(
      <ChatWindow
        messages={[]}
        onSend={vi.fn()}
        isRunning={true}
      />
    );

    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
  });
});
