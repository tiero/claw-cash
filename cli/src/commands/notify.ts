import type { ParsedArgs } from "minimist";
import { loadConfig, saveConfig } from "../config.js";

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { username?: string; first_name?: string };
    text?: string;
  };
}

interface GetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

export async function handleNotify(argv: ParsedArgs): Promise<void> {
  const sub = argv._[1] as string | undefined;
  const subsub = argv._[2] as string | undefined;

  if (sub === "telegram" && subsub === "setup") {
    await telegramSetup(argv);
    return;
  }

  console.log(JSON.stringify({ error: "Usage: cash notify telegram setup [--bot-token <token>]" }));
  process.exit(1);
}

async function telegramSetup(argv: ParsedArgs): Promise<void> {
  const config = loadConfig();

  const botToken = (argv["bot-token"] as string | undefined) ?? config.telegramBotToken;
  if (!botToken) {
    console.log(JSON.stringify({ error: "Missing --bot-token. Provide your Telegram bot token." }));
    process.exit(1);
  }

  // Save bot token immediately
  config.telegramBotToken = botToken;
  saveConfig(config);

  console.error(`[notify] Bot token saved. Send any message to your bot now...`);
  console.error(`[notify] Waiting up to 60s for first message...`);

  const chatId = await waitForFirstMessage(botToken, 60_000);
  if (chatId === null) {
    console.log(JSON.stringify({ error: "Timed out waiting for Telegram message. Run setup again." }));
    process.exit(1);
  }

  config.telegramChatId = chatId;
  saveConfig(config);

  // Send confirmation
  await sendTelegramMessage(botToken, chatId, "Connected! You will receive notifications here when Bitcoin arrives.");

  console.log(JSON.stringify({ ok: true, chatId, message: "Telegram notifications configured." }));
}

async function waitForFirstMessage(botToken: string, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  let offset = 0;

  // Drain existing updates so we only react to new ones
  const drain = await fetchUpdates(botToken, 0, 0);
  if (drain.ok && drain.result.length > 0) {
    offset = drain.result[drain.result.length - 1].update_id + 1;
  }

  while (Date.now() < deadline) {
    const remaining = Math.min(30, Math.floor((deadline - Date.now()) / 1000));
    if (remaining <= 0) break;

    const data = await fetchUpdates(botToken, offset, remaining);
    if (!data.ok) {
      console.error(`[notify] getUpdates error — check your bot token`);
      return null;
    }

    for (const update of data.result) {
      offset = update.update_id + 1;
      if (update.message?.chat?.id) {
        return update.message.chat.id;
      }
    }
  }

  return null;
}

async function fetchUpdates(botToken: string, offset: number, timeout: number): Promise<GetUpdatesResponse> {
  const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=${timeout}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout((timeout + 5) * 1000) });
    return (await res.json()) as GetUpdatesResponse;
  } catch {
    return { ok: false, result: [] };
  }
}

export async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<void> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      console.error(`[notify] telegram sendMessage failed: ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[notify] telegram sendMessage error: ${err}`);
  }
}
