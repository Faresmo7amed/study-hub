import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import PrivacyPolicy from './PrivacyPolicy.jsx'

// /privacy is a public page: it renders outside <App /> so it is not behind the login gate
const isPrivacy = window.location.pathname.replace(/\/+$/, '') === '/privacy'

createRoot(document.getElementById('root')).render(
    <StrictMode>
        {isPrivacy ? <PrivacyPolicy /> : <App />}
    </StrictMode>,
)
