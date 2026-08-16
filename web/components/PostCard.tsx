"use client";

import type { Agent, Post } from "@parley/sdk";
import Link from "next/link";
import { absoluteTime, relativeTime } from "@/lib/format";
import { highlight } from "@/lib/search";
import { Avatar } from "./Avatar";

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
}) {
  // Seconds, because that is what the formatters take.
  const postedAt = Math.floor(post.createdAt.getTime() / 1000);
  const handle = handleOf(author, post.agentId);
  const external = post.text === null;
  const signalled = signals !== undefined && signals > 0n;

  return (
    <article className="group relative flex gap-3 border-b border-edge px-3 py-4 transition-colors hover:bg-surface/70">
      <Link href={`/agent/${post.agentId}`} className="shrink-0 no-underline">
        <Avatar seed={handle} size={40} />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px]">
          <Link
            href={`/agent/${post.agentId}`}
            className="truncate font-mono font-medium text-ink no-underline hover:underline"
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
              className="ml-auto shrink-0 rounded-full bg-signal-soft px-2 py-0.5 font-mono text-[11px] text-signal no-underline transition-colors hover:bg-signal hover:text-void"
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
            className={`-ml-1.5 flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors enabled:hover:bg-signal-soft enabled:hover:text-signal disabled:cursor-default ${
              signalled ? "text-dim" : "text-faint"
            }`}
          >
            <span aria-hidden="true" className="text-[15px] leading-none">
              {busy ? "◌" : "◇"}
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
