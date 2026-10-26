import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const code=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/boot\(\);\s*$/,'');
function fixture(){
  const root={innerHTML:''},reply={value:'Rascunho preservado',dataset:{chatId:'c1'},addEventListener(){}};
  const c=vm.createContext({location:{protocol:'https:'},localStorage:{getItem:()=>null},setInterval(){},document:{querySelector:selector=>selector==='#root'?root:selector==='#reply'?reply:null,querySelectorAll:()=>[]}});
  new vm.Script(code).runInContext(c);vm.runInContext("state=seed();active='c1';",c);return{c,root};
}
test('painel interno separa cliente, fontes, pendências e histórico sem iniciar resposta automática',()=>{
  const {c,root}=fixture();
  vm.runInContext(`
    contextOpen.add('c1');contextCache.set('c1',{client_id:'test-client',client_name:'<Cliente>',clientUrl:'https://app.notion.com/p/test',kind:'andamento',mode:'human',summary:'Pedido <script>alert(1)</script>',missing:'Matrícula',next_step:'Conferir arquivo',history:[{id:'e1',summary:'Documento recebido',source:'Cliente',actor:'Contato',qualification:'Informado',created:Date.now(),sync_state:'pending'}],requests:[{id:'r1',title:'Verificar andamento',status:'Aguardando equipe',missing:'Conferência'}],integration:{enabled:false}});render();
  `,c);
  assert.match(root.innerHTML,/aria-label="Contexto interno do atendimento"/);assert.match(root.innerHTML,/&lt;Cliente&gt;/);assert.match(root.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(root.innerHTML,/<script>alert/);assert.match(root.innerHTML,/Aguardando equipe/);assert.match(root.innerHTML,/Na fila do Notion/);assert.match(root.innerHTML,/IA automática ainda não ativa/);
  assert.equal(vm.runInContext("replyDrafts.get('c1')",c),'Rascunho preservado');assert.equal(vm.runInContext("state.messages.filter(m=>m.direction==='out').length",c),1);
  vm.runInContext("active='c2';render();",c);assert.doesNotMatch(root.innerHTML,/Pedido &lt;script&gt;/);
});

test('edição de contexto conserva o vínculo com frente que não está na consulta parcial',async()=>{
  const {c}=fixture();
  vm.runInContext(`
    globalThis.form=null;loadContext=async()=>({version:4,kind:'documentos',work_id:'existing-work',summary:'Resumo',missing:'',next_step:'',snapshot:{sections:{works:{rows:[]}}}});
    modal=(title,content,button,callback)=>{form={title,content,callback};};
  `,c);await vm.runInContext('contextEdit()',c);
  assert.match(vm.runInContext('form.content',c),/value="existing-work" selected/);
});

test('referência do Notion abre a conversa indicada mesmo fora de 15 dias e não seleciona outro cliente quando ausente',async()=>{
  const {c,root}=fixture();
  vm.runInContext("state.messages.filter(m=>m.conversation_id==='c1').forEach(m=>m.created=Date.now()-20*86400000);state.conversations[0].status='closed';globalThis.loaded=state;api=async()=>loaded;requestedConversation='c1';",c);
  await vm.runInContext('refresh()',c);assert.equal(vm.runInContext('active',c),'c1');assert.equal(vm.runInContext('historyDays',c),0);assert.equal(vm.runInContext('filter',c),'closed');
  vm.runInContext("requestedConversation='not-existing';",c);await vm.runInContext('refresh()',c);
  assert.match(root.innerHTML,/Conversa não encontrada/);assert.doesNotMatch(root.innerHTML,/data-chat="c2"/);assert.equal(vm.runInContext('active',c),null);
});

test('diagnóstico fica disponível sem configuração e explica pendências sem liberar sincronização',()=>{
  const {c}=fixture();
  vm.runInContext("state.notion={enabled:false,activationPending:true,missing:['NOTION_CLIENTS_DATA_SOURCE_ID','NOTION_HISTORY_DATA_SOURCE_ID'],pendingEvents:0,uncertainEvents:0};",c);
  let card=vm.runInContext('notionConnectionCard()',c);
  assert.match(card,/id="verify-notion">Verificar configuração/);assert.match(card,/id="sync-notion" disabled/);assert.match(card,/NOTION_ENABLED=true/);assert.match(card,/NOTION_CLIENTS_DATA_SOURCE_ID/);assert.match(card,/NOTION_HISTORY_DATA_SOURCE_ID/);
  assert.doesNotMatch(card,/Credencial de acesso ausente/);
  vm.runInContext("state.notion.invalid=['NOTION_HISTORY_DATA_SOURCE_ID'];",c);card=vm.runInContext('notionConnectionCard()',c);assert.match(card,/Identificador de fonte inválido em NOTION_HISTORY_DATA_SOURCE_ID/);
  vm.runInContext("state.notion={enabled:true,activationPending:false,missing:[],pendingEvents:0,uncertainEvents:0};notionDiagnostic={accessVerified:true};",c);card=vm.runInContext('notionConnectionCard()',c);
  assert.match(card,/id="verify-notion">Verificar acesso ao Notion/);assert.match(card,/Acesso às bases principais do Notion conferido/);assert.doesNotMatch(card,/id="sync-notion" disabled/);
});
