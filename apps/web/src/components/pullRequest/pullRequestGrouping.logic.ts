import type { PullRequestListEntry } from "@t3tools/contracts";
import { msg } from "gt-react";

import type { PullRequestGroupBy } from "./pullRequestListPreferences";
import {
  comparePullRequestsByRecency,
  rankPullRequestMatches,
  type PullRequestGroup,
} from "./pullRequestList.logic";

/**
 * A group, with the groups it is split into when the reader groups by more than one thing.
 * `entries` is every row under it, in the order its children list them.
 */
export interface PullRequestGrouped<
  Entry extends PullRequestListEntry,
> extends PullRequestGroup<Entry> {
  readonly children?: ReadonlyArray<PullRequestGrouped<Entry>>;
}

interface Bucket {
  readonly key: string;
  readonly label: string;
  /** Fixed order for known values; buckets sharing a rank sort by label. */
  readonly rank: number;
}

const LAST = Number.MAX_SAFE_INTEGER;
const DAY_MS = 24 * 60 * 60 * 1000;

export function poolPullRequestGroups<Entry extends PullRequestListEntry>(
  groups: ReadonlyArray<PullRequestGroup<Entry>>,
  text: string,
): ReadonlyArray<PullRequestGroup<Entry>> {
  const entries = groups.flatMap((group) => group.entries);
  return [
    {
      key: "others",
      label: "",
      entries:
        text.trim().length > 0
          ? rankPullRequestMatches(entries, text)
          : entries.toSorted(comparePullRequestsByRecency),
    },
  ];
}

const fixed = (rank: number, key: string, label: string): Bucket => ({ key, label, rank });
const named = (key: string, label: string, missing = false): Bucket => ({
  key: `${missing ? "~" : "="}${key.toLowerCase()}`,
  label,
  rank: missing ? LAST : 0,
});

const STATE_BUCKETS = {
  open: fixed(0, "open", msg("Open", { $context: "pull request state" })),
  merged: fixed(1, "merged", msg("Merged", { $context: "pull request state" })),
  closed: fixed(2, "closed", msg("Closed", { $context: "pull request state" })),
};

const REVIEW_BUCKETS = {
  approved: fixed(0, "approved", msg("Approved", { $context: "review outcome" })),
  "changes-requested": fixed(1, "changes-requested", msg("Changes requested")),
  "review-required": fixed(2, "review-required", msg("Awaiting review")),
  none: fixed(3, "none", msg("No reviews")),
};

const CHECKS_BUCKETS = {
  failing: fixed(0, "failing", msg("Failing", { $context: "checks filter" })),
  pending: fixed(1, "pending", msg("Pending", { $context: "checks group" })),
  passing: fixed(2, "passing", msg("Passing", { $context: "checks filter" })),
  none: fixed(3, "none", msg("No checks")),
};

const MERGEABILITY_BUCKETS = {
  conflicting: fixed(0, "conflicting", msg("Has conflicts")),
  mergeable: fixed(1, "mergeable", msg("Mergeable")),
  unknown: fixed(2, "unknown", msg("Merge state unknown")),
};

const AGE_BUCKETS = [
  fixed(0, "today", msg("Updated today")),
  fixed(1, "week", msg("Updated this week")),
  fixed(2, "month", msg("Updated this month")),
  fixed(3, "older", msg("Updated earlier")),
];

function ageBucket(updatedAt: string, now: number): Bucket {
  const updated = Date.parse(updatedAt);
  const age = Number.isNaN(updated) ? Infinity : now - updated;
  if (age < DAY_MS) return AGE_BUCKETS[0]!;
  if (age < 7 * DAY_MS) return AGE_BUCKETS[1]!;
  if (age < 30 * DAY_MS) return AGE_BUCKETS[2]!;
  return AGE_BUCKETS[3]!;
}

/** The labels sort alphabetically and a row sits under its first, so no row is listed twice. */
function firstLabel(entry: PullRequestListEntry): string | null {
  const names = entry.labels.map((label) => label.name.trim()).filter((name) => name.length > 0);
  return names.length === 0 ? null : names.toSorted((left, right) => left.localeCompare(right))[0]!;
}

