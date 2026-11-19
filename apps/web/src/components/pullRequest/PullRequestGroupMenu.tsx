import { useGT, useMessages } from "gt-react";
import { Rows3Icon } from "lucide-react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { PullRequestFilterRadioSubmenu } from "./PullRequestListFilters";
import { GROUP_BY_OPTIONS, resolveFilterOptions } from "./pullRequestListOptions";
import {
  DEFAULT_PULL_REQUEST_GROUP_BY,
  normalizePullRequestGrouping,
  type PullRequestGroupBy,
} from "./pullRequestListPreferences";

export function PullRequestGroupMenu({
  groupBy,
  onChange,
}: {
  groupBy: ReadonlyArray<PullRequestGroupBy>;
  onChange: (patch: { groupBy?: ReadonlyArray<PullRequestGroupBy> | undefined }) => void;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const options = resolveFilterOptions(GROUP_BY_OPTIONS, resolve);
  const flat = groupBy[0] === "none";
  const isDefault = groupBy.join() === DEFAULT_PULL_REQUEST_GROUP_BY.join();
  const canAddLevel = options.some(
    (option) =>
      option.value !== "none" && option.value !== "involvement" && !groupBy.includes(option.value),
  );
  const levelCount = groupBy.length + Number(!flat && canAddLevel);
  const setLevel = (index: number, value: PullRequestGroupBy) =>
    onChange({
      groupBy: normalizePullRequestGrouping([
        ...groupBy.slice(0, index),
        value,
        ...(value === "none" ? [] : groupBy.slice(index + 1)),
      ]),
    });
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" />}>
        <Rows3Icon aria-hidden className="size-4" />
        <span>{gt("Group", { $context: "verb, group a list" })}</span>
        {!isDefault && !flat ? (
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
            {groupBy.length}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        {Array.from({ length: levelCount }, (_, index) => {
          const used = new Set(groupBy.filter((_level, at) => at !== index));
          const choices = options
            .filter(
              (option) =>
                !used.has(option.value) &&
                // Involvement splits the whole list, so only the first level can be it.
                (index === 0 || option.value !== "involvement"),
            )
            // Past the first level, "none" ends the grouping there.
            .map((option) =>
              index > 0 && option.value === "none"
                ? { ...option, label: gt("No further grouping") }
                : option,
            );
          return (
            <PullRequestFilterRadioSubmenu
              key={index}
              label={
                index === 0
                  ? gt("Group by", { $context: "pull request grouping" })
                  : gt("Then by", { $context: "pull request sub-grouping" })
              }
              value={groupBy[index] ?? "none"}
              options={choices}
              onChange={(next) => setLevel(index, next)}
            />
          );
        })}
        <MenuSeparator />
        <MenuItem disabled={isDefault} onClick={() => onChange({ groupBy: undefined })}>
          {gt("Reset grouping")}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
