// 订阅网址（docs/subscriptions.md）：选主题、分类、关键词和级别，拼出一个 RSS 地址，交给任何阅读器或飞书 RSS 机器人。
// 订阅条件全在地址里，网站不存任何东西；同样的条件也能在后台“关注提醒”里推到飞书和微信。
import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { SITE } from "@techinhot/site";
import { feedCategoryLabel, PUBLIC_API_CATEGORY_KEYS } from "@techinhot/contracts/taxonomy";
import type { TopicsResponse } from "@techinhot/contracts/site";
import { apiGet, cachedPage } from "../lib/api.server";
import { pageMeta, siteUrl } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { IconCopy, IconRss } from "../components/icons";
import { L } from "../lib/i18n";

export const handle: Screen = { tab: "me", name: L("订阅", "Subscribe") };
export { pageHeaders as headers } from "../lib/api.server";

const BACK = { to: "/more", label: L("我的", "Me") };

export async function loader({ request }: { request: Request }) {
  const { groups, topics } = await apiGet<TopicsResponse>("/api/site/topics", { signal: request.signal });
  return cachedPage(300, { groups: groups.map(({ key, name }) => ({ key, name })), topics: topics.map(({ slug, name, group }) => ({ slug, name, group })) });
}

export function meta() {
  return pageMeta({ locale: "zh", title: "按条件订阅", description: `按主题、分类和关键词组装 ${SITE.name} 的 RSS 订阅地址，放进阅读器或飞书机器人。`, path: "/watch" });
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-ui-label transition-colors ${on ? "border-accent bg-accent/10 text-ink" : "border-line bg-surface text-ink-3 hover:text-ink"}`;

export default function WatchPage() {
  const { groups, topics } = useLoaderData<typeof loader>();
  const [picked, setPicked] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<"selected" | "all">("selected");
  const [copied, setCopied] = useState(false);

  const address = useMemo(() => {
    const p = new URLSearchParams();
    for (const v of [...picked].sort()) p.append("topic", v);
    for (const v of [...categories].sort()) p.append("category", v);
    if (q.trim()) p.set("q", q.trim());
    if (level === "all") p.set("level", "all");
    const query = p.toString();
    return query ? `${siteUrl()}/feed/watch.xml?${query}` : null;
  }, [picked, categories, q, level]);

  return (
    <div className="pb-10">
      <PhoneBar back={BACK} title="订阅" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 data-page-title="" className="text-ui-heading-lg font-semibold leading-[1.3] text-ink">按条件订阅</h1>
        <p className="mt-1.5 text-ui-label leading-relaxed text-ink-3">
          选你关心的主题、分类或关键词，得到一个 RSS 地址。条件全写在地址里，不用注册；放进 RSS 阅读器，或者飞书群的 RSS 机器人。同一类里多选是“任一”，不同类之间是“同时满足”。
        </p>
      </header>

      {groups.map((g) => (
        <section key={g.key} className="pt-6">
          <h2 className="text-ui-body font-bold text-ink">{g.name}</h2>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {topics.filter((t) => t.group === g.key).map((t) => (
              <button key={t.slug} type="button" aria-pressed={picked.includes(t.slug)} className={chip(picked.includes(t.slug))} onClick={() => setPicked(toggle(picked, t.slug))}>
                {t.name}
              </button>
            ))}
          </div>
        </section>
      ))}

      <section className="pt-6">
        <h2 className="text-ui-body font-bold text-ink">分类</h2>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {PUBLIC_API_CATEGORY_KEYS.map((c) => (
            <button key={c} type="button" aria-pressed={categories.includes(c)} className={chip(categories.includes(c))} onClick={() => setCategories(toggle(categories, c))}>
              {feedCategoryLabel(c)}
            </button>
          ))}
        </div>
      </section>

      <section className="pt-6">
        <h2 className="text-ui-body font-bold text-ink">关键词</h2>
        <input
          value={q}
          maxLength={80}
          onChange={(e) => setQ(e.target.value)}
          placeholder="例如：英伟达 出口管制（空格分开的词要同时出现）"
          className="mt-2.5 w-full rounded-card border border-line bg-surface px-3 py-2 text-ui-label text-ink placeholder:text-ink-4"
        />
      </section>

      <section className="pt-6">
        <h2 className="text-ui-body font-bold text-ink">范围</h2>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" aria-pressed={level === "selected"} className={chip(level === "selected")} onClick={() => setLevel("selected")}>只要精选</button>
          <button type="button" aria-pressed={level === "all"} className={chip(level === "all")} onClick={() => setLevel("all")}>全部动态</button>
        </div>
      </section>

      <section className="card mt-8 p-4">
        <div className="flex items-center gap-2 text-ui-label font-semibold text-ink"><IconRss size={18} /> 订阅地址</div>
        {address ? (
          <>
            <code className="mt-2 block break-all rounded-card bg-surface-2 px-3 py-2 font-mono text-ui-caption-lg text-ink-2">{address}</code>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-ui-label font-medium text-surface"
                onClick={async () => {
                  await navigator.clipboard.writeText(address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                <IconCopy size={15} /> {copied ? "已复制" : "复制地址"}
              </button>
              <a href={address} target="_blank" rel="noopener" className="inline-flex items-center rounded-full border border-line px-3.5 py-1.5 text-ui-label text-ink-2 hover:text-ink">预览</a>
            </div>
            <p className="mt-3 text-ui-caption-lg leading-relaxed text-ink-4">只列最近 7 天的 50 条；阅读器每隔一段时间来取一次，新的会自动出现。</p>
          </>
        ) : (
          <p className="mt-2 text-ui-label text-ink-4">至少选一个主题、分类或填一个关键词。想要全部精选，直接订阅 <a className="underline" href="/feed.xml">/feed.xml</a>。</p>
        )}
      </section>
    </div>
  );
}
