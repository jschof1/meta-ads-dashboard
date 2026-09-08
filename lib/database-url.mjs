import { expandConfig } from "@libsql/core/config";
import { encodeBaseUrl, parseUri } from "@libsql/core/uri";

/** Shared by the production runtime and privileged database commands. No I/O.
 * @param {string} value
 * @returns {boolean}
 */
export function isSecureRemoteDatabaseUrl(value) {
  try {
    // Use the driver's decoded query pairs, not URLSearchParams.get(): libSQL
    // accepts repeated parameters and lets the last value win. Our policy
    // rejects every duplicate, including tls=1&tls=1 and encoded key aliases.
    const uri = parseUri(value);
    if (!["libsql", "https"].includes(uri.scheme.toLowerCase())) return false;
    const tlsParameters = uri.query?.pairs.filter(({ key }) => key === "tls") ?? [];
    if (tlsParameters.length > 1 || tlsParameters.some(({ value }) => value !== "1")) return false;
    const config = expandConfig({ url: value }, true);
    if (config.scheme !== "https" || config.tls !== true || !config.authority?.host || config.authority.userinfo) return false;
    // Match the HTTP adapter's final URL validation as well as its TLS choice.
    return Boolean(encodeBaseUrl(config.scheme, config.authority, config.path).hostname);
  } catch {
    // Parser errors can contain the input URL. Return only a safe status.
    return false;
  }
}
