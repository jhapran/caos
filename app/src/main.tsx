import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './data/auth'
import { DemoStoreProvider } from './data/store.tsx'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <AuthProvider>
      <DemoStoreProvider>
        <App />
      </DemoStoreProvider>
    </AuthProvider>
  </BrowserRouter>,
)
