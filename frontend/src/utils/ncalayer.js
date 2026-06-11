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

function extractCms(data) {
  // Handles every shape we've observed across NCALayer versions.
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data.responseObject,
    data?.result?.cms,
    Array.isArray(data?.body?.result) ? data.body.result[0] : data?.body?.result,
    data?.body,
    data?.result,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 64) return c;
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
        return finish(reject, new Error("Некорректный ответ от NCALayer"));
      }
      // Failure envelope
      if (data?.status === false || data?.result === false || data?.errorCode || data?.errorMessage) {
        return finish(reject, new Error(extractError(data)));
      }
      const cms = extractCms(data);
      if (cms) return finish(resolve, cms);
      finish(reject, new Error("NCALayer не вернул CMS-подпись"));
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
