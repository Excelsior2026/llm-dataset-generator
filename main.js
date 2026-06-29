const { app, BrowserWindow } = require("electron");
const { fork, spawn } = require("child_process");
const path = require("path");

let mainWindow = null;
let serverProcess = null;

const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== "production" && !app.isPackaged;

function startServer() {
  return new Promise((resolve, reject) => {
    if (isDev) {
      serverProcess = spawn("npx", ["tsx", "server.ts"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PORT: String(PORT) },
      });
    } else {
      serverProcess = fork(path.join(__dirname, "dist", "server.cjs"), [], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PORT: String(PORT) },
      });
    }

    const timeout = setTimeout(() => {
      resolve();
    }, 8000);

    serverProcess.stdout.on("data", (data) => {
      const text = data.toString();
      console.log(text.trim());
      if (text.includes("Server running")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.stderr.on("data", (data) => {
      console.error(data.toString().trim());
    });

    serverProcess.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0 && !mainWindow) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "LLM Dataset Generator",
    webPreferences: {
      preload: path.join(__dirname, "electron", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Prevent navigation to external URLs (security)
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) {
      event.preventDefault();
    }
  });

  // Open external links in the default browser, not inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      require("electron").shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Set Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob:; " +
          "connect-src 'self' ws://localhost:* http://localhost:*; " +
          "font-src 'self' data:;"
        ],
      },
    });
  });

  const url = `http://localhost:${PORT}`;
  mainWindow.loadURL(url);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
  } catch (err) {
    console.error("Failed to start server:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
