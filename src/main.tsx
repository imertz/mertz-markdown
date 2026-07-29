import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/index.css'
import './styles/editor.css'
import './styles/comments.css'
import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
