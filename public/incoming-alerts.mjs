// Receipt cursor is independent of whether a human or the AI has already replied.
export function createIncomingAlerts({session,read,onEvents,baseline=()=>null,onReset=()=>{},onError=()=>{}}){
  let owner=null,cursor=null,busy=false,generation=0;
  function reset(){owner=null;cursor=null;generation++;onReset();}
  async function poll(){
    const current=session();
    if(!current){if(owner!==null)reset();return;}
    if(current!==owner){reset();owner=current;cursor=baseline();}
    if(busy)return;
    busy=true;const version=generation;
    try{
      const result=await read(cursor);
      if(version!==generation||session()!==owner)return;
      if(!Number.isSafeInteger(result.cursor)||!Array.isArray(result.events))throw Error('Avisos indisponíveis');
      const events=cursor===null||result.reset?[]:result.events.filter(e=>e.sequence>cursor);
      cursor=result.cursor;
      if(events.length)onEvents(events);
    }catch(error){if(version===generation)onError(error);}
    finally{busy=false;}
  }
  return{poll,reset};
}
