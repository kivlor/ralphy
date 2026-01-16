import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

type Timeout = ReturnType<typeof setInterval>;

const API_BASE = "http://localhost:7258/api";
const POLL_INTERVAL_MS = 2500;

type UserStory = {
  id: string;
  title: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  notes?: string;
};

type TaskBranch = {
  branchName: string;
  userStories: UserStory[];
};

const formatTasks = (data: TaskBranch[]) => JSON.stringify(data, null, 2);

const normalizeCriteria = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

const getNextStoryId = (stories: UserStory[]) => {
  const existing = new Set(
    stories.map((story) => story.id.trim()).filter(Boolean)
  );
  let prefix = "STORY";
  let width = 3;
  let max = 0;

  for (const story of stories) {
    const match = story.id.match(/^(.*?)-(\d+)$/);
    if (!match) {
      continue;
    }
    const [, candidatePrefix, candidateNumber] = match;
    if (!candidatePrefix) {
      continue;
    }
    if (prefix === "STORY") {
      prefix = candidatePrefix;
      width = candidateNumber.length;
    }
    if (candidatePrefix !== prefix) {
      continue;
    }
    const value = Number.parseInt(candidateNumber, 10);
    if (Number.isFinite(value)) {
      max = Math.max(max, value);
    }
  }

  let next = max + 1;
  let candidate = `${prefix}-${String(next).padStart(width, "0")}`;
  while (existing.has(candidate)) {
    next += 1;
    candidate = `${prefix}-${String(next).padStart(width, "0")}`;
  }
  return candidate;
};

const validateTasksData = (payload: TaskBranch[]) => {
  if (!Array.isArray(payload)) {
    return "Tasks must be an array.";
  }
  if (!payload.length) {
    return "No task branches loaded.";
  }
  for (const [index, entry] of payload.entries()) {
    if (!entry || typeof entry !== "object") {
      return `Branch ${index + 1} must be an object.`;
    }
    if (!entry.branchName.trim()) {
      return `Branch ${index + 1} needs a name.`;
    }
    if (!Array.isArray(entry.userStories)) {
      return `Branch ${index + 1} needs stories.`;
    }
    for (const [storyIndex, story] of entry.userStories.entries()) {
      const label = `Story ${index + 1}.${storyIndex + 1}`;
      if (!story.id.trim()) {
        return `${label} needs an ID.`;
      }
      if (!story.title.trim()) {
        return `${label} needs a title.`;
      }
      if (
        !Array.isArray(story.acceptanceCriteria) ||
        !story.acceptanceCriteria.some((item) => item.trim().length)
      ) {
        return `${label} needs at least one acceptance criterion.`;
      }
      if (!Number.isFinite(story.priority) || story.priority <= 0) {
        return `${label} priority must be positive.`;
      }
      if (typeof story.passes !== "boolean") {
        return `${label} requires a pass/fail value.`;
      }
    }
  }
  return null;
};

