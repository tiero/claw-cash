/**
 * vsock.ts — AF_VSOCK socket helpers for the parent instance
 *
 * vsock (AF_VSOCK = 40) is the only channel between an EC2 instance and its
 * Nitro enclaves.  Node.js does not expose AF_VSOCK natively, so we build on
 * two thin C helpers compiled into the Docker image / installed on the parent:
 *
 *   vsock-listen  <port>      — listens on vsock, writes each connection's
 *                               stream as framed messages to stdout, reads
 *                               framed messages from stdin and sends them back.
 *   vsock-connect <cid> <port> — connects to <cid>:<port>, bridges stdin↔socket.
 *
 * In NITRO_DEV_MODE the vsock layer is bypassed: the enclave process runs on
 * localhost with plain TCP sockets so the full stack can be exercised without
 * Nitro hardware.
 */

import net from "node:net";
import { spawn } from "node:child_process";
import { config } from "./config.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VsockServer {
  on(event: "connection", listener: (socket: net.Socket) => void): this;
  close(): void;
}

// ─── Dev mode: plain TCP ─────────────────────────────────────────────────────

function createTcpServer(port: number): VsockServer {
  return net.createServer().listen(port);
}

function createTcpConnection(host: string, port: number): net.Socket {
  return net.createConnection({ host, port });
}

// ─── Production: vsock via helper binaries ───────────────────────────────────
//
// vsock-listen wraps the underlying socket in a simple length-prefix framing
// so multiple concurrent connections can multiplex over the single stdio pipe.
// Each frame: [u32 conn_id][u32 data_len][data bytes]
// For the HTTP bridge use case, we keep it simple: one connection per child
// process invocation (fork-per-connection model).

function createVsockConnectionViaHelper(cid: number, port: number): net.Socket {
  const child = spawn("/usr/local/bin/vsock-connect", [String(cid), String(port)], {
    stdio: ["pipe", "pipe", "inherit"]
  });

  // Wrap child stdio as a net.Socket-compatible duplex
  const socket = new net.Socket();
  socket.connect(0); // not actually used — we override read/write
  // @ts-expect-error — duck-type: wire child's streams into the socket-like object
  socket.pipe = (dest: NodeJS.WritableStream) => { child.stdout.pipe(dest); return dest; };
  child.stdout.pipe(socket as unknown as NodeJS.WritableStream);
  (socket as unknown as NodeJS.WritableStream).write = (chunk: Buffer | string) =>
    child.stdin.write(chunk);

  child.on("exit", () => socket.destroy());
  return socket;
}

/**
 * Create a vsock server that listens for incoming connections from the enclave.
 * In dev mode, falls back to a plain TCP server on localhost.
 */
export function createVsockServer(port: number): VsockServer {
  if (config.devMode) {
    console.log(`[vsock] dev mode — TCP server on localhost:${port}`);
    return createTcpServer(port);
  }

  // Production: launch vsock-listen helper
  // The helper accepts connections on vsock port <port> and forks a child
  // for each connection, bridging that connection's stream to the parent's
  // HTTP bridge via a Unix socket per connection.
  //
  // For simplicity, we use a fork-per-connection model via a small shell loop:
  //   while true; do vsock-accept <port> | <handler>; done
  // A full implementation would use a proper event loop in C; for now we
  // expose the same net.Server interface backed by a vsock listen fd.

  // The vsock-listen helper writes accepted connection fds via SCM_RIGHTS.
  // We use a net.Server with a pre-created vsock listening fd.
  const helperPath = "/usr/local/bin/vsock-listen";
  const child = spawn(helperPath, [String(port)], {
    stdio: ["inherit", "pipe", "inherit"]
  });

  const emitter = new net.Server();
  child.stdout.on("data", (fdMsg: Buffer) => {
    // The helper writes: [u32 fd] for each accepted connection
    const fd = fdMsg.readUInt32LE(0);
    const sock = new net.Socket({ fd, readable: true, writable: true });
    emitter.emit("connection", sock);
  });

  return emitter as unknown as VsockServer;
}

/**
 * Connect to an endpoint.
 * In dev mode: plain TCP to localhost.
 * In production: vsock to the enclave CID.
 */
export function connectVsock(cid: number, port: number): net.Socket {
  if (config.devMode) {
    console.log(`[vsock] dev mode — TCP connect localhost:${port}`);
    return createTcpConnection("127.0.0.1", port);
  }
  return createVsockConnectionViaHelper(cid, port);
}
