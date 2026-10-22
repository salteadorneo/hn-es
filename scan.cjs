const fs=require('fs');
const s=fs.readFileSync('C:/Users/mox/Documents/hn/src/pages/index.astro','utf8');
const lines=s.split(/\n/);
lines.forEach((l,i)=>{ if(l.includes('function render')) console.log(i+1, l.trim()); });