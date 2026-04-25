import http from "node:http";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const server = http.createServer((request, response) => {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8"
  });
  response.end(`<!doctype html>
<html>
  <head>
    <title>Brimble sample</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        background: #f8fafc;
        color: #0f172a;
      }
      main {
        width: min(720px, calc(100vw - 32px));
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: white;
        padding: 32px;
        box-shadow: 0 10px 30px rgb(15 23 42 / 8%);
      }
      code {
        border-radius: 6px;
        background: #e2e8f0;
        padding: 2px 6px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Running behind Caddy</h1>
      <p>This sample was built by Railpack and started as a Docker container.</p>
      <p>Request path: <code>${request.url}</code></p>
    </main>
  </body>
</html>`);
});

server.listen(port, host, () => {
  console.log(`node-hello listening on http://${host}:${port}`);
});
