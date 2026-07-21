// GitHub Pages origin plus a couple of local dev ports. Add more here if you
// serve the frontend from somewhere else during development.
const ALLOWED_ORIGINS = [
  "https://sdono043.github.io",
  "http://localhost:8765",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = { applyCors };
