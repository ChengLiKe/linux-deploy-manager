import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import TerminalLayout from './components/TerminalLayout'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Setup from './pages/Setup'
import KeyList from './pages/KeyList'
import ProjectList from './pages/ProjectList'
import ProjectForm from './pages/ProjectForm'
import ServerNodeList from './pages/ServerNodeList'
import TerminalPage from './pages/TerminalPage'
import TerminalManage from './pages/TerminalManage'
import Settings from './pages/Settings'

function App() {
  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/keys" element={<KeyList />} />
        <Route path="/server-nodes" element={<ServerNodeList />} />
        <Route path="/projects" element={<ProjectList />} />
        <Route path="/projects/new" element={<ProjectForm />} />
        <Route path="/projects/:id/edit" element={<ProjectForm />} />
        <Route path="/projects/:id/deploy" element={<ProjectForm />} />
        <Route path="/terminal" element={<TerminalLayout />}>
          <Route index element={<TerminalManage />} />
          <Route path=":nodeId" element={<TerminalPage />} />
        </Route>
      </Route>
      <Route path="/server-nodes/:nodeId/terminal" element={<TerminalPage />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  )
}

export default App