const App = () => {
  const [progress, setProgress] = useState("Loading progress...");
  const [progressError, setProgressError] = useState<string | null>(null);
  const [runnerCommand, setRunnerCommand] = useState("");
  const [runnerStatus, setRunnerStatus] = useState<{
    running: boolean;
    command: string | null;
    startedAt: string | null;
  }>({
    running: false,
    command: null,
    startedAt: null,
  });
  const [runnerLogs, setRunnerLogs] = useState<string[]>([]);
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const [runnerBusy, setRunnerBusy] = useState(false);
  const [tasksData, setTasksData] = useState<TaskBranch[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [locked, setLocked] = useState(false);
  const [saveState, setSaveState] = useState<{
    status: "idle" | "saving" | "success" | "error";
    message: string;
  }>({ status: "idle", message: "" });
  const pollingRef = useRef<Timeout | null>(null);
  const serverTasksRef = useRef("");
  const progressRef = useRef("");
  const dirtyRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const handleServerTasks = (next: string, parsed: TaskBranch[]) => {
    if (next === serverTasksRef.current) {
      return;
    }
    serverTasksRef.current = next;
    if (dirtyRef.current) {
      setLocked(true);
      return;
    }
    setTasksData(parsed);
    setDirty(false);
    setLocked(false);
    setSaveState({ status: "idle", message: "" });
    if (!selectedStoryId && parsed[0]?.userStories?.length) {
      setSelectedStoryId(parsed[0].userStories[0].id);
    }
  };

  const loadTasks = async () => {
    try {
      const response = await fetch(`${API_BASE}/tasks`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load tasks.json (${response.status})`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("tasks.json has an unexpected shape");
      }
      const formatted = formatTasks(data as TaskBranch[]);
      handleServerTasks(formatted, data as TaskBranch[]);
      setTasksError(null);
    } catch (error) {
      setTasksError(
        error instanceof Error ? error.message : "Failed to load tasks.json"
      );
    }
  };

  const loadProgress = async () => {
    try {
      const response = await fetch(`${API_BASE}/progress`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load progress.txt (${response.status})`);
      }
      const text = await response.text();
      if (text !== progressRef.current) {
        progressRef.current = text;
        setProgress(text);
      }
      setProgressError(null);
    } catch (error) {
      setProgressError(
        error instanceof Error ? error.message : "Failed to load progress.txt"
      );
    }
  };

  useEffect(() => {
    loadTasks();
    loadProgress();
    pollingRef.current = setInterval(() => {
      loadTasks();
      loadProgress();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const savedCommand = window.localStorage.getItem("ralphy-runner-command");
    if (savedCommand) {
      setRunnerCommand(savedCommand);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("ralphy-runner-command", runnerCommand);
  }, [runnerCommand]);

  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE}/runner/logs`);
    const handleStatus = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as {
          running: boolean;
          command: string | null;
          startedAt: string | null;
        };
        setRunnerStatus(payload);
      } catch {
        setRunnerError("Failed to parse runner status.");
      }
    };
    const handleLog = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { line: string };
        setRunnerLogs((prev) => {
          const next = [...prev, payload.line];
          if (next.length > 500) {
            return next.slice(-500);
          }
          return next;
        });
      } catch {
        setRunnerError("Failed to parse runner logs.");
      }
    };
    eventSource.addEventListener("status", handleStatus);
    eventSource.addEventListener("log", handleLog);
    eventSource.onopen = () => setRunnerError(null);
    eventSource.onerror = () =>
      setRunnerError("Runner log stream disconnected. Retrying...");

    return () => {
      eventSource.close();
    };
  }, []);

  const handleStartRunner = async () => {
    if (!runnerCommand.trim()) {
      setRunnerError("Enter a command before starting.");
      return;
    }
    setRunnerBusy(true);
    try {
      const response = await fetch(`${API_BASE}/runner/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: runnerCommand.trim() }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error ?? "Failed to start runner.");
      }
      setRunnerError(null);
    } catch (error) {
      setRunnerError(
        error instanceof Error ? error.message : "Failed to start runner."
      );
    } finally {
      setRunnerBusy(false);
    }
  };

  const handleStopRunner = async () => {
    setRunnerBusy(true);
    try {
      const response = await fetch(`${API_BASE}/runner/stop`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error ?? "Failed to stop runner.");
      }
      setRunnerError(null);
    } catch (error) {
      setRunnerError(
        error instanceof Error ? error.message : "Failed to stop runner."
      );
    } finally {
      setRunnerBusy(false);
    }
  };

  const handleReload = () => {
    try {
      const parsed = JSON.parse(serverTasksRef.current) as TaskBranch[];
      setTasksData(parsed);
    } catch {
      setTasksData([]);
    }
    setDirty(false);
    setLocked(false);
    setSaveState({ status: "idle", message: "" });
  };

  const activeBranch = tasksData[0];
  const hasStories = Boolean(activeBranch?.userStories?.length);
  const currentStory = useMemo(() => {
    if (!activeBranch) {
      return null;
    }
    return (
      activeBranch.userStories.find((story) => story.id === selectedStoryId) ||
      activeBranch.userStories[0] ||
      null
    );
  }, [activeBranch, selectedStoryId]);

  useEffect(() => {
    if (!currentStory && activeBranch?.userStories?.length) {
      setSelectedStoryId(activeBranch.userStories[0].id);
    }
  }, [currentStory, activeBranch]);

  const updateCurrentStory = (
    updater: (story: UserStory) => UserStory
  ) => {
    if (!activeBranch || !currentStory) {
      return;
    }
    const updated = tasksData.map((branch) => {
      if (branch.branchName !== activeBranch.branchName) {
        return branch;
      }
      return {
        ...branch,
        userStories: branch.userStories.map((story) =>
          story.id === currentStory.id ? updater(story) : story
        ),
      };
    });
    setTasksData(updated);
    setDirty(formatTasks(updated) !== serverTasksRef.current);
  };

  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    const parsed = normalizeCriteria(next);
    updateCurrentStory((story) => ({
      ...story,
      acceptanceCriteria: parsed,
    }));
  };

  const handleAddStory = () => {
    if (!activeBranch || locked) {
      return;
    }
    const nextId = getNextStoryId(activeBranch.userStories);
    const newStory: UserStory = {
      id: nextId,
      title: "New story",
      acceptanceCriteria: ["Define acceptance criteria"],
      priority: 1,
      passes: false,
      notes: "",
    };
    const updated = tasksData.map((branch) =>
      branch.branchName === activeBranch.branchName
        ? { ...branch, userStories: [...branch.userStories, newStory] }
        : branch
    );
    setTasksData(updated);
    setSelectedStoryId(nextId);
    setDirty(formatTasks(updated) !== serverTasksRef.current);
    setSaveState({ status: "idle", message: "" });
  };

  const validationError = useMemo(
    () => validateTasksData(tasksData),
    [tasksData]
  );

  const storyErrors = useMemo(() => {
    if (!currentStory) {
      return null;
    }
    return {
      id: currentStory.id.trim().length ? "" : "Required",
      title: currentStory.title.trim().length ? "" : "Required",
      acceptanceCriteria:
        currentStory.acceptanceCriteria.some((item) => item.trim().length)
          ? ""
          : "Add at least one acceptance criterion",
      priority:
        Number.isFinite(currentStory.priority) && currentStory.priority > 0
          ? ""
          : "Priority must be a positive number",
    };
  }, [currentStory]);

  const canSave =
    !locked &&
    dirty &&
    !validationError &&
    saveState.status !== "saving";

  const handleSave = async () => {
    const error = validateTasksData(tasksData);
    if (error) {
      setSaveState({ status: "error", message: error });
      return;
    }
    setSaveState({ status: "saving", message: "Saving..." });
    try {
      const response = await fetch(`${API_BASE}/tasks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: formatTasks(tasksData),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to save tasks.json.");
      }
      const formatted = formatTasks(tasksData);
      serverTasksRef.current = formatted;
      setDirty(false);
      setLocked(false);
      setSaveState({ status: "success", message: "Saved to tasks.json." });
    } catch (error) {
      setSaveState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Failed to save tasks.json.",
      });
    }
  };

  return (
    <main className="app">
      <header className="app__header">
        <div>
          <h1>Ralphy</h1>
          <p className="app__subtitle">
            Watching scripts/ralph for tasks and progress changes.
          </p>
          <ul className="app__guidance">
            <li>
              Start the API with <code>npm start</code> and keep it running.
            </li>
            <li>
              Use <code>npm run dev</code> to run this UI on port 7257.
            </li>
            <li>Pick a story, edit details, then save back to disk.</li>
          </ul>
        </div>
        <div className="app__status">
          <span className={dirty ? "status status--warn" : "status"}>
            {dirty ? "Unsaved edits" : "Synced"}
          </span>
          <span className={locked ? "status status--lock" : "status"}>
            {locked ? "Editor locked" : "Editor ready"}
          </span>
        </div>
      </header>

      <section className="panel panel--list">
        <header className="panel__header">
          <div>
            <h2>Tasks</h2>
            <p className="panel__subtitle">
              {activeBranch ? activeBranch.branchName : "No branch loaded"}
            </p>
          </div>
          <div className="panel__actions">
            <button
              type="button"
              className="panel__button"
              onClick={handleAddStory}
              disabled={!activeBranch || locked}
            >
              Add story
            </button>
            <span className="panel__meta">
              {activeBranch ? `${activeBranch.userStories.length} stories` : ""}
            </span>
          </div>
        </header>
        {locked ? (
          <div className="banner">
            External changes detected while you were editing.
            <button type="button" onClick={handleReload}>
              Reload from disk
            </button>
          </div>
        ) : null}
        {tasksError ? (
          <div className="empty-state">
            <p className="error">{tasksError}</p>
            <p className="empty">
              Ensure the API is running and{" "}
              <code>scripts/ralph/tasks.json</code> exists.
            </p>
          </div>
        ) : null}
        <div className="task-list">
          {hasStories ? (
            activeBranch.userStories.map((story) => (
              <button
                key={story.id}
                type="button"
                className={
                  story.id === currentStory?.id
                    ? "task-card task-card--active"
                    : "task-card"
                }
                onClick={() => setSelectedStoryId(story.id)}
                disabled={locked}
              >
                <div className="task-card__header">
                  <span className="task-card__id">{story.id}</span>
                  <span
                    className={
                      story.passes
                        ? "pill pill--pass"
                        : "pill pill--fail"
                    }
                  >
                    {story.passes ? "Pass" : "Pending"}
                  </span>
                </div>
                <p className="task-card__title">{story.title}</p>
                <div className="task-card__meta">
                  <span>Priority {story.priority}</span>
                  <span>{story.acceptanceCriteria.length} criteria</span>
                </div>
              </button>
            ))
          ) : (
            <p className="empty">
              No stories loaded yet. Waiting on{" "}
              <code>scripts/ralph/tasks.json</code>.
            </p>
          )}
        </div>
      </section>

      <section className="panel panel--editor">
        <header className="panel__header">
          <div>
            <h2>Story editor</h2>
            <p className="panel__subtitle">
              Form-based editing with inline validation.
            </p>
          </div>
          <div className="panel__actions">
            <button
              type="button"
              className="save-button"
              onClick={handleSave}
              disabled={!canSave}
            >
              {saveState.status === "saving" ? "Saving..." : "Save"}
            </button>
            <span
              className={
                saveState.status === "success"
                  ? "save-status save-status--success"
                  : saveState.status === "error"
                    ? "save-status save-status--error"
                    : "save-status"
              }
            >
              {saveState.message || "Details"}
            </span>
          </div>
        </header>
        {dirty && validationError ? (
          <p className="error">{validationError}</p>
        ) : null}
        {currentStory ? (
          <form className="editor" onSubmit={(event) => event.preventDefault()}>
            <label className="field">
              <span className="field__label">Story ID</span>
              <input
                type="text"
                value={currentStory.id}
                onChange={(event) =>
                  updateCurrentStory((story) => ({
                    ...story,
                    id: event.target.value,
                  }))
                }
                readOnly={locked}
              />
              {storyErrors?.id ? (
                <span className="field__error">{storyErrors.id}</span>
              ) : null}
            </label>
            <label className="field">
              <span className="field__label">Title</span>
              <input
                type="text"
                value={currentStory.title}
                onChange={(event) =>
                  updateCurrentStory((story) => ({
                    ...story,
                    title: event.target.value,
                  }))
                }
                readOnly={locked}
              />
              {storyErrors?.title ? (
                <span className="field__error">{storyErrors.title}</span>
              ) : null}
            </label>
            <label className="field field--textarea">
              <span className="field__label">Acceptance criteria</span>
              <textarea
                value={currentStory.acceptanceCriteria.join("\n")}
                onChange={handleDraftChange}
                readOnly={locked}
                spellCheck={false}
              />
              {storyErrors?.acceptanceCriteria ? (
                <span className="field__error">
                  {storyErrors.acceptanceCriteria}
                </span>
              ) : null}
            </label>
            <div className="field-row">
              <label className="field">
                <span className="field__label">Priority</span>
                <input
                  type="number"
                  min={1}
                  value={Number.isFinite(currentStory.priority) ? currentStory.priority : ""}
                  onChange={(event) =>
                    updateCurrentStory((story) => ({
                      ...story,
                      priority: Number(event.target.value),
                    }))
                  }
                  readOnly={locked}
                />
                {storyErrors?.priority ? (
                  <span className="field__error">{storyErrors.priority}</span>
                ) : null}
              </label>
              <label className="field">
                <span className="field__label">Passes</span>
                <select
                  value={currentStory.passes ? "true" : "false"}
                  onChange={(event) =>
                    updateCurrentStory((story) => ({
                      ...story,
                      passes: event.target.value === "true",
                    }))
                  }
                  disabled={locked}
                >
                  <option value="false">Pending</option>
                  <option value="true">Pass</option>
                </select>
              </label>
            </div>
            <label className="field field--textarea">
              <span className="field__label">Notes</span>
              <textarea
                value={currentStory.notes ?? ""}
                onChange={(event) =>
                  updateCurrentStory((story) => ({
                    ...story,
                    notes: event.target.value,
                  }))
                }
                readOnly={locked}
                spellCheck={false}
              />
            </label>
          </form>
        ) : (
          <p className="empty">
            {hasStories
              ? "Select a story to edit."
              : "Stories will appear here once tasks.json loads."}
          </p>
        )}
      </section>

      <section className="panel panel--progress">
        <header className="panel__header">
          <h2>progress.txt</h2>
          <span className="panel__meta">Live view</span>
        </header>
        {progressError ? (
          <div className="empty-state">
            <p className="error">{progressError}</p>
            <p className="empty">
              Create or update <code>scripts/ralph/progress.txt</code> to see
              updates here.
            </p>
          </div>
        ) : (
          <pre className="progress">{progress}</pre>
        )}
      </section>

      <section className="panel panel--runner">
        <header className="panel__header">
          <div>
            <h2>Runner</h2>
            <p className="panel__subtitle">Command launcher</p>
          </div>
          <span className="panel__meta">
            {runnerStatus.running ? "Running" : "Idle"}
          </span>
        </header>
        <div className="runner">
          <label className="field">
            <span className="field__label">Command</span>
            <input
              type="text"
              placeholder="npm run test"
              value={runnerCommand}
              onChange={(event) => setRunnerCommand(event.target.value)}
              disabled={runnerBusy || runnerStatus.running}
            />
          </label>
          <div className="runner__actions">
            <button
              type="button"
              className="runner__button runner__button--start"
              onClick={handleStartRunner}
              disabled={runnerBusy || runnerStatus.running}
            >
              Start
            </button>
            <button
              type="button"
              className="runner__button runner__button--stop"
              onClick={handleStopRunner}
              disabled={runnerBusy || !runnerStatus.running}
            >
              Stop
            </button>
            <div className="runner__status">
              <span className="runner__status-label">Status</span>
              <span
                className={
                  runnerStatus.running
                    ? "runner__status-pill runner__status-pill--active"
                    : "runner__status-pill"
                }
              >
                {runnerStatus.running ? "Running" : "Stopped"}
              </span>
            </div>
          </div>
          {runnerStatus.startedAt ? (
            <div className="runner__meta">
              Started{" "}
              {new Date(runnerStatus.startedAt).toLocaleString()}
            </div>
          ) : null}
          {runnerError ? <p className="error">{runnerError}</p> : null}
          <div className="runner__logs">
            {runnerLogs.length ? (
              <pre className="runner__log-text">
                {runnerLogs.join("\n")}
              </pre>
            ) : (
              <p className="empty">
                No logs yet. Start a command to stream output.
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
};

export default App;
