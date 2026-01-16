# Ralphy PRD

## Overview
Ralphy is a local, offline UI that runs via `npx ralphy` inside a repo that contains `scripts/ralph`. It reads `scripts/ralph/tasks.json` and `scripts/ralph/progress.txt`, lets the user manage tasks in a friendly form UI, and surfaces progress read‑only. It optionally starts the user's existing ralph script and can detect if it is running. The app runs as a Vite + React dev server on port 7257.

## Goals
- Create, edit, and validate ralph tasks in `scripts/ralph/tasks.json`.
- Read and display `scripts/ralph/progress.txt` (read‑only).
- Support live reload when files change on disk.
- Optionally launch the user's ralph script from the UI and indicate running status.
- Remain fully offline and work on macOS + Linux.

## Non‑Goals (v1)
- Multi‑user editing or concurrency controls.
- Cloud sync or remote access.
- Rich markdown editing or custom themes beyond a simple dark UI.
- Automated git operations.

## Users & Scenarios
- A developer in a repo with a ralph loop wants to create/edit tasks without hand‑editing JSON.
- A developer wants to monitor ralph progress while it runs.

## Assumptions
- The working directory contains `scripts/ralph/tasks.json` and `scripts/ralph/progress.txt`.
- Users manage backups via git.
- The ralph script is user‑provided (e.g., `scripts/ralph/run.sh`) and can be executed from the repo root.

## Functional Requirements
### 1) Task Management (tasks.json)
- Read `scripts/ralph/tasks.json` on load.
- Form‑based editor for tasks; no raw JSON editing in v1.
- Data model:
  - Top level: array of objects, each with:
    - `branchName` (string, required)
    - `userStories` (array, required)
  - Each `userStory` item:
    - `id` (string, required)
    - `title` (string, required)
    - `acceptanceCriteria` (array of strings, required, min 1)
    - `priority` (number, required)
    - `passes` (boolean, required)
    - `notes` (string, optional, default empty)
- Validation blocks save if required fields are missing or invalid.
- Save writes back to `scripts/ralph/tasks.json`.

### 2) Progress Viewer (progress.txt)
- Read `scripts/ralph/progress.txt` on load.
- Display in a read‑only view as plain text.
- Live updates when file changes.

### 3) Live File Watching
- Watch `tasks.json` and `progress.txt` for changes.
- If external changes are detected:
  - Tasks: if there are unsaved local edits, lock the editor and prompt the user to reload from disk.
  - Progress: refresh display automatically.

### 4) Ralph Runner
- UI control to run a user‑specified script.
- Default path suggestion: `scripts/ralph/run.sh`.
- Allow user to set the command (e.g., `scripts/ralph/run.sh`) in UI; store locally (not committed).
- Show running status and live log output.
- Support stop/terminate.
- Detect if a ralph process is already running (best‑effort) and show status.

### 5) Startup & CLI
- `npx ralphy` starts the Vite dev server on port 7257.
- On startup, print: `Access ralphy at http://localhost:7257/`
- Attempt to open the browser automatically.

## UX / UI
- Visual style: simple, sexy, dark.
- Layout:
  - Left: task list + details editor.
  - Right: progress view and ralph runner panel.
- Clear validation errors inline on the form.
- Minimal chrome, strong typography, dark palette.

## Technical Notes
- Offline only; no external network calls.
- Cross‑platform file watching (macOS + Linux).
- The dev server is Vite; add a lightweight local backend (Node) for file I/O and process management.

## Acceptance Criteria (v1)
- Running `npx ralphy` in a valid repo:
  - Starts server on 7257.
  - UI loads and reads tasks/progress from `scripts/ralph`.
- Editing tasks via form:
  - Validation blocks invalid save.
  - Save writes to disk correctly.
- Progress displays and updates on file changes.
- Ralph runner can start a user command and show logs.

## Open Questions
- None.
