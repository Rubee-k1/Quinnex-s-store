// Local stand-in for Google's OAuth/OIDC endpoints, used ONLY to test the
// Supabase Auth (GoTrue) Google provider end to end without real Google.
//  - TLS server (cert signed by a test CA) for accounts.google.com,
//    oauth2.googleapis.com, www.googleapis.com, openidconnect.googleapis.com
//  - HTTP CONNECT proxy that sends those hosts to the TLS server
// The authorization "code" is base64url(JSON {user, nonce}) produced by the
// test when it simulates the consent screen.
import https from "node:https";
import http from "node:http";
import net from "node:net";
import { readFileSync, appendFileSync } from "node:fs";
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";

// Certificates (leaf.key / leaf.pem, signed by a test CA) live in FAKE_GOOGLE_DIR.
const dir = (process.env.FAKE_GOOGLE_DIR || new URL(".", import.meta.url).pathname).replace(/\/?$/, "/");
const log = (o) => appendFileSync(dir + "google.log", JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "quinnex-test-client.apps.googleusercontent.com";
const USERS = {
  alice: { sub: "100000000000000000001", email: "alice.quinnex@example.com", name: "Alice Google", picture: "https://lh3.googleusercontent.com/a/alice" },
  bob: { sub: "100000000000000000002", email: "bob.quinnex@example.com", name: "Bob Google", picture: "https://lh3.googleusercontent.com/a/bob" },
};
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-key-1";
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, use: "sig", alg: "RS256" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const signJwt = (payload) => {
  const head = b64({ alg: "RS256", typ: "JWT", kid: KID });
  const body = b64(payload);
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
};
const tokens = new Map(); // access_token -> user
const decodeCode = (code) => { try { return JSON.parse(Buffer.from(code, "base64url").toString()); } catch { return null; } };

const json = (res, status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const app = (req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    log({ method: req.method, host: req.headers.host, path: url.pathname });
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(res, 200, {
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        id_token_signing_alg_values_supported: ["RS256"],
        response_types_supported: ["code"], subject_types_supported: ["public"],
      });
    }
    if (url.pathname === "/oauth2/v3/certs") return json(res, 200, { keys: [jwk] });
    if (req.method === "POST" && url.pathname.endsWith("/token")) {
      const p = new URLSearchParams(body);
      const auth = req.headers.authorization ? Buffer.from(req.headers.authorization.split(" ")[1] || "", "base64").toString() : "";
      const clientId = p.get("client_id") || auth.split(":")[0];
      const c = decodeCode(p.get("code") || "");
      const user = c && USERS[c.user];
      if (!user || clientId !== CLIENT_ID) { log({ tokenError: "invalid_grant", clientId }); return json(res, 400, { error: "invalid_grant" }); }
      const now = Math.floor(Date.now() / 1000);
      const accessToken = `ya29.${randomUUID()}`;
      tokens.set(accessToken, user);
      const idToken = signJwt({ iss: "https://accounts.google.com", aud: CLIENT_ID, azp: CLIENT_ID, sub: user.sub, email: user.email, email_verified: true, name: user.name, picture: user.picture, iat: now, exp: now + 3600, ...(c.nonce ? { nonce: c.nonce } : {}) });
      log({ issuedTokenFor: user.email });
      return json(res, 200, { access_token: accessToken, expires_in: 3599, token_type: "Bearer", scope: "openid email profile", id_token: idToken });
    }
    if (url.pathname === "/userinfo/v2/me" || url.pathname === "/v1/userinfo" || url.pathname === "/oauth2/v3/userinfo") {
      const user = tokens.get((req.headers.authorization || "").replace(/^Bearer /, ""));
      if (!user) return json(res, 401, { error: "invalid_token" });
      return json(res, 200, { id: user.sub, sub: user.sub, email: user.email, verified_email: true, email_verified: true, name: user.name, picture: user.picture, given_name: user.name.split(" ")[0] });
    }
    json(res, 404, { error: "not_found", path: url.pathname });
  });
};
const tls = https.createServer({ key: readFileSync(dir + "leaf.key"), cert: readFileSync(dir + "leaf.pem") }, app).listen(54341, "127.0.0.1");
const ALLOWED = /(^|\.)(google\.com|googleapis\.com)$/;
const proxy = http.createServer((req, res) => { res.writeHead(405).end("CONNECT only"); });
proxy.on("connect", (req, client, head) => {
  const [host] = req.url.split(":");
  if (!ALLOWED.test(host)) { log({ refusedConnect: req.url }); client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
  const upstream = net.connect(54341, "127.0.0.1", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.write(head);
    upstream.pipe(client); client.pipe(upstream);
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
});
proxy.listen(54340, "127.0.0.1", () => console.log("fake google: proxy 54340, tls 54341"));
