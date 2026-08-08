import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './src/index.css';
import { startAppLifecycle } from './src/appLifecycle';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
startAppLifecycle();
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
