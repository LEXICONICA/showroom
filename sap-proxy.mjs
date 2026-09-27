import http from "node:http";
import https from "node:https";

const port = 3101;
const allowedBase = "https://192.168.1.160:50000/b1s/v1";

function sapRequest({ url, method = "GET", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    if (!url.startsWith(allowedBase)) return reject(new Error("Destino SAP no permitido"));
    const target = new URL(url);
    const request = https.request({
      hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`,
      method, headers, rejectUnauthorized: false,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode || 500, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/request") { response.writeHead(404).end(); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = await sapRequest(payload);
    response.writeHead(result.status, { "Content-Type": result.headers["content-type"] || "application/json" });
    response.end(result.body);
  } catch (error) {
    response.writeHead(502, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: { value: error instanceof Error ? error.message : "Error de conexión" } } }));
  }
}).listen(port, "127.0.0.1", () => console.log(`SAP bridge ready on ${port}`));
