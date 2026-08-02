import type { Agent } from 'node:http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

/**
 * Telegram-only outbound proxy.
 *
 * On censored networks `api.telegram.org` is unreachable while everything else
 * (including the Cloudflare Tunnel that serves the Mini App) works fine. A
 * system-wide VPN fixes Telegram but breaks the tunnel, so instead we route
 * *only* the Bot API traffic through a proxy and leave the rest untouched.
 */

/** Builds the agent grammY should use, or `undefined` for a direct connection. */
export function createTelegramProxyAgent(proxyUrl: string | undefined): Agent | undefined {
  if (!proxyUrl) return undefined;
  const scheme = safeProtocol(proxyUrl);
  if (!scheme) return undefined;
  return scheme.startsWith('socks')
    ? (new SocksProxyAgent(proxyUrl) as unknown as Agent)
    : (new HttpsProxyAgent(proxyUrl) as unknown as Agent);
}

function safeProtocol(url: string): string | undefined {
  try {
    return new URL(url).protocol.replace(':', '');
  } catch {
    return undefined;
  }
}

/** Hides credentials so a proxy URL can be printed in startup logs. */
export function describeProxy(proxyUrl: string | undefined): string {
  if (!proxyUrl) return 'direct connection';
  try {
    const parsed = new URL(proxyUrl);
    const auth = parsed.username ? '***@' : '';
    return `${parsed.protocol}//${auth}${parsed.host}`;
  } catch {
    return 'invalid proxy';
  }
}
