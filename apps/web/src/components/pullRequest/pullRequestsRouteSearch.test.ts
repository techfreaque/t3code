import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  defaultStringifySearch,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { Route as PullRequestsRoute } from "../../routes/_chat.pull-requests";

function matchedSearch(url: string) {
  const root = createRootRoute();
  const chat = createRoute({ getParentRoute: () => root, id: "_chat" });
  const pullRequests = createRoute({
    getParentRoute: () => chat,
    path: "pull-requests",
    validateSearch: PullRequestsRoute.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([chat.addChildren([pullRequests])]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  // useSearch reads matched-route search, which can differ from URL search.
  return router.matchRoutes(router.latestLocation).at(-1)?.search as
    | Record<string, unknown>
    | undefined;
}

describe("pull requests route search", () => {
  it("drops a q the URL parser turned into a number", () => {
    expect(matchedSearch("/pull-requests?q=4089")?.q).toBeUndefined();
    expect(matchedSearch("/pull-requests?q=true")?.q).toBeUndefined();
  });

  it("keeps a q that is text, including quoted digits", () => {
    expect(matchedSearch("/pull-requests?q=fix")?.q).toBe("fix");
    expect(matchedSearch("/pull-requests?q=%224089%22")?.q).toBe("4089");
  });

  it("keeps known grouping levels, outermost first, and drops anything else", () => {
    expect(matchedSearch("/pull-requests?groupBy=repository")?.groupBy).toEqual(["repository"]);
    expect(
      matchedSearch(
        `/pull-requests?groupBy=${encodeURIComponent(JSON.stringify(["repository", "review", "checks"]))}`,
      )?.groupBy,
    ).toEqual(["repository", "review", "checks"]);
    expect(
      matchedSearch(
        `/pull-requests?groupBy=${encodeURIComponent(JSON.stringify(["state", "colour", "state", "involvement", "review"]))}`,
      )?.groupBy,
    ).toEqual(["state", "review"]);
    expect(matchedSearch("/pull-requests?groupBy=colour")?.groupBy).toBeUndefined();
    expect(matchedSearch("/pull-requests?groupBy=involvement")?.groupBy).toBeUndefined();
    expect(matchedSearch("/pull-requests?groupBy=none")?.groupBy).toEqual(["none"]);
    expect(
      matchedSearch(
        `/pull-requests${defaultStringifySearch({ groupBy: ["repository", "state", "draft"] })}`,
      )?.groupBy,
    ).toEqual(["repository", "state", "draft"]);
    expect(
      matchedSearch(
        `/pull-requests${defaultStringifySearch({ groupBy: [null, 1, ["host"], "state", "none", "review"] })}`,
      )?.groupBy,
    ).toEqual(["state"]);
  });

  it("clears invalid sort and involvement values", () => {
    expect(matchedSearch("/pull-requests?involvement=reviewing&sort=updated")).toMatchObject({
      involvement: "reviewing",
      sort: "updated",
    });
    const invalid = matchedSearch("/pull-requests?involvement=unknown&sort=unknown");
    expect(invalid?.involvement).toBe("all");
    expect(invalid?.sort).toBeUndefined();
  });

  it("drops an author or labels the URL parser turned into a number", () => {
    expect(matchedSearch("/pull-requests?author=4089")?.author).toBeUndefined();
    expect(matchedSearch("/pull-requests?labels=4089")?.labels).toBeUndefined();
  });
});
