import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign, X509Certificate } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer as createHttpsServer, get as httpsGet } from "node:https";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

// Official release assets and their published .sha256 files, checked 2026-09-06.
// https://github.com/tursodatabase/libsql/releases/tag/libsql-server-v0.24.32
export const SQLD_VERSION = "0.24.32";
const releaseUrl = `https://github.com/tursodatabase/libsql/releases/download/libsql-server-v${SQLD_VERSION}`;
const releases = {
  "darwin-arm64": ["aarch64-apple-darwin", "ced2a9d65a5d4b6bd72c67e98ad6c63139e2a139d91769f07fdd15be935381dd"],
  "darwin-x64": ["x86_64-apple-darwin", "461480ea5a17781bab7dd5974aa804007434611baced37b6349c8060d0648e34"],
  "linux-arm64": ["aarch64-unknown-linux-gnu", "37f9eee45b388a30192907ecf4565b93df945c079331657073b5b3caf8bb1cd0"],
  "linux-x64": ["x86_64-unknown-linux-gnu", "71720fc8648c19efef416efebd47145ef59b62e198770533530a858e1336879f"],
};

export function safeSmokeEnvironment() {
  return Object.fromEntries(
    ["PATH", "HOME", "USERPROFILE", "CI", "LANG", "LC_ALL", "TMPDIR"]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
}

export function startProcess(command, args, { logPath, ...options }) {
  const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  // Always resolve so a startup failure cannot become an unhandled rejection
  // while the caller is checking readiness. The log is flushed before return.
  const completed = new Promise((resolve) => {
    let spawnError;
    child.on("error", (error) => { spawnError = error; });
    child.once("close", (code, signal) => log.end(() => resolve({ code, signal, error: spawnError })));
  });
  return { child, completed, logPath };
}

export async function stopProcess(managedProcess, { group = false } = {}) {
  if (!managedProcess) return;
  const { child, completed } = managedProcess;
  const send = (signal) => {
    try {
      if (group && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  if (child.exitCode === null && child.signalCode === null) send("SIGTERM");
  const timer = setTimeout(() => send("SIGKILL"), 5_000);
  try {
    await completed;
  } finally {
    clearTimeout(timer);
    // Also reap any grandchildren left behind if the worker exited abruptly.
    if (group) send("SIGKILL");
  }
}

export async function runCommand(command, args, options) {
  const process = startProcess(command, args, options);
  const timer = setTimeout(() => { process.child.kill("SIGKILL"); }, 120_000);
  try {
    const result = await process.completed;
    if (result.code !== 0 || result.error) {
      throw new Error(`${command} failed (${result.error?.message ?? result.signal ?? result.code}); see ${process.logPath}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function unusedLoopbackPort() {
  const socket = createTcpServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

export async function createSmokeCertificate(directory, evidenceDirectory) {
  const certPath = join(directory, "localhost-cert.pem");
  const keyPath = join(directory, "localhost-key.pem");
  const configPath = join(directory, "openssl.cnf");
  // Use a config file instead of -addext for compatibility with macOS OpenSSL.
  await writeFile(configPath, `[req]
prompt = no
distinguished_name = subject
x509_extensions = extensions
[subject]
CN = localhost
[extensions]
subjectAltName = DNS:localhost,IP:127.0.0.1
basicConstraints = critical,CA:TRUE
keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign
extendedKeyUsage = serverAuth
`, { mode: 0o600 });
  await runCommand("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1",
    "-config", configPath, "-keyout", keyPath, "-out", certPath], {
    cwd: directory, env: safeSmokeEnvironment(), logPath: join(evidenceDirectory, "openssl.log"),
  });
  return { certPath, keyPath };
}

export async function readSmokeCertificate(directory) {
  const certPath = join(directory, "localhost-cert.pem");
  const cert = await readFile(certPath);
  const key = await readFile(join(directory, "localhost-key.pem"));
  const publicKey = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
  return { certPath, cert, key, spki: createHash("sha256").update(publicKey).digest("base64") };
}

// Only terminate TLS and forward bytes. sqld handles the real Hrana protocol,
// SQL, transactions and JWT validation. Its TLS flags cover gRPC, not HTTP:
// https://github.com/tursodatabase/libsql/blob/libsql-server-v0.24.32/libsql-server/src/main.rs
export async function startHttpsProxy({ tls, upstreamPort, port = 0, onRequest = () => {} }) {
  const proxy = createHttpsServer({ key: tls.key, cert: tls.cert }, (incoming, outgoing) => {
    const upstream = request({
      hostname: "127.0.0.1", port: upstreamPort, method: incoming.method, path: incoming.url,
      headers: {
        ...incoming.headers,
        "x-forwarded-proto": "https",
        "x-forwarded-host": incoming.headers.host,
        "x-forwarded-for": "127.0.0.1",
      },
    }, (response) => {
      onRequest({ method: incoming.method, path: incoming.url, status: response.statusCode });
      outgoing.writeHead(response.statusCode, response.headers);
      response.pipe(outgoing);
      response.on("error", () => outgoing.destroy());
    });
    upstream.setTimeout(30_000, () => upstream.destroy(new Error("Local upstream timed out")));
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end("Local smoke upstream unavailable");
    });
    incoming.on("aborted", () => upstream.destroy());
    outgoing.on("close", () => upstream.destroy());
    incoming.pipe(upstream);
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: `https://127.0.0.1:${proxy.address().port}`,
    close: () => new Promise((resolve, reject) => {
      proxy.close((error) => error ? reject(error) : resolve());
      proxy.closeAllConnections();
    }),
  };
}

/**
 * Start an isolated official sqld with a local HTTPS endpoint and temporary JWT.
 * No arguments are required. stop/close removes helper-owned runtime files and
 * retains logs in evidenceDirectory. Supplied directories remain caller-owned.
 *
 * Returns { url, authToken, certPath, env, directory, evidenceDirectory,
 *           requests, release, stop, close }.
 *
 * Run remote clients in a NEW Node process with env: fixture.env so
 * NODE_EXTRA_CA_CERTS is loaded at startup. Do not use spawnSync/execFileSync:
 * this process must keep serving the HTTPS proxy while the client runs.
 *
 * const fixture = await startLibsqlSmokeServer();
 * try {
 *   await runCommand(process.execPath, ["--import=tsx", "--test", testPath], {
 *     env: fixture.env, logPath: join(fixture.evidenceDirectory, "remote-test.log"),
 *   });
 * } finally { await stopLibsqlSmokeServer(fixture); }
 */
export async function startLibsqlSmokeServer(options = {}) {
  const ownsDirectory = options.directory === undefined;
  const evidenceDirectory = options.evidenceDirectory ?? await mkdtemp(join(tmpdir(), "uktl-libsql-smoke-evidence-"));
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), "uktl-libsql-smoke-runtime-"));
  try {
    if (!options.tls) await createSmokeCertificate(directory, evidenceDirectory);
    const tls = options.tls ?? await readSmokeCertificate(directory);
    const server = await startSqld({ directory, evidenceDirectory, tls });
    let stopped;
    const stop = () => {
      stopped ??= (async () => {
        try {
          await server.close();
          await writeFile(join(evidenceDirectory, "libsql-requests.json"), JSON.stringify(server.requests, null, 2) + "\n", { mode: 0o600 });
        } finally {
          if (ownsDirectory) await rm(directory, { recursive: true, force: true });
        }
      })();
      return stopped;
    };
    return {
      ...server, directory, evidenceDirectory, certPath: tls.certPath, stop, close: stop,
      env: {
        ...safeSmokeEnvironment(),
        NODE_ENV: "production", NODE_EXTRA_CA_CERTS: tls.certPath,
        DATABASE_URL: "", TURSO_DATABASE_URL: server.url, TURSO_AUTH_TOKEN: server.authToken,
        META_MARKETING_TOKEN: "", META_WRITES_ENABLED: "false", ANTHROPIC_API_KEY: "",
        HIGHLEVEL_TOKEN: "", HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN: "", HIGHLEVEL_SYNC_ENABLED: "false",
      },
    };
  } catch (error) {
    try {
      await writeFile(join(evidenceDirectory, "startup-error.json"), JSON.stringify({ error: error.stack ?? String(error) }, null, 2) + "\n", { mode: 0o600 });
    } finally {
      if (ownsDirectory) await rm(directory, { recursive: true, force: true });
    }
    throw new Error(`Local libSQL fixture failed: ${error.message}; evidence: ${evidenceDirectory}`, { cause: error });
  }
}

export async function stopLibsqlSmokeServer(server) {
  await server?.stop();
}

function healthStatus(url, cert) {
  // Explicit CA trust for readiness lets callers start the fixture before
  // launching their Node client with NODE_EXTRA_CA_CERTS. Validation stays on.
  return new Promise((resolve, reject) => {
    const request = httpsGet(url + "/health", { ca: cert, signal: AbortSignal.timeout(2_000) }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
  });
}

async function startSqld({ directory, evidenceDirectory, tls }) {
  const platform = `${process.platform}-${process.arch}`;
  const release = releases[platform];
  if (!release) throw new Error(`No pinned official sqld ${SQLD_VERSION} binary for ${platform}; supported: ${Object.keys(releases).join(", ")}`);
  const [target, checksum] = release;
  const asset = `libsql-server-${target}.tar.xz`;
  const archivePath = join(directory, asset);
  const downloadUrl = `${releaseUrl}/${asset}`;
  const env = safeSmokeEnvironment();
  await runCommand("curl", ["--disable", "--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https",
    "--connect-timeout", "15", "--max-time", "90", "--retry", "2", "--output", archivePath, downloadUrl], {
    cwd: directory, env, logPath: join(evidenceDirectory, "download.log"),
  });
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
  const actualChecksum = hash.digest("hex");
  if (actualChecksum !== checksum) throw new Error(`sqld checksum mismatch for ${asset}: expected ${checksum}, got ${actualChecksum}; refusing to extract or execute`);
  const releaseEvidence = { version: SQLD_VERSION, platform, downloadUrl, sha256: actualChecksum, verified: true };
  await writeFile(join(evidenceDirectory, "sqld-release.json"), JSON.stringify(releaseEvidence, null, 2) + "\n");
  await runCommand("tar", ["-xJf", archivePath, "-C", directory], {
    cwd: directory, env, logPath: join(evidenceDirectory, "extract.log"),
  });
  const binary = join(directory, `libsql-server-${target}`, "sqld");
  await runCommand(binary, ["--version"], { cwd: directory, env, logPath: join(evidenceDirectory, "sqld-version.log") });

  // Official sqld Ed25519 JWT authentication with a per-run key and one-hour
  // token. These credentials cannot authenticate with any real provider.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyPath = join(directory, "sqld-jwt-public.pem");
  await writeFile(keyPath, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const authToken = `${unsigned}.${sign(null, Buffer.from(unsigned), privateKey).toString("base64url")}`;
  const upstreamPort = await unusedLoopbackPort();
  const requests = [];
  const proxy = await startHttpsProxy({ tls, upstreamPort, onRequest: (entry) => requests.push(entry) });
  const server = startProcess(binary, ["--db-path", join(directory, "data.sqld"), "--http-listen-addr", `127.0.0.1:${upstreamPort}`,
    "--http-self-url", proxy.url, "--auth-jwt-key-file", keyPath, "--no-welcome"], {
    cwd: directory, env: { ...env, RUST_LOG: "info" }, logPath: join(evidenceDirectory, "sqld.log"),
  });
  try {
    const deadline = Date.now() + 30_000;
    let lastError;
    while (Date.now() < deadline) {
      if (server.child.exitCode !== null || server.child.signalCode !== null) throw new Error(`sqld exited before readiness; see ${server.logPath}`);
      try {
        const status = await healthStatus(proxy.url, tls.cert);
        if (status === 200) return {
          url: proxy.url, authToken, requests, release: releaseEvidence,
          close: async () => { await proxy.close(); await stopProcess(server); },
        };
        lastError = new Error(`sqld /health returned ${status}`);
      } catch (error) { lastError = error; }
      await wait(100);
    }
    throw new Error(`sqld did not become ready: ${lastError?.message}; see ${server.logPath}`, { cause: lastError });
  } catch (error) {
    await proxy.close();
    await stopProcess(server);
    throw error;
  }
}
