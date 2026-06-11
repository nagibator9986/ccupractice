/**
 * Wrapper around the NCALayer WebSocket API (`kz.gov.pki.knca.basics`).
 *
 * NCALayer is the desktop app provided by НУЦ РК. It exposes a local
 * WebSocket server on `wss://127.0.0.1:13579` (newer builds) or
 * `ws://127.0.0.1:13579` (legacy). We try both.
 *
 * Response envelopes seen across NCALayer versions:
 *   { status: true, body: { result: ["MIIK…"] } }      // success — array
 *   { status: true, body: { result: "MIIK…" } }        // success — string
 *   { status: true, responseObject: "MIIK…" }          // older success shape
 *   { status: false, code: "USER_CANCELED", message } // user clicked Cancel
 *   { status: false, message: "..." }                  // generic failure
 */

// On an HTTPS page the browser blocks insecure ws:// as mixed content, so only
// wss:// can ever connect there — probing ws:// would just waste the connect
// timeout and log a console error. On HTTP both are reachable.
const NCALAYER_URLS =
  typeof window !== "undefined" && window.location.protocol === "https:"
    ? ["wss://127.0.0.1:13579/"]
    : ["wss://127.0.0.1:13579/", "ws://127.0.0.1:13579/"];

const CONNECT_TIMEOUT_MS = 4000;
const SIGN_TIMEOUT_MS = 5 * 60 * 1000; // 5 min — covers PIN entry / token confirmation

function openSocket() {
  return new Promise((resolve, reject) => {
    let lastError = null;
    let idx = 0;
    const tryNext = () => {
      if (idx >= NCALAYER_URLS.length) {
        reject(
          new Error(
            lastError?.message ||
              "Не удалось подключиться к NCALayer. Убедитесь, что приложение установлено и запущено.",
          ),
        );
        return;
      }
      const url = NCALAYER_URLS[idx++];
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        lastError = e;
        tryNext();
        return;
      }
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        lastError = new Error(`Timeout NCALayer at ${url}`);
        tryNext();
      }, CONNECT_TIMEOUT_MS);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(ws);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        lastError = new Error(`NCALayer недоступен по ${url}`);
        try { ws.close(); } catch {}
        tryNext();
      };
    };
    tryNext();
  });
}

// A CMS produced by NCALayer is a long, PEM-less base64 blob (starts with "MII…").
function looksLikeCms(s) {
  return (
    typeof s === "string" &&
    s.trim().length > 100 &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(s.trim())
  );
}

function extractCms(data) {
  // 1) Known happy paths first (fast + unambiguous) across NCALayer versions.
  const known = [
    data?.responseObject,
    Array.isArray(data?.body?.result) ? data.body.result[0] : data?.body?.result,
    data?.body?.cms,
    data?.result?.cms,
    Array.isArray(data?.result) ? data.result[0] : null,
    typeof data?.body === "string" ? data.body : null,
    typeof data?.result === "string" ? data.result : null,
    typeof data === "string" ? data : null,
  ];
  for (const c of known) {
    if (looksLikeCms(c)) return c.trim();
  }
  // 2) Fallback: deep-walk the whole response and return the first CMS-looking
  // string anywhere. Robust against envelope shape changes between versions.
  const seen = new Set();
  const stack = [data];
  while (stack.length) {
    const cur = stack.pop();
    if (cur == null) continue;
    if (looksLikeCms(cur)) return cur.trim();
    if (typeof cur === "object") {
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const v of Array.isArray(cur) ? cur : Object.values(cur)) stack.push(v);
    }
  }
  return null;
}

function extractError(data) {
  return (
    data?.message ||
    data?.body?.message ||
    data?.errorMessage ||
    (data?.code ? `NCALayer: ${data.code}` : null) ||
    "NCALayer отклонил запрос"
  );
}

/**
 * Sign a base64 payload with the user's signing certificate (RSA / ECDSA / GOST).
 * Returns the base64-encoded CMS ready to be sent to backend.
 *
 * options.attachData (default true) — wraps the data into the CMS structure.
 * options.signalAbort — AbortSignal to cancel a hanging request.
 */
