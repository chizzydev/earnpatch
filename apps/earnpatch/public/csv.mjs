import {sanitizeCsv} from './g25-engine.mjs';
export const LIMIT=200000;
export function parse(raw,delimiter=','){
 if(new TextEncoder().encode(raw).length>LIMIT)throw Error('Maximum CSV size is 200 KB');
 if(![',',';','\t'].includes(delimiter))throw Error('Unsupported delimiter');
 raw=raw.replace(/^\uFEFF/,'');let rows=[],row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<raw.length;i++){const c=raw[i];if(quoted){if(c==='"'){if(raw[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
 if(c==='"'&&!cell&&!closed)quoted=true;
 else if(c===delimiter){row.push(cell);cell='';closed=false;}
 else if(c==='\r'||c==='\n'){if(c==='\r'&&raw[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';closed=false;}
 else {if(closed||c==='"')throw Error('Malformed quoting');cell+=c;}
 if(rows.length>2001)throw Error('Maximum 2000 data rows');}
 if(quoted)throw Error('Unclosed quote');if(cell||row.length||closed){row.push(cell);rows.push(row);}
 if(rows.length<2||rows.length>2001||rows[0].length>60||rows[0].some(x=>!x.trim())||rows.some(r=>r.length!==rows[0].length))throw Error('CSV needs a consistent header, at most 2000 data rows and 60 columns');return rows;
}
export const serialize=rows=>rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
export function transform(raw,{delimiter=',',columns=[],patterns=true}={}){
 const rows=parse(raw,delimiter);let selected=0;
 for(const row of rows.slice(1))for(const i of columns){if(!Number.isInteger(i)||i<0||i>=row.length)throw Error('Invalid column');if(row[i]){row[i]='[REDACTED]';selected++;}}
 // Reuse G25's tested pattern engine; selected columns remain a user policy.
 let result=patterns?sanitizeCsv(serialize(rows)):{output:serialize(rows),summary:{redactedCells:0,formulaNeutralized:0}};
 const out=parse(result.output);let formulas=0;for(const row of out)for(let i=0;i<row.length;i++)if(/^[\s]*[=+@\-\t\r]/.test(row[i])){row[i]="'"+row[i];formulas++;}
 return {output:serialize(out),summary:{...result.summary,selectedRedactions:selected,formulaNeutralized:(result.summary.formulaNeutralized||0)+formulas,rows:rows.length-1,columns:rows[0].length}};
}
