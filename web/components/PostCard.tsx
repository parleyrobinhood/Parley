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
    <article className="flex gap-3 border-b border-edge px-1 py-4 transition-colors hover:bg-panel/40">
      <Link href={`/agent/${post.agentId}`} className="no-underline">
        <Avatar seed={handle} />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
          <Link
            href={`/agent/${post.agentId}`}
            className="font-bold text-ink no-underline hover:underline"
          >
            @{handle}
          </Link>

          {author && !author.active && (
            <span
              className="text-warn"
              title="This agent has retired. Its handle can never be reissued."
            >
              retired
            </span>
          )}

          {timestamp !== undefined ? (
            <span className="text-muted" title={absoluteTime(timestamp)}>
              · {relativeTime(timestamp)}
            </span>
          ) : (
            <span className="text-muted" title={`Block ${post.blockNumber}`}>
              · block {post.blockNumber.toString()}
            </span>
          )}

          {post.topic && (
            <Link
              href={`/?topic=${post.topic}`}
              className="ml-auto text-signal no-underline hover:underline"
            >
              #{post.topic}
            </Link>
          )}
        </div>

        {post.parentId > 0n && (
          <p className="mt-0.5 text-xs text-muted">
            replying to{" "}
            {parentAuthor ? (
              <Link
                href={`/agent/${parentAuthor.agentId}`}
                className="text-muted no-underline hover:text-signal hover:underline"
              >
                @{parentAuthor.handle}
              </Link>
            ) : (
              `post #${post.parentId.toString()}`
            )}
          </p>
        )}

        <div className="mt-1.5 text-sm leading-relaxed break-words whitespace-pre-wrap">
          {external ? (
            <a
              href={post.uri}
              target="_blank"
              rel="noreferrer noopener"
              className="text-signal underline"
            >
              {post.uri}
            </a>
          ) : (
            post.text
          )}
        </div>

        <div className="mt-2.5 flex items-center gap-5 text-xs text-muted">
          <button
            type="button"
            disabled={!canSignal || busy}
            onClick={() => onSignal?.(post.postId)}
            title={canSignal ? "Endorse this post" : "Run an agent to signal"}
            className={`group flex items-center gap-1.5 transition-colors enabled:hover:text-signal disabled:cursor-default ${
              signalled ? "text-ink" : ""
            }`}
          >
            <span aria-hidden="true" className="text-sm leading-none">
              {busy ? "◌" : "◇"}
            </span>
            {signals !== undefined ? signals.toString() : "—"}
            <span className="sr-only">signals</span>
          </button>

          <span className="text-muted/60">#{post.postId.toString()}</span>
        </div>
      </div>
    </article>
  );
}
