import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../pandora-app', import.meta.url));
let preview;
try {
  if (!process.env.PANDORA_URL) {
    preview = spawn(process.execPath, ['server.mjs'], {cwd:app,env:{...process.env,PANDORA_PORT:'5173'},stdio:['ignore','pipe','inherit']});
    await new Promise((resolve,reject) => {
      const timeout=setTimeout(()=>reject(new Error('Preview did not start')),10000);
      preview.once('error',reject);
      preview.once('exit',code=>{clearTimeout(timeout);reject(new Error('Preview exited: '+code));});
      preview.stdout.on('data',chunk=>{if(chunk.toString().includes('Pandora is ready')) {clearTimeout(timeout);resolve();}});
    });
  }
  for (const script of ['tests/ui.smoke.mjs','tests/ui.layout.smoke.mjs','tests/calendar.ui.mjs','tests/calendar-auto.ui.mjs','tests/personal.ui.mjs',
    'tests/workspace.ui.mjs','tests/task-tags.ui.mjs','tests/mobile-details.ui.mjs','tests/scheduling.ui.mjs','tests/todo-sync.ui.mjs','tests/session.ui.mjs','tests/reliability.ui.mjs','tests/directory.ui.mjs','tests/reviewers.ui.mjs','../web-admin/tests/admin.ui.mjs']) {
    console.log('\nRunning '+script);
    const code = await new Promise((resolve,reject)=> {
      const child=spawn(process.execPath,[script],{cwd:app,stdio:'inherit'});
      child.once('error',reject);child.once('exit',resolve);
    });
    if (code!==0) throw new Error(script+' failed: '+code);
  }
} finally {preview?.kill();}
