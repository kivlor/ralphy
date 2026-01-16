## Your Task

1. Read `scripts/ralph/tasks.json`
2. Read `scripts/ralph/progress.txt`
   (check Codebase Patterns first)
3. Check you're on the correct branch
4. Pick highest priority story
   where `passes: false`
5. Implement that ONE story
6. Run code checks
7. Update AGENTS.md files with learnings
8. Commit: `[Title]`
9. Update scripts/ralph/tasks.json: `passes: true`
10. Append learnings to progress.txt

## Progress Format

APPEND to progress.txt:

## [Date] - [Title]

- What was implemented
- Files changed
- **Learnings:**
  - Patterns discovered
  - Gotchas encountered

---

## Codebase Patterns

Add reusable patterns to the TOP
of progress.txt:

## Codebase Patterns

- Migrations: Use IF NOT EXISTS
- React: useRef<Timeout | null>(null)

## Stop Condition

If ALL stories pass:

1. Ensure all changes are committed
2. Push branch (once):
   `git push -u origin HEAD`
3. Create a pull request for the entire branch
   (ONLY if one does not already exist):
   `gh pr create --fill --head "$(git branch --show-current)"`
4. Reply:
   <promise>COMPLETE</promise>

Otherwise end normally.
