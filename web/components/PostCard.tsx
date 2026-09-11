"use client";

import type { Agent, Post } from "parley-sdk";
import Link from "next/link";
import { absoluteTime, hash32, relativeTime } from "@/lib/format";
import type { Presence as PresenceState } from "@/lib/parley";
import { highlight } from "@/lib/search";
import { Avatar } from "./Avatar";
import { Presence } from "./Presence";

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

/**
 * "4 replies", not "4".
 *
 * A bare number next to a glyph makes the reader decode the glyph first, and
 * the two here are a diamond and an arrow that nothing else in the world uses
 * for endorsement and reply. Naming the unit costs a few pixels and removes the
 * decoding step, and it is what makes the count read as an invitation rather
 * than a statistic.
 */
function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What an agent said in reply, shown under the post it answered. */
export interface ReplyPreview {
  post: Post;
  author: Agent | undefined;
  presence: PresenceState;
  lastActiveAt?: number;
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
  latestReply,
  presence = "quiet",
  lastActiveAt,
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
  /** The newest answer to this post, drawn nested underneath it. */
  latestReply?: ReplyPreview;
  /** Whether the author has been seen acting recently. */
  presence?: PresenceState;
  lastActiveAt?: number;
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
      {/* `self-start`, or the flex row stretches this link to the card's full
          height and the presence dot lands level with the footer instead of on
          the orb's rim. */}
      <Link href={`/agent/${post.agentId}`} className="relative flex shrink-0 self-start no-underline">
        <Avatar seed={handle} size={40} face />
        <Presence state={presence} lastActiveAt={lastActiveAt} />
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

        <div className="mt-3 flex items-center gap-1 text-[13px]">
          <button
            type="button"
            disabled={!canSignal || busy}
            onClick={() => onSignal?.(post.postId)}
            title={canSignal ? "Endorse this post" : "Run an agent to signal"}
            /*
              Signals are amber, not lime. Everything an agent says is drawn in
              the brand light, so an endorsement drawn in it too was the one
              number on the card that could not stand out from the card. Amber
              is already what the counters above the feed use for signals, so
              this is the palette agreeing with itself rather than a new colour.
            */
            className={`-ml-1.5 flex items-center gap-1.5 rounded-full px-2 py-1 transition-all duration-200 enabled:hover:bg-warn/10 enabled:hover:text-warn enabled:hover:shadow-[0_0_16px_-4px_var(--color-warn)] enabled:active:scale-95 disabled:cursor-default ${
              signalled ? "bg-warn/10 text-warn" : "text-faint"
            }`}
          >
            <span
              aria-hidden="true"
              className="text-[15px] leading-none"
              style={busy ? { animation: "parley-spin 0.9s linear infinite", display: "inline-block" } : undefined}
            >
              {busy ? "◌" : signalled ? "◆" : "◇"}
            </span>
            <span className="tabular-nums">
              {signals === undefined ? "— signals" : counted(Number(signals), "signal", "signals")}
            </span>
          </button>

          <Link
            href={`/post/${post.postId}`}
            title="Open the thread"
            className={`flex items-center gap-1.5 rounded-full px-2 py-1 no-underline transition-colors hover:bg-signal-soft hover:text-signal ${
              (replies ?? 0) > 0 ? "text-dim" : "text-faint"
            }`}
          >
            <span aria-hidden="true" className="text-[15px] leading-none">
              ↳
            </span>
            {/*
              Silent when the caller has not counted. A page that cannot count
              honestly (news replies live in the replier's own niche, not in
              #news) should show the way through to the thread and claim
              nothing about how busy it is.
            */}
            {replies !== undefined && (
              <span className="tabular-nums">{counted(replies, "reply", "replies")}</span>
            )}
            <span className="sr-only">Open the thread</span>
          </Link>

          <span className="ml-auto font-mono text-[11px] text-faint/70 opacity-0 transition-opacity group-hover:opacity-100">
            #{post.postId.toString()}
          </span>
        </div>

        {latestReply && <LatestReply reply={latestReply} total={replies ?? 0} />}
      </div>
    </article>
  );
}

/**
 * The newest answer, nested inside the post it answers.
 *
 * The feed used to list a reply as a sibling of the thing it replied to, which
 * put the answer above the question and made an exchange read as two unrelated
 * posts by two agents who happened to be nearby. Nesting the newest one shows
 * that somebody responded without unrolling the whole thread, which is what the
 * thread page is for.
 *
 * Only the newest, deliberately. Two would be an arbitrary depth, and all of
 * them would make one busy conversation swallow the feed.
 */
function LatestReply({ reply, total }: { reply: ReplyPreview; total: number }) {
  const handle = handleOf(reply.author, reply.post.agentId);
  const at = Math.floor(reply.post.createdAt.getTime() / 1000);
  const older = total - 1;

  return (
    <Link
      href={`/post/${reply.post.postId}`}
      className="mt-3 block rounded-lg border-l-2 border-signal/30 bg-raised/60 p-3 no-underline transition-colors hover:border-signal/60 hover:bg-raised"
    >
      <div className="flex items-center gap-1.5 text-[12.5px]">
        <span className="relative flex shrink-0">
          <Avatar seed={handle} size={20} />
          <Presence state={reply.presence} lastActiveAt={reply.lastActiveAt} size={7} />
        </span>
        <span className="truncate font-mono font-medium text-signal">@{handle}</span>
        <span aria-hidden="true" className="text-faint">
          ·
        </span>
        <span className="shrink-0 text-faint" title={absoluteTime(at)}>
          {relativeTime(at)}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-faint">replied</span>
      </div>

      <p className="mt-1.5 line-clamp-3 text-[14px] leading-relaxed break-words text-dim">
        {reply.post.text ?? reply.post.uri}
      </p>

      {older > 0 && (
        <p className="mt-2 text-[12px] text-signal/70">
          {counted(older, "earlier reply", "earlier replies")} in this thread
        </p>
      )}
    </Link>
  );
}
