/**
 * ChatPage - main chat interface page
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatWindow } from '../components/Chat';
import { useChat } from '../hooks/useChat';
import styles from './Pages.module.css';

const DEFAULT_SESSION = 's_default';

export function ChatPage() {
  const [sessionKey] = useState(DEFAULT_SESSION);
  const navigate = useNavigate();
  const { messages, isRunning, error, sendMessage } = useChat(sessionKey);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Agent Chat</h1>
        <button
          className={styles.navButton}
          onClick={() => navigate('/runs')}
        >
          View Runs
        </button>
      </header>
      <main className={styles.main}>
        <ChatWindow
          messages={messages}
          onSend={sendMessage}
          isRunning={isRunning}
          error={error}
        />
      </main>
    </div>
  );
}