export async function signBase64WithNCALayer(payloadBase64, options = {}) {
  const { attachData = true, signal } = options;
  const ws = await openSocket();

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(
        "Истекло время ожидания ответа от NCALayer. Откройте приложение и подтвердите подписание."
      ));
    }, SIGN_TIMEOUT_MS);

    if (signal) {
      const onAbort = () => finish(reject, new Error("Подписание отменено"));
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        // Some NCALayer builds may send a non-JSON heartbeat; ignore it and
        // keep waiting for the real result (the timeout is our safety net).
        // eslint-disable-next-line no-console
        console.debug("[NCALayer] non-JSON message ignored:", event.data);
        return;
      }
      // Log the raw envelope so the exact shape is visible if extraction fails.
      // eslint-disable-next-line no-console
      console.log("[NCALayer] response:", data);

      // Explicit failure / user cancel envelope.
      if (data?.status === false || data?.errorCode || data?.errorMessage || data?.code === "USER_CANCELED") {
        return finish(reject, new Error(extractError(data)));
      }
      const cms = extractCms(data);
      if (cms) return finish(resolve, cms);

      // NCALayer pushes a version handshake `{result: {version: "1.4"}}` right
      // after the socket opens, BEFORE the sign dialog. Ignore it and keep
      // waiting — rejecting here would close the socket before the user can
      // enter their PIN and the real CMS could be returned.
      if (data?.result && typeof data.result === "object" && "version" in data.result) {
        // eslint-disable-next-line no-console
        console.debug("[NCALayer] version handshake:", data.result.version, "— waiting for sign result");
        return;
      }

      // No CMS found. Only a genuine FINAL sign envelope (carries `status` or
      // `body`) without a CMS is a real failure; anything else (greeting / ack /
      // heartbeat) is ignored so we keep waiting for the signing result.
      const isFinal =
        data && typeof data === "object" && ("status" in data || "body" in data);
      if (isFinal) {
        // eslint-disable-next-line no-console
        console.warn("[NCALayer] final response without extractable CMS:", data);
        return finish(reject, new Error("NCALayer не вернул CMS-подпись"));
      }
      // eslint-disable-next-line no-console
      console.debug("[NCALayer] intermediate message ignored, waiting for result");
    };
    ws.onerror = () => finish(reject, new Error("Ошибка WebSocket NCALayer"));
    ws.onclose = (ev) => {
      if (!done && ev.code !== 1000) {
        finish(reject, new Error("NCALayer закрыл соединение"));
      }
    };

    // Don't restrict by extKeyUsage — different NCA cert profiles use slightly
    // different EKUs and a wrong filter would hide the user's only signing
    // cert. NCALayer will still show only certs available in the chosen
    // storage. The user picks; we trust their choice and verify on the backend.
    const request = {
      module: "kz.gov.pki.knca.basics",
      method: "sign",
      args: {
        // Omit `allowedStorages` entirely to offer ALL detected storages
        // (PKCS12, ID card, JaCarta, Kaztoken…). Per the canonical
        // kz.gov.pki.knca.basics spec an absent key means "all supported
        // storages"; an empty array [] is unspecified and version-dependent.
        format: "cms",
        data: payloadBase64,
        signingParams: {
          // `decode` MUST be the boolean `true` so NCALayer base64-decodes
          // `data` back to the raw DOCX bytes BEFORE hashing/signing. The
          // backend verifies messageDigest === SHA-256(raw DOCX); a non-boolean
          // value (the previous "base64") is parsed by NCALayer as `false`, so
          // it would sign the base64 STRING and every signature would be
          // rejected as «подпись сделана под другой документ».
          decode: true,
          encapsulate: attachData,
          digested: false,
          // Documented key is `tsaProfile` (null = no timestamp). The backend
          // neither requests nor verifies a TSP token.
          tsaProfile: null,
        },
        // No extKeyUsage filter — let user choose any of their certs.
        signerParams: {},
        locale: "ru",
      },
    };
    ws.send(JSON.stringify(request));
  });
}

export async function pingNCALayer() {
  try {
    const ws = await openSocket();
    ws.close();
    return true;
  } catch {
    return false;
  }
}
