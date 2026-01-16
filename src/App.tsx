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

const App = () => {
  const [progress, setProgress] = useState("Loading progress...");
  const [progressError, setProgressError] = useState<string | null>(null);
  const [tasksData, setTasksData] = useState<TaskBranch[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [locked, setLocked] = useState(false);
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

  const handleReload = () => {
    try {
      const parsed = JSON.parse(serverTasksRef.current) as TaskBranch[];
      setTasksData(parsed);
    } catch {
      setTasksData([]);
    }
    setDirty(false);
    setLocked(false);
  };

  const activeBranch = tasksData[0];
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

  return (
    <main className="app">
      <header className="app__header">
        <div>
          <h1>Ralphy</h1>
          <p className="app__subtitle">
            Watching scripts/ralph for tasks and progress changes.
          </p>
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
          <span className="panel__meta">
            {activeBranch ? `${activeBranch.userStories.length} stories` : ""}
          </span>
        </header>
        {locked ? (
          <div className="banner">
            External changes detected while you were editing.
            <button type="button" onClick={handleReload}>
              Reload from disk
            </button>
          </div>
        ) : null}
        {tasksError ? <p className="error">{tasksError}</p> : null}
        <div className="task-list">
          {activeBranch?.userStories?.length ? (
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
            <p className="empty">No stories loaded yet.</p>
          )}
        </div>
      </section>

      <section className="panel panel--editor">
        <header className="panel__header">
          <div>
            <h2>Story editor</h2>
            <p className="panel__subtitle">Form-based editing</p>
          </div>
          <span className="panel__meta">Details</span>
        </header>
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
          <p className="empty">Select a story to edit.</p>
        )}
      </section>

      <section className="panel panel--progress">
        <header className="panel__header">
          <h2>progress.txt</h2>
          <span className="panel__meta">Live view</span>
        </header>
        {progressError ? <p className="error">{progressError}</p> : null}
        <pre className="progress">{progress}</pre>
      </section>
    </main>
  );
};

export default App;
