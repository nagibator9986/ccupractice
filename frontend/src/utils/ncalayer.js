/**
 * Thin wrapper around the NCALayer WebSocket API
 * (kz.gov.pki.knca.basics, recommended in SDK 2.0 README).
 *
 * NCALayer is a desktop application provided by the Kazakh National
 * Certifying Authority (NCA). It exposes a local WebSocket server on
 * ws://127.0.0.1:13579 (or wss://127.0.0.1:13579 if NCALayer is set up
 * with TLS). The frontend sends a JSON-RPC-style "signXmlByKeyInfo" or
 * "createCMSSignatureFromBase64" message and receives the CMS payload.
 *
 * The user must have NCALayer installed and running; otherwise we
 * return a descriptive error so the UI can guide them.
 */

const NCALAYER_URLS = ["wss://127.0.0.1:13579/", "ws://127.0.0.1:13579/"];
const STORAGE_KEYS = ["PKCS12", "AKKZIDCARD", "AKKZTOKEN"];

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
      try {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
          try {
            ws.close();
          } catch {}
          lastError = new Error(`Timeout NCALayer at ${url}`);
          tryNext();
        }, 4000);
        ws.onopen = () => {
          clearTimeout(timer);
          resolve(ws);
        };
        ws.onerror = (e) => {
          clearTimeout(timer);
          lastError = new Error(`NCALayer недоступен по ${url}`);
          try {
            ws.close();
          } catch {}
          tryNext();
        };
      } catch (e) {
        lastError = e;
        tryNext();
      }
    };
    tryNext();
  });
}

/**
 * Sign a base64 payload with the user's signing certificate (RSA/GOST).
 * Returns the CMS (base64) ready to be sent to backend.
 */
export async function signBase64WithNCALayer(payloadBase64, { attachData = true } = {}) {
  const ws = await openSocket();
  return new Promise((resolve, reject) => {
    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        ws.close();
        reject(new Error("Некорректный ответ от NCALayer"));
        return;
      }
      // Common response shape from kz.gov.pki.knca.basics
      if (data?.status === false || data?.result === false) {
        ws.close();
        reject(new Error(data?.message || "NCALayer отклонил запрос или отменено пользователем"));
        return;
      }
      const cms =
        data?.responseObject ||
        data?.result?.cms ||
        data?.body?.result?.[0] ||
        data?.body?.result ||
        data?.result;
      ws.close();
      if (typeof cms === "string" && cms.length > 64) {
        resolve(cms);
      } else {
        reject(new Error("NCALayer не вернул CMS-подпись"));
      }
    };
    ws.onerror = () => reject(new Error("Ошибка WebSocket NCALayer"));

    const request = {
      module: "kz.gov.pki.knca.basics",
      method: "sign",
      args: {
        allowedStorages: STORAGE_KEYS,
        format: "cms",
        data: payloadBase64,
        signingParams: { decode: "base64", encapsulate: attachData, digested: false, tsa: false },
        signerParams: { extKeyUsageOids: ["1.3.6.1.5.5.7.3.2", "1.3.6.1.5.5.7.3.4"] },
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
