// 一次性：把因「模型调用关闭」而判失败的文章放回处理队列。
// 用框架自己的 requeueFailed（后台「运行」页同款）：状态改回待处理、重试次数清零、头 500 篇立即排队，其余由定时清扫接手。
// 只动这一类失败；其他原因失败的文章不碰。跑法（在 techinhot 目录）：node --env-file=.env scripts/requeue-model-off.ts [--dry]
import { requeueFailed } from "../packages/backend/src/jobs/content.ts";
import { closeDb, sql } from "../packages/backend/src/db.ts";

const GROUP = "Model calls are disabled (MODEL_CALLS_ENABLED=false)";
const dry = process.argv.includes("--dry");

async function counts() {
  const [row] = await sql<{ failed_total: number; failed_this_group: number; waiting: number }[]>`
    SELECT count(*) FILTER (WHERE processing_state = 'failed')::int AS failed_total,
           count(*) FILTER (WHERE processing_state = 'failed' AND processing_error = ${GROUP})::int AS failed_this_group,
           count(*) FILTER (WHERE processing_state = 'new' AND processing_attempts = 0 AND discovered_at <= '2026-11-10')::int AS waiting
    FROM articles`;
  return row!;
}

const before = await counts();
console.log(`复位前：失败共 ${before.failed_total} 篇，其中因「模型调用关闭」失败 ${before.failed_this_group} 篇`);
if (dry) {
  console.log("试运行：不改动任何数据");
} else {
  const { requeued } = await requeueFailed(GROUP);
  const after = await counts();
  console.log(`已放回处理队列：${requeued} 篇`);
  console.log(`复位后：失败共 ${after.failed_total} 篇（其中本类 ${after.failed_this_group}），11-10 前入库且等待处理 ${after.waiting} 篇`);
}
await closeDb();
process.exit(0);
