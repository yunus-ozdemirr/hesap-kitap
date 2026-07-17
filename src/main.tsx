import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

if (window.self !== window.top) {
  document.documentElement.replaceChildren()
  throw new Error('Uygulamanın başka bir site içinde açılması engellendi.')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`))
}
