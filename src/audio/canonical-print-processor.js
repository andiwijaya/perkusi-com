/* global AudioWorkletProcessor, registerProcessor, currentFrame */
// prettier-ignore
class CanonicalPrint extends AudioWorkletProcessor {
 constructor(o){super();const p=o.processorOptions;this.left=p.left;this.right=p.right;this.origin=p.origin;this.from=p.from;this.end=p.origin+this.left.length-p.from;this.fade=null;this.sent=false;
 this.port.onmessage=({data})=>{if(data.type==='stop'){this.fade=data.start;this.end=Math.min(this.end,data.end);}};}
 process(_,outputs){const cs=outputs[0],n=cs[0].length;for(let i=0;i<n;i++){const frame=currentFrame+i,at=this.from+frame-this.origin;
 const gain=this.fade===null||frame<this.fade?1:this.end===this.fade?0:Math.max(0,(this.end-frame)/(this.end-this.fade));
 const active=frame>=this.origin&&frame<this.end&&at>=0&&at<this.left.length;cs[0][i]=active?this.left[at]*gain:0;cs[1][i]=active?this.right[at]*gain:0;}
 if(currentFrame+n>=this.end){if(!this.sent){this.sent=true;this.port.postMessage({type:'ended',frame:this.end});}return false;}return true;}}
registerProcessor("canonical-programme-print", CanonicalPrint);
