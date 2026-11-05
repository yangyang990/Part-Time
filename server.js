// Local development server:  npm run dev   (or npm start)
// On Vercel the same app runs from api/index.js instead.
import app, { ORGANISER_CODE } from './app.js';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`ShiftCrew running at http://localhost:${PORT}`);
  console.log(`Organiser sign-up code: ${ORGANISER_CODE}`);
});
