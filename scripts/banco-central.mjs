// Local/Render Shell maintenance only. Never starts the Central or loads .env.
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {chmod,copyFile,mkdir,open,realpath,stat,statfs,unlink,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const tables=['agents','conversations','messages','service_events','ai_jobs'];
const fail=message=>{throw new Error(message);};
const counts=db=>Object.fromEntries(tables.map(name=>[name,
  db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
    ?db.prepare('SELECT COUNT(*) AS n FROM '+name).get().n:null]));
function verify(db,full=false){
  const rows=db.prepare(full?'PRAGMA integrity_check':'PRAGMA quick_check').all();
  if(rows.length!==1||Object.values(rows[0])[0]!=='ok')fail('A integridade SQLite não foi confirmada.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)fail('Há vínculos inconsistentes no banco.');
  return {integrity:'ok',counts:counts(db)};
}
async function sourcePath(databasePath){
  if(!databasePath||databasePath===':memory:')fail('Informe o caminho explícito de um banco existente.');
  const path=await realpath(resolve(databasePath));
  if(!(await stat(path)).isFile())fail('O caminho informado não é um arquivo de banco.');
  return path;
}
export async function inspectDatabase(databasePath){
  const path=await sourcePath(databasePath);
  const db=new DatabaseSync(path,{readOnly:true});
  try{
    const result=verify(db),disk=await statfs(dirname(path));
    const wal=await stat(path+'-wal').catch(error=>{if(error.code==='ENOENT')return {size:0};throw error;});
    return {...result,databasePath:path,databaseBytes:(await stat(path)).size,
      walBytes:wal.size,freeBytes:disk.bavail*disk.bsize,
      snapshotBytes:db.prepare('PRAGMA page_count').get().page_count*db.prepare('PRAGMA page_size').get().page_size};
  }finally{db.close();}
}
async function digest(path){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}
export async function backupDatabase(databasePath,backupDirectory){
  if(!backupDirectory)fail('Informe um diretório privado para o backup.');
  const before=await inspectDatabase(databasePath);
  await mkdir(resolve(backupDirectory),{recursive:true,mode:0o700});
  const directory=await realpath(resolve(backupDirectory));
  const disk=await statfs(directory);
  if(disk.bavail*disk.bsize<2*before.snapshotBytes+10*1024*1024)
    fail('Espaço insuficiente para backup e teste de recuperação.');
  const name='central-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
  const destination=join(directory,name+'.sqlite');
  const rehearsal=join(directory,name+'.restore-check.sqlite');
  const manifest=destination+'.json';
  // Reserve the unique destination without overwriting any existing backup.
  const file=await open(destination,'wx',0o600);await file.close();
  const db=new DatabaseSync(before.databasePath,{readOnly:true});
  try{await backup(db,destination);}finally{db.close();}
  await chmod(destination,0o600);
  let check;
  const copy=new DatabaseSync(destination);
  try{
    // The new backup is standalone; never change journal mode on the source.
    copy.exec('PRAGMA journal_mode=DELETE');
    check=verify(copy,true);
  }finally{copy.close();}
  // Rehearse recovery from the backup file alone, without the source WAL/SHM.
  await copyFile(destination,rehearsal,constants.COPYFILE_EXCL);
  await chmod(rehearsal,0o600);
  try{
    const restored=new DatabaseSync(rehearsal,{readOnly:true});
    try{
      const verified=verify(restored,true);
      if(JSON.stringify(verified.counts)!==JSON.stringify(check.counts))fail('A recuperação não preservou as contagens.');
    }finally{restored.close();}
  }finally{
    // Only this invocation's generated rehearsal file; backups are never removed.
    await unlink(rehearsal);
  }
  const result={createdAt:new Date().toISOString(),source:before.databasePath,
    backup:destination,backupBytes:(await stat(destination)).size,sha256:await digest(destination),
    ...check,restoreVerified:true,externalCopyVerified:false};
  await writeFile(manifest,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return {...result,manifest};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [action,...args]=process.argv.slice(2);
  try{
    if(!['inspecionar','backup'].includes(action)||args.length%2)fail('Uso: node banco-central.mjs inspecionar|backup --database CAMINHO [--backup-dir DIRETORIO]');
    const options={};
    for(let i=0;i<args.length;i+=2){
      if(!['--database','--backup-dir'].includes(args[i])||!args[i+1]||options[args[i]])fail('Argumentos inválidos.');
      options[args[i]]=args[i+1];
    }
    const path=options['--database']||process.env.DATABASE_PATH;
    const result=action==='inspecionar'?await inspectDatabase(path):await backupDatabase(path,options['--backup-dir']);
    console.log(JSON.stringify(result,null,2));
  }catch{
    console.error('Verificação/backup não concluído. Confira comando, caminho, integridade, permissões e espaço livre. Nenhum backup anterior foi substituído.');
    process.exitCode=1;
  }
}
