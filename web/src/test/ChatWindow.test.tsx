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

  it('renders attachment metadata on user messages', () => {
    const messages = [
      {
        id: 'msg_attach_1',
        role: 'user' as const,
        content: 'Please check this file',
        timestamp: new Date().toISOString(),
        attachments: [
          {
            uploadId: 'upl_abc123',
            fileName: 'notes.txt',
            mimeType: 'text/plain',
            sizeBytes: 1200,
            kind: 'text' as const,
            downloadUrl: '/api/uploads/upl_abc123?org_id=org_test&user_id=user_test',
          },
        ],
      },
    ];

    render(
      <ChatWindow
        messages={messages}
        onSend={vi.fn()}
      />
    );

    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByText(/text · 1.2KB/i)).toBeInTheDocument();
  });
});
