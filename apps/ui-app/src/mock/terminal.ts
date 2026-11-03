import type { MockSocketConnection } from '../platform/mock-transport';

export function connectTerminal(_url: URL, emit: (text: string) => void): MockSocketConnection {
  let line = ''; let greeted = false;
  const prompt = 'demo@lab:~$ ';
  const outputs: Record<string, string> = {
    whoami: 'labuser', pwd: '/home/labuser', id: 'uid=1000(labuser) gid=1000(labuser) groups=1000(labuser)', uname: 'Linux lab 6.8.0-demo x86_64', ls: 'notes.txt  scans/  reports/',
    help: 'Demo shell: whoami, pwd, id, uname, ls, date, clear. Other commands print a fake failure.',
  };
  function runLine(command: string): void {
    if (command === 'clear') emit('\u001b[2J\u001b[H');
    else if (command === 'date') emit(new Date().toString() + '\r\n');
    else if (outputs[command]) emit(outputs[command] + '\r\n');
    else if (command) emit('bash: ' + command.split(' ')[0] + ': command not found (demo shell)\r\n');
    emit(prompt);
  }
  return {
    send(data) {
      if (!greeted && data === '') { greeted = true; emit('Welcome to the Raptix demo terminal (no real shell).\r\n' + prompt); return; }
      try { const value: unknown = JSON.parse(data); if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'resize') return; } catch { /* plain keystrokes */ }
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') { emit('\r\n'); runLine(line.trim()); line = ''; }
        else if (ch === '\u007f') { if (line.length) { line = line.slice(0, -1); emit('\b \b'); } }
        else { line += ch; emit(ch); }
      }
    },
    close() { line = ''; },
  };
}
