import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {backupDatabase,inspectDatabase} from '../scripts/banco-central.mjs';

test('backup inclui WAL ativo, recupera sem fonte e preserva copias anteriores',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'central-backup-test-'));
  const path=join(dir,'central.sqlite'),db=new DatabaseSync(path);
  t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE conversations(id TEXT PRIMARY KEY); CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT REFERENCES conversations(id),body TEXT); INSERT INTO conversations VALUES('test-conversation'); INSERT INTO messages VALUES('test-message','test-conversation','private-fixture');");
  assert.ok((await stat(path+'-wal')).size>0);
  const inspected=await inspectDatabase(path);
  assert.equal(inspected.counts.messages,1);
  assert.ok(!JSON.stringify(inspected).includes('private-fixture'));
  const copy=await backupDatabase(path,join(dir,'backups'));
  assert.equal(copy.restoreVerified,true);
  assert.equal(copy.externalCopyVerified,false);
  assert.equal(copy.counts.messages,1);
  assert.match(copy.sha256,/^[a-f0-9]{64}$/);
  const restored=new DatabaseSync(copy.backup,{readOnly:true});
  try{assert.equal(restored.prepare('SELECT body FROM messages').get().body,'private-fixture');}
  finally{restored.close();}
  const prior=await readFile(copy.backup);
  db.exec("INSERT INTO messages VALUES('test-message-2','test-conversation','next-private-fixture')");
  const second=await backupDatabase(path,join(dir,'backups'));
  assert.notEqual(second.backup,copy.backup);
  assert.equal(second.counts.messages,2);
  assert.deepEqual(await readFile(copy.backup),prior);
  assert.equal((await readdir(join(dir,'backups'))).some(name=>name.includes('restore-check')),false);
  assert.equal(JSON.parse(await readFile(copy.manifest,'utf8')).restoreVerified,true);
});

test('banco ausente, corrompido ou com vinculos quebrados nao gera backup valido',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'central-bad-backup-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await assert.rejects(inspectDatabase(join(dir,'missing.sqlite')));
  const path=join(dir,'corrupt.sqlite');await writeFile(path,'This is not SQLite');
  await assert.rejects(backupDatabase(path,join(dir,'backups')));
  const broken=join(dir,'broken.sqlite'),db=new DatabaseSync(broken);
  db.exec("PRAGMA foreign_keys=OFF; CREATE TABLE conversations(id TEXT PRIMARY KEY); CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT REFERENCES conversations(id)); INSERT INTO messages VALUES('orphan','absent')");
  db.close();
  await assert.rejects(backupDatabase(broken,join(dir,'backups')),/vínculos inconsistentes/);
  assert.deepEqual((await readdir(dir)).sort(),['broken.sqlite','corrupt.sqlite']);
});
