import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { createRoom } from '../game/room-service.js';
import { sanitizeDisplayName } from '../sanitize.js';
import { createTelegramProxyAgent, describeProxy } from './proxy.js';

/** Telegram bot commands. Optional: the game API runs fine without it. */

/** Builds a Mini App URL that also tells the client which API to talk to. */
export function buildWebAppUrl(params: Record<string, string> = {}): string {
  const url = new URL(config.webAppUrl);
  url.searchParams.set('api', config.publicApiUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * grammY client options for the configured network path. Exported so tests can
 * assert that a configured proxy really reaches the Bot API client instead of
 * being silently dropped.
 */
export function telegramClientOptions(proxyUrl = config.telegramProxyUrl) {
  const agent = createTelegramProxyAgent(proxyUrl);
  return { baseFetchConfig: agent ? { agent } : {} };
}

export async function startTelegramBot(): Promise<void> {
  if (!config.botToken) {
    console.log('TELEGRAM_BOT_TOKEN is empty; bot is disabled in local mode.');
    return;
  }

  console.log(`Telegram bot network: ${describeProxy(config.telegramProxyUrl)}.`);
  const bot = new Bot(config.botToken, { client: telegramClientOptions() });
  await bot.api.setMyCommands([
    { command: 'start', description: 'شروع و باز کردن مینی‌اپ حکم' },
    { command: 'newgame', description: 'ساخت میز جدید حکم' },
  ]);

  bot.command('start', async (ctx) => {
    await ctx.reply(
      'به حکم خوش اومدی 👑\nاز دکمه زیر می‌تونی وارد مینی‌اپ بشی و میز بسازی یا به دوستات وصل شی.',
      { reply_markup: new InlineKeyboard().webApp('ورود به مینی‌اپ', buildWebAppUrl()) },
    );
  });

  bot.command('newgame', async (ctx) => {
    const room = createRoom(sanitizeDisplayName(ctx.from?.first_name), ctx.from?.id);
    const appUrl = buildWebAppUrl({ room: room.id });
    await ctx.reply(`میزت آماده‌ست: ${room.code}\nلینک ورود: ${appUrl}`, {
      reply_markup: new InlineKeyboard().webApp('باز کردن میز', appUrl),
    });
  });

  bot.catch((err) => console.error('Telegram bot error:', err));
  await bot.api.deleteWebhook({ drop_pending_updates: true });
  await bot.start();
}
