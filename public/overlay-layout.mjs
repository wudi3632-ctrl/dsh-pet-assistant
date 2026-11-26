const clamp=(n,a,b)=>Math.max(a,Math.min(Math.max(a,b),n));
export function panelLayout(pet,viewport,bubble,task,badge){
  const margin=8,left=viewport.left+margin,top=viewport.top+margin,right=viewport.right-margin,bottom=viewport.bottom-margin;
  const bubbleWidth=Math.min(bubble.width,Math.max(100,right-left));
  const above=pet.y+pet.height+10+bubble.height>bottom;
  const bubbleY=above?pet.y-bubble.height-badge.height-24:pet.y+pet.height+10;
  const onLeft=pet.x+pet.width+12+task.width>right;
  return {
    bubble:{x:clamp(pet.x+pet.width/2-bubbleWidth/2,left,right-bubbleWidth),y:clamp(bubbleY,top,bottom-bubble.height),width:bubbleWidth,above},
    task:{x:clamp(onLeft?pet.x-task.width-12:pet.x+pet.width+12,left,right-task.width),y:clamp(pet.y+26,top,bottom-task.height)},
    badge:{x:clamp(pet.x+pet.width/2-badge.width/2,left,right-badge.width),y:clamp(pet.y-badge.height-8,top,bottom-badge.height)}
  };
}
