import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

console.log('[Renderer] main.tsx loaded');

window.addEventListener('error', (event) => {
  console.error('[Renderer Window Error]:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Renderer Unhandled Promise Rejection]:', event.reason);
});

const rootElement = document.getElementById('root');
console.log('[Renderer] rootElement found:', Boolean(rootElement));

if (rootElement) {
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log('[Renderer] App rendered successfully');
  } catch (err) {
    console.error('[Renderer] Fatal error rendering App in createRoot:', err);
  }
}