function bucketOf(
  by: Exclude<PullRequestGroupBy, "involvement" | "none">,
  entry: PullRequestListEntry,
  now: number,
): Bucket {
  switch (by) {
    case "project":
      return named(entry.projectTitle, entry.projectTitle);
    case "repository":
      return named(entry.repository, entry.repository);
    case "host":
      return named(entry.host, entry.host);
    case "author":
      return entry.author === null
        ? named("", msg("Unknown author"), true)
        : named(entry.author.login, entry.author.login);
    case "state":
      return STATE_BUCKETS[entry.state];
    case "review":
      return REVIEW_BUCKETS[entry.reviewDecision ?? "none"];
    case "checks":
      return CHECKS_BUCKETS[entry.checksState ?? "none"];
    case "draft":
      return entry.isDraft
        ? fixed(1, "draft", msg("Drafts", { $context: "pull request group" }))
        : fixed(0, "ready", msg("Ready for review"));
    case "mergeability":
      return MERGEABILITY_BUCKETS[entry.mergeability];
    case "label": {
      const label = firstLabel(entry);
      return label === null ? named("", msg("No label"), true) : named(label, label);
    }
    case "base":
      return { key: `=${entry.baseBranch}`, label: entry.baseBranch, rank: 0 };
    case "updated":
      return ageBucket(entry.updatedAt, now);
  }
}

/** Splits rows into headed buckets; rows keep the order they came in within each bucket. */
function bucketPullRequests<Entry extends PullRequestListEntry>(
  entries: ReadonlyArray<Entry>,
  by: Exclude<PullRequestGroupBy, "involvement" | "none">,
  now: number,
): ReadonlyArray<{ readonly bucket: Bucket; readonly entries: ReadonlyArray<Entry> }> {
  const buckets = new Map<string, { bucket: Bucket; entries: Entry[] }>();
  for (const entry of entries) {
    const bucket = bucketOf(by, entry, now);
    const held = buckets.get(bucket.key);
    if (held === undefined) buckets.set(bucket.key, { bucket, entries: [entry] });
    else held.entries.push(entry);
  }
  return [...buckets.values()].toSorted(
    (left, right) =>
      left.bucket.rank - right.bucket.rank || left.bucket.label.localeCompare(right.bucket.label),
  );
}

/**
 * Regroups `groups` into the reader's levels, outermost first. A leading `involvement` keeps
 * the groups it was given (the Authored / Review requested / Others split); every other
 * first level pools the rows first, so the list's sort decides the order within a bucket.
 * Each further level splits every group above it again, to any depth.
 */
export function regroupPullRequests<Entry extends PullRequestListEntry>(
  groups: ReadonlyArray<PullRequestGroup<Entry>>,
  levels: ReadonlyArray<PullRequestGroupBy>,
  now: number,
): ReadonlyArray<PullRequestGrouped<Entry>> {
  const split = (
    group: PullRequestGroup<Entry>,
    deeper: ReadonlyArray<PullRequestGroupBy>,
  ): PullRequestGrouped<Entry> => {
    const [by, ...rest] = deeper;
    if (by === undefined || by === "involvement" || by === "none") return group;
    const children = bucketPullRequests(group.entries, by, now).map(({ bucket, entries }) =>
      split({ key: bucket.key, label: bucket.label, entries }, rest),
    );
    return { ...group, entries: children.flatMap((child) => child.entries), children };
  };
  const [first = "involvement", ...deeper] = levels;
  if (first === "involvement") return groups.map((group) => split(group, deeper));
  const pooled = groups.flatMap((group) => group.entries);
  if (first === "none") return [{ key: "others", label: "", entries: pooled }];
  return bucketPullRequests(pooled, first, now).map(({ bucket, entries }) =>
    split({ key: bucket.key, label: bucket.label, entries }, deeper),
  );
}

/** The first `budget` rows of a group, with its children cut to match. */
function prefixOfGroup<Entry extends PullRequestListEntry>(
  group: PullRequestGrouped<Entry>,
  budget: number,
): PullRequestGrouped<Entry> | null {
  const entries = group.entries.slice(0, budget);
  if (entries.length === 0) return null;
  if (group.children === undefined) return { ...group, entries };
  let remaining = entries.length;
  const children: PullRequestGrouped<Entry>[] = [];
  for (const child of group.children) {
    if (remaining <= 0) break;
    const shown = prefixOfGroup(child, remaining);
    if (shown === null) continue;
    children.push(shown);
    remaining -= shown.entries.length;
  }
  return { ...group, entries, children };
}

export function slicePullRequestGroups<Entry extends PullRequestListEntry>(
  groups: ReadonlyArray<PullRequestGrouped<Entry>>,
  limit: number,
): ReadonlyArray<PullRequestGrouped<Entry>> {
  let left = limit;
  return groups.flatMap((group) => {
    const shown = prefixOfGroup(group, left);
    if (shown === null) return [];
    left -= shown.entries.length;
    return [shown];
  });
}
