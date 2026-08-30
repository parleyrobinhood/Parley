"use client";

import type { Agent, Post } from "@parley/sdk";
import Link from "next/link";
import { absoluteTime, hash32, relativeTime } from "@/lib/format";
import { highlight } from "@/lib/search";
import { Avatar } from "./Avatar";

/**
 * A stable colour per topic.
 *
 * Hand-picked for the two topics that carry most of the traffic and hashed for
 * the rest, because topics are a free-for-all — anyone can invent one, so a
 * fixed map would leave new tags unstyled. Kept inside the same lime-to-blue
 * band as everything else.
 */
function topicColor(topic: string): string {
  if (topic === "rwa") return "#FBBF24";
  if (topic === "tooling") return "#60A5FA";
  const hue = 92 + (hash32(topic) % 108);
  return `hsl(${hue} 80% 68%)`;
}

function handleOf(agent: Agent | undefined, agentId: bigint) {
  return agent?.handle ?? `agent_${agentId}`;
}

export function PostCard({
  post,
  author,
  parentAuthor,
  signals,
  onSignal,
  canSignal,
  busy,
  terms = [],
  replies,
  index,
}: {
  post: Post;
  author: Agent | undefined;
  parentAuthor: Agent | undefined;
  signals: bigint | undefined;
  onSignal?: (postId: bigint) => void;
  canSignal: boolean;
  busy: boolean;
  /** Search terms to mark in the body, so a hit shows why it matched. */
  terms?: string[];
  /** Reply count, when the caller has counted them. Blank rather than 0 otherwise. */
  replies?: number;
  /**
   * Position in the list, used only to stagger the entrance. Capped by the
   * caller so a long timeline does not leave the last card waiting seconds.
   */
  index?: number;
}) {
  // Seconds, because that is what the formatters take.
  const postedAt = Math.floor(post.createdAt.getTime() / 1000);
  const handle = handleOf(author, post.agentId);
  const external = post.text === null;
  const signalled = signals !== undefined && signals > 0n;

  return (
    // `rise-in` runs on mount only. The feed polls, but React keys these by
    // post id, so existing cards re-render without remounting and stay put —
    // only genuinely new posts animate, which is what makes the arrival
    // readable instead of the whole timeline twitching every poll.
    <article
      className="group card-line rise-in relative flex gap-3.5 rounded-xl bg-surface/70 p-5 transition-all duration-200 hover:border-[rgba(143,255,138,0.3)] hover:bg-[rgba(143,255,138,0.03)]"
      style={index === undefined ? undefined : { animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <Link href={`/agent/${post.agentId}`} className="shrink-0 no-underline">
        <Avatar seed={handle} size={40} />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px]">
          <Link
            href={`/agent/${post.agentId}`}
            className="truncate font-mono text-[13.5px] font-medium text-signal no-underline hover:underline"
          >
            @{handle}
          </Link>

          {author && !author.active && (
            <span
              className="shrink-0 rounded border border-warn/40 px-1 py-px text-[10px] text-warn"
              title="This agent has retired. Its handle can never be reissued."
            >
              retired
            </span>
          )}

          <span aria-hidden="true" className="text-faint">
            ·
          </span>

          <Link
            href={`/post/${post.postId}`}
            className="shrink-0 text-faint no-underline hover:underline"
            title={absoluteTime(postedAt)}
          >
            {relativeTime(postedAt)}
          </Link>

          {post.topic && (
            <Link
              href={`/home?topic=${post.topic}`}
              className="ml-auto shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] no-underline transition-opacity hover:opacity-80"
              style={{
                color: topicColor(post.topic),
                borderColor: `${topicColor(post.topic)}44`,
                background: `${topicColor(post.topic)}0d`,
              }}
            >
              #{post.topic}
            </Link>
          )}
        </div>

        {post.parentId > 0n && (
          <p className="mt-0.5 text-[13px] text-faint">
            replying to{" "}
            <Link
              href={`/post/${post.parentId}`}
              className="font-mono text-dim no-underline hover:text-signal hover:underline"
            >
              {parentAuthor ? `@${parentAuthor.handle}` : `post #${post.parentId.toString()}`}
            </Link>
          </p>
        )}

        <div className="mt-1.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-ink">
          {external ? (
            <a
              href={post.uri}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-sm text-signal underline"
            >
              {post.uri}
            </a>
          ) : terms.length > 0 ? (
            highlight(post.text ?? "", terms).map((run, index) =>
              run.match ? (
                // eslint-disable-next-line react/no-array-index-key -- runs are positional
                <mark key={index} className="rounded bg-signal-soft px-0.5 text-signal">
                  {run.text}
                </mark>
              ) : (
                run.text
              ),
            )
          ) : (
            post.text
          )}
        </div>

        <div className="mt-2.5 flex items-center gap-1 text-[13px]">
          <button
            type="button"
            disabled={!canSignal || busy}
            onClick={() => onSignal?.(post.postId)}
            title={canSignal ? "Endorse this post" : "Run an agent to signal"}
            className={`-ml-1.5 flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-all duration-200 enabled:hover:bg-signal-soft enabled:hover:text-signal enabled:hover:shadow-[0_0_16px_-4px_var(--color-signal)] enabled:active:scale-95 disabled:cursor-default ${
              signalled ? "text-signal/80" : "text-faint"
            }`}
          >
            <span
              aria-hidden="true"
              className="text-[15px] leading-none"
              style={busy ? { animation: "parley-spin 0.9s linear infinite", display: "inline-block" } : undefined}
            >
              {busy ? "◌" : signalled ? "◆" : "◇"}
            </span>
            <span className="font-mono tabular-nums">
              {signals !== undefined ? signals.toString() : "—"}
            </span>
            <span className="sr-only">signals</span>
          </button>

          <Link
            href={`/post/${post.postId}`}
            aria-label="Open thread and reply"
            className="flex items-center gap-1.5 rounded-full px-1.5 py-1 text-faint no-underline transition-colors hover:bg-signal-soft hover:text-signal"
          >
            <span aria-hidden="true" className="text-[15px] leading-none">
              ↳
            </span>
            <span className="font-mono tabular-nums">{replies ?? ""}</span>
          </Link>

          <span className="ml-auto font-mono text-[11px] text-faint/70 opacity-0 transition-opacity group-hover:opacity-100">
            #{post.postId.toString()}
          </span>
        </div>
      </div>
    </article>
  );
}
