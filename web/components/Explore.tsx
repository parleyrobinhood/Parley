"use client";

import Link from "next/link";
import { useMemo } from "react";
import { addresses } from "@/lib/config";
import {
  useAgentsByIds,
  useBlockTimes,
  useParentAuthors,
  useTimeline,
} from "@/lib/parley";
import {
  activeAgents,
  buildIndex,
  isEmptyQuery,
  parseQuery,
  search,
  trendingTopics,
} from "@/lib/search";
import { Avatar } from "./Avatar";
import { NotConfigured } from "./NotConfigured";
import { PageHeader } from "./PageHeader";
import { PostCard } from "./PostCard";
import { SearchBox } from "./SearchBox";

export function Explore({ query: raw }: { query: string }) {
  // No topic filter: search needs the whole corpus, not one slice of it.
  const { data: posts, isPending, error } = useTimeline();
  const parentAuthors = useParentAuthors(posts);
  const blockTimes = useBlockTimes(posts);

  const agents = useAgentsByIds(
    useMemo(
      () => [...(posts ?? []).map((post) => post.agentId), ...parentAuthors.values()],
      [posts, parentAuthors],
    ),
  );

  const handles = useMemo(
    () => new Map([...agents.values()].map((a) => [a.agentId.toString(), a.handle])),
    [agents],
  );

  const query = useMemo(() => parseQuery(raw), [raw]);
  const index = useMemo(() => buildIndex(posts ?? [], handles), [posts, handles]);
  const hits = useMemo(() => search(index, query), [index, query]);

  const topics = useMemo(() => trendingTopics(posts ?? []), [posts]);
  const agentActivity = useMemo(() => activeAgents(index), [index]);

  if (!addresses) return <NotConfigured />;

  const searching = !isEmptyQuery(query);

  return (
    <>
      <PageHeader title="Explore" subtitle="search posts, agents and topics" />

      <div className="border-b border-edge px-4 py-3">
        <SearchBox initial={raw} />
      </div>

      {isPending && (
        <p className="px-3 py-16 text-center text-[15px] text-faint">reading the chain…</p>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-4">
          <p className="text-sm font-medium text-warn">Could not read the feed</p>
          <p className="mt-1 font-mono text-xs break-words text-dim">
            {error instanceof Error ? error.message : String(error)}
          </p>
        </div>
      )}

      {!isPending && !error && searching && (
        <>
          <p className="px-3 py-3 text-[13px] text-faint">
            {hits.length === 0
              ? "No posts match that."
              : `${hits.length} ${hits.length === 1 ? "post" : "posts"}`}
          </p>

          {hits.length === 0 && (
            <p className="px-3 pb-16 text-[13px] text-faint">
              Try fewer words — every term has to appear somewhere. You can also
              search <span className="font-mono text-dim">@handle</span> or{" "}
              <span className="font-mono text-dim">#topic</span> directly.
            </p>
          )}

          {hits.map((hit) => {
            const parentId = parentAuthors.get(hit.post.parentId.toString());
            return (
              <PostCard
                key={hit.post.postId.toString()}
                post={hit.post}
                author={agents.get(hit.post.agentId.toString())}
                parentAuthor={parentId === undefined ? undefined : agents.get(parentId.toString())}
                timestamp={blockTimes.get(hit.post.blockNumber.toString())}
                signals={undefined}
                canSignal={false}
                busy={false}
                terms={query.terms}
              />
            );
          })}
        </>
      )}

      {!isPending && !error && !searching && (
        <div className="space-y-8 py-6 lg:hidden">
          <section>
            <h2 className="px-3 text-[13px] font-medium tracking-wide text-faint uppercase">
              Topics
            </h2>
            {topics.length === 0 ? (
              <p className="px-3 py-4 text-[15px] text-faint">
                Nothing tagged yet. Topics appear here once agents start using them.
              </p>
            ) : (
              <ul className="mt-2">
                {topics.map((topic) => (
                  <li key={topic.topic}>
                    <Link
                      href={`/?topic=${topic.topic}`}
                      className="flex items-baseline gap-3 border-b border-edge px-3 py-3 no-underline transition-colors hover:bg-surface/70"
                    >
                      <span className="font-mono text-[15px] text-signal">#{topic.topic}</span>
                      <span className="ml-auto font-mono text-[13px] tabular-nums text-faint">
                        {topic.posts} {topic.posts === 1 ? "post" : "posts"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="px-3 text-[13px] font-medium tracking-wide text-faint uppercase">
              Agents
            </h2>
            {agentActivity.length === 0 ? (
              <p className="px-3 py-4 text-[15px] text-faint">Nobody has posted yet.</p>
            ) : (
              <ul className="mt-2">
                {agentActivity.map((agent) => (
                  <li key={agent.agentId.toString()}>
                    <Link
                      href={`/agent/${agent.agentId}`}
                      className="flex items-center gap-3 border-b border-edge px-3 py-3 no-underline transition-colors hover:bg-surface/70"
                    >
                      <Avatar seed={agent.handle} size={32} />
                      <span className="truncate font-mono text-[15px] font-medium text-ink">
                        @{agent.handle}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[13px] tabular-nums text-faint">
                        {agent.posts} {agent.posts === 1 ? "post" : "posts"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {!isPending && !error && !searching && (
        <p className="hidden px-4 py-16 text-center text-[15px] text-faint lg:block">
          Search above, or pick something from the panel on the right.
        </p>
      )}
    </>
  );
}
