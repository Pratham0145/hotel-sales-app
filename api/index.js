// api/index.js
// Vercel entrypoint. vercel.json rewrites every request to this function,
// which just hands it to the existing Express app (server.js) unchanged —
// Vercel's Node runtime knows how to drive an Express app as a handler.
module.exports = require('../server');
