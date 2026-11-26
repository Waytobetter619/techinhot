// 关注提醒（docs/subscriptions.md）：按主题、分类、信源、关键词定一条规则，命中的新动态推到你自己的飞书群、企业微信群或微信。
// 条件和公开的订阅地址同一套（publication/watch.ts），一条规则推的就是它的订阅地址列的。
import { SITE } from "@techinhot/site";
import { useState } from "react";
import type { Route } from "./+types/watch";
import type { AdminWatchChannel, AdminWatchFilter, AdminWatchInput, AdminWatchOverview, AdminWatchPreview, AdminWatchRule } from "@techinhot/contracts/admin";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { ago, bj, num } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, DataTable, Empty, Field, Input } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<AdminWatchOverview>(request, "/api/admin/watch");
}

export const meta: Route.MetaFunction = () => [{ title: `关注提醒 · ${SITE.name} 后台` }];

const EMPTY: AdminWatchInput = { name: "", filter: { topics: [], categories: [], sources: [], q: null, level: "selected" }, channels: [], mode: "instant", enabled: true };

const STATUS: Record<string, { tone: "ok" | "bad" | "warn" | "muted"; label: string }> = {
  sent: { tone: "ok", label: "已送达" },
  failed: { tone: "bad", label: "被拒绝" },
  unknown: { tone: "warn", label: "未确认" },
  skipped: { tone: "muted", label: "未发出" },
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-ui-caption-lg ${on ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-3 hover:text-ink"}`}>
      {children}
    </button>
  );
}

function filterText(f: AdminWatchFilter, o: AdminWatchOverview): string {
  const topic = (slug: string) => o.topics.find((t) => t.slug === slug)?.name ?? slug;
  const category = (key: string) => o.categories.find((c) => c.key === key)?.label ?? key;
  return [
    ...f.topics.map(topic),
    ...f.categories.map(category),
    ...(f.sources.length ? [`信源 ${f.sources.join("、")}`] : []),
    ...(f.q ? [`含“${f.q}”`] : []),
    f.level === "all" ? "全部动态" : "精选",
  ].join(" · ");
}

function RuleForm({ o, initial, id, onDone }: { o: AdminWatchOverview; initial: AdminWatchInput; id: number | null; onDone: () => void }) {
  const { run, pending } = useAdminAction();
  const [v, setV] = useState<AdminWatchInput>(initial);
  const [sources, setSources] = useState(initial.filter.sources.join(", "));
  const [preview, setPreview] = useState<AdminWatchPreview | null>(null);
  const filter = (): AdminWatchFilter => ({ ...v.filter, sources: sources.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean), q: v.filter.q?.trim() || null });
  const setFilter = (f: Partial<AdminWatchFilter>) => setV({ ...v, filter: { ...v.filter, ...f } });
  return (
    <div className="space-y-4">
      <Field label="名称"><Input value={v.name} maxLength={60} placeholder="例如：英伟达与出口管制" onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      {o.groups.map((g) => (
        <Field key={g.key} label={g.name}>
          <div className="flex flex-wrap gap-1.5">
            {o.topics.filter((t) => t.group === g.key).map((t) => (
              <Chip key={t.slug} on={v.filter.topics.includes(t.slug)} onClick={() => setFilter({ topics: toggle(v.filter.topics, t.slug) })}>{t.name}</Chip>
            ))}
          </div>
        </Field>
      ))}
      <Field label="分类">
        <div className="flex flex-wrap gap-1.5">
          {o.categories.map((c) => <Chip key={c.key} on={v.filter.categories.includes(c.key)} onClick={() => setFilter({ categories: toggle(v.filter.categories, c.key) })}>{c.label}</Chip>)}
        </div>
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="关键词" hint="空格分开的词要同时出现"><Input value={v.filter.q ?? ""} maxLength={80} onChange={(e) => setFilter({ q: e.target.value })} /></Field>
        <Field label="信源 ID" hint="后台“信源”页里的 ID，逗号分开；不填即不限"><Input value={sources} onChange={(e) => setSources(e.target.value)} /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="范围">
          <div className="flex gap-1.5">
            <Chip on={v.filter.level === "selected"} onClick={() => setFilter({ level: "selected" })}>只要精选</Chip>
            <Chip on={v.filter.level === "all"} onClick={() => setFilter({ level: "all" })}>全部动态</Chip>
          </div>
        </Field>
        <Field label="频率">
          <div className="flex gap-1.5">
            <Chip on={v.mode === "instant"} onClick={() => setV({ ...v, mode: "instant" })}>有新动态就推（5 分钟内）</Chip>
            <Chip on={v.mode === "daily"} onClick={() => setV({ ...v, mode: "daily" })}>每天 8:07 汇总</Chip>
          </div>
        </Field>
        <Field label="推到">
          <div className="flex flex-wrap gap-1.5">
            {o.channels.map((c) => (
              <Chip key={c.key} on={v.channels.includes(c.key)} onClick={() => setV({ ...v, channels: toggle(v.channels, c.key as AdminWatchChannel) })}>
                {c.name}{c.configured ? "" : "（未配置）"}
              </Chip>
            ))}
          </div>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button busy={pending === "preview"} onClick={async () => setPreview(await run<AdminWatchPreview>("POST", "/api/admin/watch/preview", { filter: filter() }, { label: "preview", revalidate: false }))}>预览命中</Button>
        <Button tone="primary" busy={pending === "save"}
          onClick={async () => {
            const body = { ...v, filter: filter() };
            const done = id === null
              ? await run<{ primed: number }>("POST", "/api/admin/watch", body, { label: "save", success: "已保存：现在已符合条件的不会推送，之后的新动态才推" })
              : await run<{ primed: number }>("PUT", `/api/admin/watch/${id}`, body, { label: "save", success: "已保存" });
            if (done) onDone();
          }}>保存</Button>
        <Button onClick={onDone}>取消</Button>
      </div>
      {preview && (
        <div className="rounded-card bg-surface-2 p-3">
          <div className="text-ui-caption-lg text-ink-3">最近 7 天命中 {preview.items.length === 10 ? "10+" : preview.items.length} 条 · 订阅地址 <span className="break-all font-mono">{preview.feedUrl}</span></div>
          {preview.items.length ? (
            <ul className="mt-2 space-y-1">
              {preview.items.map((i) => <li key={i.id} className="text-ui-label"><a className="text-ink hover:underline" href={i.url} target="_blank" rel="noopener">{i.title}</a> <span className="text-ink-4">{i.source} · {bj(i.published_at)}</span></li>)}
            </ul>
          ) : <div className="mt-2 text-ui-label text-ink-4">没有命中：放宽条件，或把范围改成“全部动态”。</div>}
        </div>
      )}
    </div>
  );
}

