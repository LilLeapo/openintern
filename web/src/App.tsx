/**
 * App - main application component with routing
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import {
  ChatPage,
  DashboardPage,
  TracePage,
  RunsPage,
  BlackboardPage,
  SkillsPage,
  GroupRunPage,
  TeamManagementPage,
  InboxPage,
  EmulatorPage,
} from './pages';
import { AppPreferencesProvider } from './context/AppPreferencesContext';

export function App() {
  return (
    <AppPreferencesProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/emulator" element={<EmulatorPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/trace/:runId" element={<TracePage />} />
          <Route path="/blackboard" element={<BlackboardPage />} />
          <Route path="/blackboard/:groupId" element={<BlackboardPage />} />
          <Route path="/orchestrator" element={<TeamManagementPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/group-run/:runId" element={<GroupRunPage />} />
        </Routes>
      </BrowserRouter>
    </AppPreferencesProvider>
  );
}
