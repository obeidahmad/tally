import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource-variable/bricolage-grotesque/index.css';
import '@fontsource-variable/noto-emoji/index.css';
import '../../design/tokens.css';
import '../../design/components.css';
import './app.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
