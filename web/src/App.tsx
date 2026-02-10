/**
 * App - main application component with routing
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ChatPage, TracePage, RunsPage, BlackboardPage } from './pages';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/trace/:runId" element={<TracePage />} />
        <Route path="/blackboard/:groupId" element={<BlackboardPage />} />
      </Routes>
    </BrowserRouter>
  );
}