function RuleActions({ r, onEdit }: { r: AdminWatchRule; onEdit: () => void }) {
  const { run, pending } = useAdminAction();
  const input = { name: r.name, filter: r.filter, channels: r.channels, mode: r.mode, enabled: !r.enabled };
  return (
    <div className="flex justify-end gap-1.5">
      <Button size="sm" onClick={onEdit}>编辑</Button>
      <Button size="sm" busy={pending === `test-${r.id}`} onClick={() => run("POST", `/api/admin/watch/${r.id}/test`, undefined, { label: `test-${r.id}`, success: "测试已发出，看看各渠道是否收到" })}>发一条测试</Button>
      <Button size="sm" busy={pending === `toggle-${r.id}`} onClick={() => run("PUT", `/api/admin/watch/${r.id}`, input, { label: `toggle-${r.id}`, success: r.enabled ? "已暂停" : "已恢复" })}>{r.enabled ? "暂停" : "恢复"}</Button>
      <Button size="sm" tone="danger" busy={pending === `del-${r.id}`}
        onClick={() => { if (window.confirm(`删除“${r.name}”？推送记录一起删除。`)) void run("DELETE", `/api/admin/watch/${r.id}`, undefined, { label: `del-${r.id}`, success: "已删除" }); }}>删除</Button>
    </div>
  );
}

export default function WatchAdmin({ loaderData: o }: Route.ComponentProps) {
  const [editing, setEditing] = useState<{ id: number | null; initial: AdminWatchInput } | null>(null);
  return (
    <AdminPage
      title="关注提醒"
      subtitle="命中条件的新动态推给你自己。条件和前台“按条件订阅”是同一套，规则右侧的订阅地址也能放进 RSS 阅读器。"
      actions={!editing && <Button tone="primary" onClick={() => setEditing({ id: null, initial: EMPTY })}>新建规则</Button>}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {o.pushEnabled ? <Badge tone="ok">推送已开启</Badge> : <Badge tone="warn" title="在 .env 里设 WATCH_PUSH_ENABLED=true 后重启 worker">推送未开启：照常匹配，推送记为“未发出”</Badge>}
        {o.channels.map((c) => <Badge key={c.key} tone={c.configured ? "ok" : "muted"}>{c.name}{c.configured ? " 已配置" : " 未配置"}</Badge>)}
      </div>
      {editing && (
        <Card className="mb-5" title={editing.id === null ? "新建规则" : "编辑规则"}>
          <RuleForm key={editing.id ?? "new"} o={o} id={editing.id} initial={editing.initial} onDone={() => setEditing(null)} />
        </Card>
      )}
      <Card pad={false}>
        {o.rules.length ? (
          <DataTable
            rows={o.rules}
            rowKey={(r) => r.id}
            columns={[
              { key: "n", label: "规则", render: (r) => (
                <div>
                  <div className="font-medium text-ink">{r.name} {!r.enabled && <Badge>已暂停</Badge>}</div>
                  <div className="text-ui-caption-lg text-ink-3">{filterText(r.filter, o)}</div>
                  <a className="break-all font-mono text-ui-caption-md text-ink-4 hover:underline" href={r.feedUrl} target="_blank" rel="noopener">{r.feedUrl}</a>
                </div>
              ) },
              { key: "m", label: "频率与渠道", render: (r) => <div className="text-ui-caption-lg text-ink-2">{r.mode === "daily" ? "每日汇总" : "即时"}<div className="text-ink-4">{r.channels.map((c) => o.channels.find((x) => x.key === c)?.name ?? c).join("、")}</div></div> },
              { key: "p", label: "最近推送", render: (r) => r.lastPush ? (
                <div className="text-ui-caption-lg">
                  <Badge tone={STATUS[r.lastPush.status]!.tone} title={r.lastPush.response ?? undefined}>{STATUS[r.lastPush.status]!.label}</Badge>
                  <div className="mt-0.5 text-ink-4">{ago(r.lastPush.pushed_at)} · {r.lastPush.items} 条 · 7 天送达 {num(r.pushes7d)} 次</div>
                </div>
              ) : <span className="text-ui-caption-lg text-ink-4">{r.checked_at ? `暂无新动态（${ago(r.checked_at)}检查过）` : "等待第一次检查"}</span> },
              { key: "a", label: "", align: "right", render: (r) => <RuleActions r={r} onEdit={() => setEditing({ id: r.id, initial: { name: r.name, filter: r.filter, channels: r.channels, mode: r.mode, enabled: r.enabled } })} /> },
            ]}
          />
        ) : <Empty>还没有规则。新建一条：比如主题选“出口管制与制裁”，推到飞书群。</Empty>}
      </Card>
    </AdminPage>
  );
}
