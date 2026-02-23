/**
 * http-bridge.ts — HTTP(S) → vsock bridge (parent side)
 *
 * Listens for HTTP requests from the API (Cloudflare Worker / any HTTP client)
 * and proxies them transparently to the enclave Express server via vsock.
 *
 * The enclave exposes the same REST API as the Evervault enclave:
 *   POST /internal/generate
 *   POST /internal/sign
 *   POST /internal/destroy
 *   POST /internal/backup/export
 *   POST /internal/backup/import
 *   GET  /health
 *
 * The x-internal-api-key header is forwarded unchanged so the enclave can
 * authenticate the request.  No header is added or removed by the bridge.
 *
 * Transport:
 *   - Incoming: plain HTTP (trusted VPC) or TLS (optional, see config.ts)
 *   - Outgoing: vsock to enclave CID:5000 (production) or TCP localhost (dev)
 *
 * Connection handling:
 *   One vsock connection per HTTP request — keeps state management simple and
 *   matches the Evervault data-plane model.  For higher throughput, use a
 *   connection pool or persistent vsock streams.
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import net from "node:net";
import { config } from "./config.js";
import { connectVsock } from "./vsock.js";

function forwardToEnclave(req: http.IncomingMessage, res: http.ServerResponse): void {
  const enclaveCid  = config.enclaveCid;
  const enclavePort = config.enclavePort;

  if (!config.devMode && enclaveCid === 0) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "ENCLAVE_CID not configured" }));
    return;
  }

  // Establish vsock (or TCP in dev mode) connection to the enclave
  const enclaveSocket = connectVsock(enclaveCid, enclavePort);

  enclaveSocket.on("error", (err) => {
    console.error("[bridge] vsock error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Enclave connection failed" }));
    }
  });

  enclaveSocket.on("connect", () => {
    // Reconstruct raw HTTP/1.1 request and forward over vsock
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("\r\n");

    const requestLine = `${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1\r\n`;
    enclaveSocket.write(requestLine + headers + "\r\n\r\n");

    // Pipe the request body into the vsock connection
    req.pipe(enclaveSocket as unknown as NodeJS.WritableStream, { end: false });
    req.on("end", () => {
      // Flush; HTTP/1.1 keep-alive not used — we half-close after request body
    });

    // Parse the enclave's HTTP/1.1 response and write back to the client
    let responseBuffer = Buffer.alloc(0);
    let headersParsed = false;

    enclaveSocket.on("data", (chunk: Buffer) => {
      responseBuffer = Buffer.concat([responseBuffer, chunk]);

      if (!headersParsed) {
        const headerEnd = responseBuffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return; // still accumulating headers

        const headerSection = responseBuffer.subarray(0, headerEnd).toString();
        const body = responseBuffer.subarray(headerEnd + 4);

        const [statusLine, ...headerLines] = headerSection.split("\r\n");
        const statusMatch = statusLine?.match(/^HTTP\/1\.[01] (\d+)/);
        const statusCode = statusMatch ? parseInt(statusMatch[1]!, 10) : 200;

        const responseHeaders: Record<string, string> = {};
        for (const line of headerLines) {
          const colon = line.indexOf(":");
          if (colon > 0) {
            const key = line.slice(0, colon).trim().toLowerCase();
            const val = line.slice(colon + 1).trim();
            responseHeaders[key] = val;
          }
        }

        res.writeHead(statusCode, responseHeaders);
        if (body.length > 0) res.write(body);
        headersParsed = true;
      } else {
        res.write(chunk);
      }
    });

    enclaveSocket.on("end", () => res.end());
  });
}

export function startHttpBridge(): http.Server | https.Server {
  let server: http.Server | https.Server;

  if (config.bridgeUseTls) {
    const tlsOptions = {
      cert: fs.readFileSync(config.tlsCertPath),
      key:  fs.readFileSync(config.tlsKeyPath)
    };
    server = https.createServer(tlsOptions, forwardToEnclave);
  } else {
    server = http.createServer(forwardToEnclave);
  }

  server.listen(config.bridgeListenPort, () => {
    const proto = config.bridgeUseTls ? "https" : "http";
    console.log(`[bridge] Listening on ${proto}://0.0.0.0:${config.bridgeListenPort}`);
    console.log(`[bridge] Forwarding to enclave CID=${config.enclaveCid} port=${config.enclavePort}`);
  });

  return server;
}
