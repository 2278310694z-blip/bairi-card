/* Load inside a Tavern Helper iframe. Does not access arbitrary parent DOM. */
(function(root){
'use strict';
const state=new Map();const busyKeys=new Set();
function api(){const scope=root.TavernHelper||root; if(typeof scope.createChatMessages!=='function'||typeof scope.triggerSlash!=='function'||typeof scope.getChatMessages!=='function'||typeof (scope.getCurrentMessageId||root.getCurrentMessageId)!=='function')throw new Error('此页面未接通酒馆助手消息楼层API');return scope;}
root.HLBridge={
 async sendChoice(choice){
  const scope=api();
  if(!choice||typeof choice.text!=='string'||!choice.text.trim())throw new Error('无效选项');
  let currentId=null;
  try{currentId=(scope.getCurrentMessageId||root.getCurrentMessageId)();}catch{throw new Error('本页面不是消息楼层iframe，不能提交分支');}
  let existingChoice=false;
  if(currentId!==null&&typeof scope.getChatMessages==='function'){
   const latest=scope.getChatMessages(-1);
   if(latest.length&&latest[0].message_id!==currentId){
    const matching=latest[0].role==='user'&&latest[0].data?.hl_choice?.source===currentId&&latest[0].data?.hl_choice?.id===choice.id;
    if(!matching)throw new Error('这不是最新剧情，不能从旧楼层提交选择');
    existingChoice=true;
   }
  }
  const key=JSON.stringify([currentId,choice.opening,choice.route,choice.day,choice.id,choice.text]);
  const old=state.get(key);if(busyKeys.has(key))throw new Error('此选项正在提交');if(old==='done')return;
  const wasCreated=old==='created'||existingChoice;busyKeys.add(key);
  try{
   if(!wasCreated){
    const lead=choice.opening===2?'玩家选择':'澄野拓海的选择';
    await scope.createChatMessages([{role:'user',message:lead+'：'+choice.text,data:{hl_choice:{id:choice.id,route:choice.route,day:choice.day,opening:choice.opening,source:currentId}}}],{insert_before:'end',refresh:'affected'});
   }
   state.set(key,'created');
   await scope.triggerSlash('/trigger');state.set(key,'done');
  }finally{busyKeys.delete(key);}
 },
 available(){try{api();return true;}catch{return false;}}
};
})(globalThis);
