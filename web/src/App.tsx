import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Setup from './pages/Setup'
import KeyList from './pages/KeyList'
import TemplateList from './pages/TemplateList'
import TemplateForm from './pages/TemplateForm'
import ServerNodeList from './pages/ServerNodeList'
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
        <Route path="/templates" element={<TemplateList />} />
        <Route path="/templates/new" element={<TemplateForm />} />
        <Route path="/templates/:id/edit" element={<TemplateForm />} />
        <Route path="/templates/:id/deploy" element={<TemplateForm />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}

export default App