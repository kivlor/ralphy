#!/usr/bin/env node

const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");

const vitePkgPath = require.resolve("vite/package.json");
const vitePkg = require(vitePkgPath);
const binRel =
  typeof vitePkg.bin === "string" ? vitePkg.bin : vitePkg.bin?.vite;

if (!binRel) {
  console.error("Could not find Vite binary in vite/package.json");
  process.exit(1);
}

const viteBin = path.join(path.dirname(vitePkgPath), binRel);
const args = [
  "--port",
  "7257",
  "--logLevel",
  "error",
  "--clearScreen",
  "false",
];

const apiPort = Number.parseInt(process.env.RALPHY_API_PORT ?? "", 10) || 7258;
const ralphDir = path.resolve(process.cwd(), "scripts/ralph");
const tasksPath = path.join(ralphDir, "tasks.json");
const progressPath = path.join(ralphDir, "progress.txt");

const logClients = new Set();
const logBuffer = [];
const maxLogLines = 500;
let runner = null;
let shutdownRequested = false;

const appendLog = (chunk) => {
  if (!chunk) return;
  const lines = chunk.toString().split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    logBuffer.push(line);
    if (logBuffer.length > maxLogLines) {
      logBuffer.shift();
    }
    broadcastEvent("log", { line });
  }
};

const broadcastEvent = (event, payload) => {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of logClients) {
    res.write(message);
  }
};

const sendJson = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
};

const sendText = (res, status, body) => {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });

const validateTasks = (payload) => {
  if (!Array.isArray(payload)) {
    return "tasks.json must be an array";
  }
  for (const [index, entry] of payload.entries()) {
    if (!entry || typeof entry !== "object") {
      return `Entry ${index} must be an object`;
    }
    if (typeof entry.branchName !== "string" || !entry.branchName.trim()) {
      return `Entry ${index} requires branchName`;
    }
    if (!Array.isArray(entry.userStories)) {
      return `Entry ${index} requires userStories array`;
    }
    for (const [storyIndex, story] of entry.userStories.entries()) {
      if (!story || typeof story !== "object") {
        return `Story ${index}.${storyIndex} must be an object`;
      }
      if (typeof story.id !== "string" || !story.id.trim()) {
        return `Story ${index}.${storyIndex} requires id`;
      }
      if (typeof story.title !== "string" || !story.title.trim()) {
        return `Story ${index}.${storyIndex} requires title`;
      }
      if (
        !Array.isArray(story.acceptanceCriteria) ||
        story.acceptanceCriteria.some((item) => typeof item !== "string")
      ) {
        return `Story ${index}.${storyIndex} requires acceptanceCriteria array`;
      }
      if (typeof story.priority !== "number") {
        return `Story ${index}.${storyIndex} requires priority number`;
      }
      if (typeof story.passes !== "boolean") {
        return `Story ${index}.${storyIndex} requires passes boolean`;
      }
    }
  }
  return null;
};

const runnerStatus = () => ({
  running: Boolean(runner?.child),
  command: runner?.command ?? null,
  args: runner?.args ?? null,
  startedAt: runner?.startedAt ?? null,
});

const startRunner = ({ command, args, cwd }) => {
  if (runner?.child) {
    return { error: "Runner already active" };
  }
  if (typeof command !== "string" || !command.trim()) {
    return { error: "command is required" };
  }
  const spawnArgs = Array.isArray(args) ? args : [];
  const spawnCwd = typeof cwd === "string" && cwd.trim() ? cwd : process.cwd();
  const useShell = spawnArgs.length === 0;

  const child = spawn(command, spawnArgs, {
    cwd: spawnCwd,
    env: process.env,
    shell: useShell,
    stdio: ["ignore", "pipe", "pipe"],
  });

  runner = {
    child,
    command,
    args: spawnArgs,
    startedAt: new Date().toISOString(),
  };

  appendLog(`> ${command} ${spawnArgs.join(" ")}`.trim());
  broadcastEvent("status", runnerStatus());

  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);
  child.on("exit", (code, signal) => {
    appendLog(`[process exited code=${code ?? "null"} signal=${signal ?? "null"}]`);
    runner = null;
    broadcastEvent("status", runnerStatus());
  });
  child.on("error", (error) => {
    appendLog(`[process error] ${error.message}`);
  });

  return { ok: true };
};

const stopRunner = () => {
  if (!runner?.child) {
    return { error: "Runner is not active" };
  }
  const child = runner.child;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }, 5000);
  return { ok: true };
};

const apiServer = http.createServer(async (req, res) => {
  if (!req.url) {
    sendText(res, 404, "Not found");
    return;
  }

  const { method } = req;
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${apiPort}`);
  if (method === "GET" && url.pathname === "/api/tasks") {
    try {
      const raw = await fs.readFile(tasksPath, "utf-8");
      const data = JSON.parse(raw);
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (method === "PUT" && url.pathname === "/api/tasks") {
    try {
      const payload = await readJsonBody(req);
      const error = validateTasks(payload);
      if (error) {
        sendJson(res, 400, { error });
        return;
      }
      const formatted = `${JSON.stringify(payload, null, 2)}\n`;
      await fs.writeFile(tasksPath, formatted, "utf-8");
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (method === "GET" && url.pathname === "/api/progress") {
    try {
      const raw = await fs.readFile(progressPath, "utf-8");
      sendText(res, 200, raw);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (method === "GET" && url.pathname === "/api/runner/status") {
    sendJson(res, 200, runnerStatus());
    return;
  }

  if (method === "GET" && url.pathname === "/api/runner/logs") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`event: status\ndata: ${JSON.stringify(runnerStatus())}\n\n`);
    for (const line of logBuffer) {
      res.write(`event: log\ndata: ${JSON.stringify({ line })}\n\n`);
    }
    logClients.add(res);
    req.on("close", () => {
      logClients.delete(res);
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/runner/start") {
    try {
      const payload = await readJsonBody(req);
      const result = startRunner(payload ?? {});
      if (result.error) {
        sendJson(res, 409, result);
        return;
      }
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/runner/stop") {
    const result = stopRunner();
    if (result.error) {
      sendJson(res, 409, result);
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  sendText(res, 404, "Not found");
});

apiServer.listen(apiPort, () => {
  console.log(`RALPHY API listening on http://localhost:${apiPort}`);
});

const shutdown = () => {
  if (shutdownRequested) return;
  shutdownRequested = true;
  apiServer.close();
  if (runner?.child) {
    runner.child.kill("SIGTERM");
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Access ralphy at http://localhost:7257/");
console.log(`Backend API at http://localhost:${apiPort}/api`);

const child = spawn(process.execPath, [viteBin, ...args], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
