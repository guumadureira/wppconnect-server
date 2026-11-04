import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {createOperatorAI,operatorAICost} from '../operator-ai.mjs';
import {createOperatorChat} from '../operator-chat.mjs';
function setup(t,options={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let calls=0;
 const config={OPENAI_API_KEY:'fake-key',OPERATOR_AI_ENABLED:'true',AI_MONTHLY_BUDGET_USD:'5',AI_TOTAL_BUDGET_USD:'5'};
 const transport=async(url,o)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(JSON.parse(o.body).store,false);if(options.fail)throw Error('fake-key');return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:50},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Cadastro consultado.',suggestedReply:'Podemos verificar o andamento.'})}]}]});};
 const ai=createOperatorAI(db,config,transport,{usage:()=>({usedUsd:options.full?5:operatorAICost(db),usedTotalUsd:operatorAICost(db)}),validContext:()=>!options.invalid});
 return{db,ai,config,transport,calls:()=>calls};
}
const context={conversation:{id:randomUUID()},summary:'Em análise'};
test('assistente Central responde sem agente Notion, isola operador e não repete comando',async t=>{
 const f=setup(t),u={id:'u',signatureName:'Gustavo'},chat=createOperatorChat(f.db,f.config,f.transport,{centralAssistant:f.ai,conversationContext:async()=>context});
 const body={provider:'central',conversationId:context.conversation.id,message:'Atualize a situação',requestId:randomUUID()};
 const result=await chat.send(u,body);assert.equal(result.state,'completed');assert.equal(result.messages.at(-1).suggestedReply,'Podemos verificar o andamento.');
 assert.throws(()=>chat.view({id:'outro'},result.id),{status:404});await chat.send(u,body);assert.equal(f.calls(),1);assert.ok(operatorAICost(f.db)>0);
 await assert.rejects(chat.send(u,{...body,chatId:result.id,provider:'notion',requestId:randomUUID()}));await chat.close();
});
test('limite compartilhado e vínculo inválido impedem consumo',async t=>{
 for(const options of [{full:true},{invalid:true}]){const f=setup(t,options);await assert.rejects(f.ai.respond({requestId:randomUUID(),message:'Atualize',context}));assert.equal(f.calls(),0);}
});
test('falha incerta reserva consumo, oculta segredo e impede repetição',async t=>{
 const f=setup(t,{fail:true}),request={requestId:randomUUID(),message:'Atualize',context};
 await assert.rejects(f.ai.respond(request),e=>e.unknown&&!e.message.includes('fake-key'));assert.ok(operatorAICost(f.db)>0);
 await assert.rejects(f.ai.respond(request));assert.equal(f.calls(),1);
});
