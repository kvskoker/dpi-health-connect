import { spawn } from 'node:child_process';
const base = 'http://127.0.0.1:4310';
const response = await fetch(`${base}/workbench/ticket`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.API_TOKEN}` } });
if (!response.ok) throw new Error('Workbench is unavailable. Start the Docker stack first.');
const { ticket } = await response.json() as { ticket: string };
const url = `${base}/session/open?ticket=${ticket}`;
spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`], { windowsHide: true, stdio: 'ignore' }).unref();
console.log('Opened the local workbench using a one-time sign-in link.');
