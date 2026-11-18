import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/global.css';
import { CalendarPage } from './CalendarPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CalendarPage />
  </StrictMode>,
);
