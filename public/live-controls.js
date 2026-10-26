// Coalesce rapid edits without delaying the first change or dropping another attribute.
// Capture the target selection at input time; serialize sends so older responses
// cannot overtake newer edits. This module is also exercised by the Node tests.
export function createLiveControl(send, interval=33, onError=()=>{}) {
 const pending=new Map();let busy=false,timer=null;
 async function flush(){
  timer=null;if(busy||!pending.size)return;busy=true;
  const batch=[...pending.values()];pending.clear();
  try { for(const edit of batch)try{await send(edit.ids,edit.values)}catch(e){onError(e)} }
  finally {busy=false;if(pending.size&&!timer)timer=setTimeout(flush,interval)}
 }
 return (ids,values)=>{
  const key=JSON.stringify(ids),edit=pending.get(key)??{ids:[...ids],values:{}};
  Object.assign(edit.values,values);pending.set(key,edit);
  if(!busy&&!timer)void flush();
 };
}
