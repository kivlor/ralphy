import { useEffect, useRef, useState, type ChangeEvent } from "react";

type Timeout = ReturnType<typeof setInterval>;

const API_BASE = "http://localhost:7258/api";
const POLL_INTERVAL_MS = 2500;

const formatTasks = (data: unknown) => JSON.stringify(data, null, 2);

const App = () => {
  const [progress, setProgress] = useState("Loading progress...");
  const [progressError, setProgressError] = useState<string | null>(null);
  const [draftTasks, setDraftTasks] = useState("");
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

  const handleServerTasks = (next: string) => {
    if (next === serverTasksRef.current) {
      return;
    }
    serverTasksRef.current = next;
    if (dirtyRef.current) {
      setLocked(true);
      return;
    }
    setDraftTasks(next);
  };

  const loadTasks = async () => {
    try {
      const response = await fetch(`${API_BASE}/tasks`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load tasks.json (${response.status})`);
      }
      const data = await response.json();
      const formatted = formatTasks(data);
      handleServerTasks(formatted);
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

  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setDraftTasks(next);
    setDirty(next !== serverTasksRef.current);
  };

  const handleReload = () => {
    setDraftTasks(serverTasksRef.current);
    setDirty(false);
    setLocked(false);
  };

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

      <section className="panel">
        <header className="panel__header">
          <h2>tasks.json</h2>
          <span className="panel__meta">Editor</span>
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
        <textarea
          className="editor"
          value={draftTasks}
          onChange={handleDraftChange}
          readOnly={locked}
          spellCheck={false}
        />
      </section>

      <section className="panel">
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
