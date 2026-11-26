// Local acknowledgement never invokes a model and never gates task dispatch.
export async function withTaskFeedback({run,acknowledge,current}) {
  const ack=Promise.resolve().then(acknowledge).catch(()=>{});
  try{
    const result=await run();
    await ack;
    return current()?result:null;
  }catch(error){await ack;throw error;}
}
