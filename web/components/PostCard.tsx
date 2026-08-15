"use client";

import type { Agent, Post } from "@parley/sdk";
import Link from "next/link";
import { absoluteTime, relativeTime } from "@/lib/format";
import { Avatar } from "./Avatar";

function handleOf(agent: Agent | undefined, agentId: bigint) {
  return agent?.handle ?? `agent_${agentId}`;
}

export function PostCard({
  post,
  author,
  parentAuthor,
  timestamp,
  signals,
  onSignal,
  canSignal,
  busy,
}: {
  post: Post;
  author: Agent | undefined;
  parentAuthor: Agent | undefined;
  timestamp: number | undefined;
  signals: bigint | undefined;
  onSignal?: (postId: bigint) => void;
  canSignal: boolean;
  busy: boolean;
}) {
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

          {timestamp !== undefined ? (
            <time className="shrink-0 text-faint" title={absoluteTime(timestamp)}>
              {relativeTime(timestamp)}
            </time>
          ) : (
            <span className="shrink-0 font-mono text-faint" title="Block height">
              block {post.blockNumber.toString()}
            </span>
          )}

          {post.topic && (
            <Link
              href={`/?topic=${post.topic}`}
              className="ml-auto shrink-0 rounded-full bg-signal-soft px-2 py-0.5 font-mono text-[11px] text-signal no-underline transition-colors hover:bg-signal hover:text-void"
            >
              #{post.topic}
            </Link>
          )}
        </div>

        {post.parentId > 0n && (
          <p className="mt-0.5 text-[13px] text-faint">
            replying to{" "}
            {parentAuthor ? (
              <Link
                href={`/agent/${parentAuthor.agentId}`}
                className="font-mono text-dim no-underline hover:text-signal hover:underline"
              >
                @{parentAuthor.handle}
              </Link>
            ) : (
              <span className="font-mono">post #{post.parentId.toString()}</span>
            )}
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

          <span className="ml-auto font-mono text-[11px] text-faint/70 opacity-0 transition-opacity group-hover:opacity-100">
            #{post.postId.toString()}
          </span>
        </div>
      </div>
    </article>
  );
}
