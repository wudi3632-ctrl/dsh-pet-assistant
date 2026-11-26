function clampPetPosition(x,y,area,pet){
  const minX=area.x-pet.x+4,maxX=area.x+area.width-pet.x-pet.width-4;
  const minY=area.y-pet.y+32,maxY=area.y+area.height-pet.y-pet.height-4;
  return {x:Math.round(Math.max(minX,Math.min(maxX,x))),y:Math.round(Math.max(minY,Math.min(maxY,y)))};
}
module.exports={clampPetPosition};
