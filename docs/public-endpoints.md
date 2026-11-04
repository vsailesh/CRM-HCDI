# Public (unauthenticated) endpoints

Three kinds of traffic reach the app without a login. Each is rate limited and audited.

| Path | Purpose | Protection |
|---|---|---|
| `POST /api/webhook/lead` (+ `GET` for a token, `OPTIONS` for CORS) | Website lead form | signature **or** form token, validation, size cap, honeypot, rate limits |
| `GET /r/{code}` | QR short links | code-format check, lookup + miss throttling, capped scan counting, http(s)-only redirects |
| `POST /api/auth/login`, `/api/auth/mfa/verify` | Sign-in | per-IP throttle on top of per-account lockout |

## Environment variables (production)

| Variable | Required | Meaning |
|---|---|---|
| `VFV_DATA_KEY` | yes | Master key. Also derives the form-token key. |
| `VFV_TRUST_PROXY=1` | yes, behind a proxy | Trust `X-Forwarded-For`. The proxy **must overwrite** it with the real client address; otherwise callers can forge IPs. Without it, per-IP limits collapse into one shared bucket and only the global caps apply, and the audit log records no IP. |
| `VFV_WEBHOOK_SECRET` | for server-to-server leads | Shared HMAC secret. |
| `VFV_WEBHOOK_ORIGINS` | for forms on another domain | Comma-separated allowed origins, e.g. `https://www.example.com`. |
| `VFV_WEBHOOK_REQUIRE_AUTH=true` | optional | Require signature/token outside production too. Always on when `NODE_ENV=production`. |

## Lead form: browser

```html
<form id="lead">
  <input name="name" required><input name="phone" required><input name="email" type="email">
  <textarea name="message"></textarea>
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px"> <!-- honeypot -->
</form>
<script>
  const API = "https://crm.example.com/api/webhook/lead";
  let token;
  fetch(API).then(r => r.json()).then(j => token = j.data.token);   // load when the page opens
  document.getElementById("lead").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" },
                                   body: JSON.stringify({ ...body, formToken: token }) });
  });
</script>
```

A token is valid 3 seconds to 1 hour after it is issued and works once. Fetch a fresh one after each submit.

## Lead form: your server (signed)

```js
const body = JSON.stringify({ name, phone, email, message });
const ts = Math.floor(Date.now() / 1000).toString();
const sig = crypto.createHmac("sha256", process.env.VFV_WEBHOOK_SECRET).update(`${ts}.${body}`).digest("hex");
await fetch("https://crm.example.com/api/webhook/lead", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-vfv-timestamp": ts, "x-vfv-signature": sig },
  body,
});
```

Timestamps must be within 5 minutes; each signature is accepted once.

## Behaviour to know

* Responses never say whether a phone number already exists.
* Rejected requests are written to the audit log (`webhook.lead`, outcome `denied`), at most one line per IP per minute.
* Limits are per server instance and held in memory. With several instances, also rate-limit at the load balancer or WAF.
* Replay memory for tokens and signatures is per process and resets on restart.
* A retried request must be signed again with a fresh timestamp: an identical timestamp and body produces the same signature, which is rejected as a replay.
