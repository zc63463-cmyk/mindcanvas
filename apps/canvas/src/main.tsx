import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = document.getElementById('root');
if (!root) throw new Error('root 元素缺失');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// S2 PWA 最小壳：仅生产构建注册 SW（dev 不注册避免缓存干扰）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
