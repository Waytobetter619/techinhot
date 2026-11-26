// The owner's alert channels (docs/subscriptions.md): a Feishu group bot, a WeCom (企业微信) group bot, and
// Server酱, which reaches the owner's own WeChat. Their addresses are secrets, read by name. Nothing leaves while
// WATCH_PUSH_ENABLED is off: the push is recorded as skipped.
import { config, credential } from "../config.ts";
import { sendWebhook } from "../notify/feishu.ts";

export const WATCH_CHANNELS = ["feishu", "wecom", "serverchan"] as const;
export type WatchChannel = (typeof WATCH_CHANNELS)[number];

export const CHANNEL_NAMES: Record<WatchChannel, string> = { feishu: "飞书群", wecom: "企业微信群", serverchan: "微信（Server酱）" };

const ADDRESS: Record<WatchChannel, string> = {
  feishu: "WATCH_FEISHU_WEBHOOK_URL",
  wecom: "WATCH_WECOM_WEBHOOK_URL",
  serverchan: "WATCH_SERVERCHAN_SENDKEY",
};

export const channelConfigured = (channel: WatchChannel): boolean => credential("integrations", ADDRESS[channel]) !== null;

export interface Alert {
  title: string;
  lines: Array<{ title: string; url: string; meta: string }>;
  /** Matches left out of the message (a channel's length limit, or more than an alert lists). */
  more: number;
}

export interface PushResult {
  status: "sent" | "failed" | "unknown" | "skipped";
  response: string;
}

/** Square brackets in a headline would end its Markdown link early. */
const linkText = (s: string) => s.replace(/\[/g, "【").replace(/\]/g, "】");

function markdown(alert: Alert, maxBytes: number): string {
  const out: string[] = [];
  let more = alert.more;
  for (const [i, l] of alert.lines.entries()) {
    const line = `${i + 1}. [${linkText(l.title)}](${l.url})\n   ${l.meta}`;
    if (Buffer.byteLength([...out, line].join("\n"), "utf8") > maxBytes) {
      more += alert.lines.length - i;
      break;
    }
    out.push(line);
  }
  if (more > 0) out.push(`另有 ${more} 条，打开订阅地址看全部。`);
  return out.join("\n");
}

/** Server酱 limits a title to 32 characters. */
const shortTitle = (s: string) => (s.length > 32 ? `${s.slice(0, 31)}…` : s);

export async function pushAlert(channel: WatchChannel, alert: Alert): Promise<PushResult> {
  if (!config.watchPushEnabled) return { status: "skipped", response: "WATCH_PUSH_ENABLED is off" };
  const address = credential("integrations", ADDRESS[channel]);
  if (!address) return { status: "skipped", response: `${ADDRESS[channel]} is not set` };
  try {
    if (channel === "feishu") {
      return await sendWebhook(address, {
        msg_type: "interactive",
        card: {
          header: { template: "blue", title: { tag: "plain_text", content: alert.title } },
          elements: [{ tag: "markdown", content: markdown(alert, 20_000) }],
        },
      });
    }
    if (channel === "wecom") {
      // A WeCom bot's Markdown message is at most 4096 bytes.
      const body = markdown(alert, 3_800);
      return await sendWebhook(address, { msgtype: "markdown", markdown: { content: `**${alert.title}**\n${body}` } }, (json) => json?.errcode);
    }
    return await sendWebhook(`https://sctapi.ftqq.com/${encodeURIComponent(address)}.send`, { title: shortTitle(alert.title), desp: markdown(alert, 20_000) }, (json) => json?.code);
  } catch (error) {
    // The request may or may not have reached the channel: unknown, never retried.
    return { status: "unknown", response: String(error).slice(0, 500) };
  }
}
