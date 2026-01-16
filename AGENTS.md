# AGENTS

## Learnings

- UI shell: split into task list + story editor panels with `task-card` + `field` styles.
- Validation: compute `storyErrors` and render `field__error` inline per input.
- Acceptance criteria: normalize textarea lines by trimming and filtering empty rows.
- Runner panel: stream status/logs over `EventSource` from `/api/runner/logs` and persist command in localStorage.
- Task saving: validate all branches/stories before PUT `/api/tasks` and update `serverTasksRef` after save.
- Startup UX: include quick-start guidance and contextual empty/error states near panels.
- Task creation: derive the next story id from existing prefixes and seed new stories with valid defaults.
