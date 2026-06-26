// Passenger startup file (cPanel / CloudLinux Node.js Selector).
//
// Passenger runs this file and provides the listening socket via process.env.PORT.
// We boot Next.js in production mode and hand every request to its request
// handler. basePath (/agentic-crm) is configured in next.config.mjs, so Next
// matches and generates URLs under the subpath automatically.
//
// Requires a production build first:  npm run build

const { createServer } = require("http");
const next = require("next");

const app = next({ dev: false });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((req, res) => handle(req, res)).listen(
      process.env.PORT || 3000,
      () => {
        console.log("Next.js server started (port " + (process.env.PORT || 3000) + ")");
      }
    );
  })
  .catch((err) => {
    console.error("Failed to start Next.js server:", err);
    process.exit(1);
  });
