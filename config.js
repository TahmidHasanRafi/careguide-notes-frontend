// Where the API lives.
// - When the backend serves this frontend (local "npm run dev"), the backend replaces
//   this file with API_BASE: '/api', so nothing needs changing.
// - When this folder is deployed on its own (Vercel), it calls the live API below.
window.APP_CONFIG = window.APP_CONFIG || {
  API_BASE: ['localhost', '127.0.0.1'].includes(location.hostname)
    ? 'http://localhost:5050/api'
    : 'https://care-api.tahmid-hasan-rafi.com/api',
};
