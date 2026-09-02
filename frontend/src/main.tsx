import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './styles-activities.css';
import './styles-activities-editor.css';
import './styles-activities-chooser.css';
import './styles-roles.css';
import './styles-mobile.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
