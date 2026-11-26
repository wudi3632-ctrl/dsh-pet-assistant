// Midline hysteresis avoids rapid direction changes while dragging.
export function faceCenter(petCenter,screenCenter,previous='right',margin=24){
  return petCenter<screenCenter-margin?'right':petCenter>screenCenter+margin?'left':previous;
}
export function mirrorMask(mask,size=32){return mask.map((_,i)=>mask[Math.floor(i/size)*size+size-1-i%size]);}
