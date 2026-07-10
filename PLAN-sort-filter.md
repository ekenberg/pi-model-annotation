# Plan: fix sort breaking when filtering (issue 3)

## Symptom
The ANNOTATED > SCOPED > REST sort works for the default (unfiltered) list,
but as soon as you type a filter query, the list reorders in an "unclear way"
— the tiered sort is lost.

## Root cause
`src/picker.ts` `applyFilter()`:

```ts
this.filtered = q ? fuzzyFilter(this.items, q, (m) => m.searchText) : this.items;
```

`fuzzyFilter` (pi-tui `fuzzy.js`) does two things:
1. Filters items to those that match all whitespace/slash-separated tokens.
2. **Sorts the matches by fuzzy match score** (best match first):
   ```js
   results.sort((a, b) => a.totalScore - b.totalScore);
   return results.map((r) => r.item);
   ```

So when `q` is non-empty, `this.filtered` is reordered by fuzzy score,
discarding the ANNOTATED>SCOPED>REST tier sort that `rebuildItems()` applied
to `this.items`. With an empty filter, `fuzzyFilter` returns `items` unchanged
(the `if (!query.trim()) return items;` early return), which is why the
default list sorts correctly.

## Fix
Re-apply the tier sort to `this.filtered` after `fuzzyFilter` returns. The
tier comparator is already defined inline in `rebuildItems()`; extract it into
a method or module function so `applyFilter` can reuse it.

### Concrete change in `src/picker.ts`

1. Extract the tier comparator into a module-level function (or a private
   method on the class):

   ```ts
   function editorItemRank(a: EditorItem, b: EditorItem): number {
       const tier = (item: EditorItem) => (item.annotated ? 0 : item.scoped ? 1 : 2);
       const ta = tier(a), tb = tier(b);
       if (ta !== tb) return ta - tb;
       return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
   }
   ```

2. Use it in `rebuildItems()` instead of the inline comparator:
   ```ts
   items.sort(editorItemRank);
   ```

3. Use it in `applyFilter()` to re-sort the filtered results:
   ```ts
   private applyFilter() {
       const q = this.searchInput.getValue();
       this.filtered = q ? fuzzyFilter(this.items, q, (m) => m.searchText) : this.items;
       if (q) this.filtered = [...this.filtered].sort(editorItemRank);
       if (this.selectedIndex >= this.filtered.length) {
           this.selectedIndex = Math.max(0, this.filtered.length - 1);
       }
   }
   ```

   (`[...this.filtered]` to avoid mutating `fuzzyFilter`'s returned array in
   place — though it's a fresh array anyway, so `this.filtered.sort(...)`
   would also be fine. Use the spread for clarity/safety.)

### Why this works
- Empty filter: `fuzzyFilter` returns `this.items` unchanged (already sorted
  by `rebuildItems`). The `if (q)` guard skips the re-sort. Behavior
  unchanged. ✓
- Non-empty filter: `fuzzyFilter` returns score-sorted matches; we immediately
  re-sort them by tier. Tier sort is stable for same-tier items
  (`localeCompare` is deterministic), so within each tier the items keep a
  consistent alphabetical order. The fuzzy score no longer affects ordering. ✓

### Alternatives considered (rejected)
- **Don't use `fuzzyFilter`; filter manually preserving `this.items` order.**
  Would require re-implementing the fuzzy-match logic (all-tokens-must-match,
  whitespace/slash tokenization). More code, duplicates pi-tui behavior, risks
  drift. The re-sort approach is one line and reuses the tested `fuzzyFilter`.
- **Sort inside `fuzzyFilter` by a custom key.** `fuzzyFilter` doesn't accept
  a custom comparator — it always sorts by score. Can't change it without
  forking pi-tui.

## Files to change
- `src/picker.ts` only: extract `editorItemRank`, use in `rebuildItems` and
  `applyFilter`. No changes to other files.

## Verification
- Load check: `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 pi -p "ignore"` exits 0.
- Manual test: `/model-annotations`, type a filter that matches models across
  all three tiers → confirm annotated matches still sort above scoped matches
  above rest matches, alphabetical within each tier. Clear the filter →
  confirm the full list is still tier-sorted (no regression).
- Edge cases: filter matches only annotated models (all at top, alphabetical);
  filter matches zero models (empty state message shows); filter matches a
  model that is both annotated and scoped (shows ★, tier 0).

## Risks
- None significant. The re-sort is deterministic and cheap (~350 items max).
- The only behavioral change: filtered results are no longer ordered by fuzzy
  match quality (best match first). This is the intended trade-off — the user
  wants tier sorting to hold while filtering. If fuzzy-relevance ordering
  within a tier were ever desired, the comparator could be extended to use
  fuzzy score as a tiebreaker after alphabetical, but that's out of scope.
