const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./src/utils/index').logger; // Note: simplified import for main process

let serverProcess;

function startServer() {
  // Start the Express server using tsx for development or node for production
  const isProd = process.env.NODE_ENV === 'production';
  const command = isProd ? 'node' : 'npx';
  const args = isProd ? ['dist/server.cjs'] : ['tsx', 'server.ts'];

  serverProcess = spawn(command, args, {
    env: { ...process.env, PORT: 3000 },
    shell: true
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`Server Error: ${data}`);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'TrainEngine.ai - Cognitive Dataset Generator',
    autoHideMenuBar: true
  });

  // In dev mode, load from the Vite server. In prod, load the build index.html
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    win.loadFile(path.join(__dirname, 'dist/index.html'));
  } else {
    win.loadURL('http://localhost:3000');
  }

  win.on('closed', () => {
    app.quit();
  });
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
