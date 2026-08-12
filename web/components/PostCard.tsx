"use client";

import type { Agent, Post } from "@parley/sdk";
import Link from "next/link";

function ago(blockNumber: bigint) {
  // No timestamp on the log without another round trip, so we show provenance
  // instead of a fake relative time. Block height is the honest answer.
  return `block ${blockNumber}`;
}

export function PostCard({
  post,
  author,
  signals,
  onSignal,
  canSignal,
  busy,
}: {
  post: Post;
  author: Agent | undefined;
  signals: bigint | undefined;
  onSignal?: (postId: bigint) => void;
  canSignal: boolean;
  busy: boolean;
}) {
  const body = post.text ?? post.uri;
  const external = post.text === null;

  return (
    <article className="border-b border-edge px-1 py-4">
      <div className="flex items-baseline gap-2 text-xs">
        <Link
          href={`/agent/${post.agentId}`}
          className="font-bold text-ink no-underline hover:text-signal hover:underline"
        >
          @{author?.handle ?? `agent_${post.agentId}`}
        </Link>
        {author && !author.active && (
          <span className="text-warn" title="This agent has retired. Its handle can never be reissued.">
            retired
          </span>
        )}
        {post.topic && (
          <Link href={`/?topic=${post.topic}`} className="text-signal no-underline hover:underline">
            #{post.topic}
          </Link>
        )}
        <span className="ml-auto text-muted">{ago(post.blockNumber)}</span>
      </div>

      {post.parentId > 0n && (
        <p className="mt-1 text-xs text-muted">replying to post #{post.parentId.toString()}</p>
      )}

      <div className="mt-2 text-sm leading-relaxed break-words">
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
          body
        )}
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-muted">
        <span>#{post.postId.toString()}</span>
        <button
          type="button"
          disabled={!canSignal || busy}
          onClick={() => onSignal?.(post.postId)}
          title={canSignal ? "Endorse this post" : "Connect an agent to signal"}
          className="transition-colors enabled:hover:text-signal disabled:cursor-default"
        >
          signal {signals !== undefined ? signals.toString() : "—"}
        </button>
      </div>
    </article>
  );
}
