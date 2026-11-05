import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const start=html.indexOf('function contextPanel(c){');
const finish=html.indexOf('async function contextEdit()',start);
assert.ok(start>=0&&finish>start,'A rotina de exibição da conversa deve estar presente');
const component=html.slice(start,finish);

function banner(mode,cachedMode,enabled=true){
  const env={
    contextCache:new Map([['internal-test',{mode:cachedMode}]]),
    contextOpen:new Set(),
    state:{contexts:[{conversation_id:'internal-test',mode}],ai:{enabled}},
    localMode:false,
    esc:value=>String(value)
  };
  return runInNewContext(component+"\ncontextPanel({id:'internal-test'})",env);
}

test('interface prioriza modo humano atual mesmo quando cache antigo diz assistência liberada',()=>{
  const result=banner('human','assisted');
  assert.match(result,/Atendimento humano · IA pausada nesta conversa/);
  assert.doesNotMatch(result,/Assistência liberada/);
  assert.match(result,/id="release-assistance"/);
});

test('interface mostra assistência somente quando o modo atualizado permite',()=>{
  const result=banner('assisted','human');
  assert.match(result,/Assistência liberada · Piloto de IA habilitado/);
  assert.doesNotMatch(result,/IA pausada nesta conversa/);
  assert.doesNotMatch(result,/id="release-assistance"/);
});

test('modo assistido com piloto indisponível é descrito sem prometer resposta',()=>{
  const result=banner('assisted','assisted',false);
  assert.match(result,/Assistência liberada · IA automática indisponível/);
});
