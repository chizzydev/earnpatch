/**
 * SafeShare Export — deterministic commercial feature contributed to EarnPatch.
 * Works on customer-support CSV; anonymizes common structured identifiers, produces
 * a downloadable CSV plus an explanation and counts. Not a comprehensive DLP tool.
 */
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\w)(?:\+?\d[\d\s().-]{8,}\d)(?!\w)/g;
const API_KEY = /\b(?:sk[_-](?:live|test)[_-][A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/gi;
const URL_CREDENTIAL = /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;]+/gi;
const IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const riskNames = [
  ['ACCESS_TOKEN',BEARER],['API_KEY',API_KEY],['SECRET_FIELD',URL_CREDENTIAL],
  ['EMAIL',EMAIL],['PHONE_CANDIDATE',PHONE],['IP_ADDRESS',IP],
];
export const LIMIT_BYTES = 200_000;
export const MAX_ROWS = 2000;
export function parseCsv(input){
  if(typeof input!=='string'||new TextEncoder().encode(input).length>LIMIT_BYTES)throw Error('INPUT_TOO_LARGE');
  const result=[];let row=[],value='',quote=false;
  for(let i=0;i<input.length;i++){
    let c=input[i];
    if(quote){if(c==='"'){if(input[i+1]==='"'){value+='"';i++;}else quote=false;}else value+=c;continue;}
    if(c==='"'){if(value!=='')throw Error('MALFORMED_QUOTE');quote=true;}
    else if(c===','){row.push(value);value='';}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&input[i+1]==='\n')i++;row.push(value);result.push(row);row=[];value='';if(result.length>MAX_ROWS+1)throw Error('TOO_MANY_ROWS');}
    else value+=c;
  }
  if(quote)throw Error('UNCLOSED_QUOTE');
  if(row.length||value!==''){row.push(value);result.push(row);}
  return result;
}
function csvCell(input){const s=String(input);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
export function toCsv(rows){return rows.map(r=>r.map(csvCell).join(',')).join('\r\n');}
const sensitiveHeader = /(?:^|[_\s-])(?:name|first.?name|last.?name|customer|user.?id|email|phone|mobile|address|dob|birth|ssn|passport|card.?number|iban|account.?number)(?:$|[_\s-])/i;
function avoidSpreadsheetInjection(v){return /^[\s]*[=+@\-\t\r]/.test(v)?"'"+v:v;}
export function sanitizeCsv(raw){
  const rows=parseCsv(raw);if(rows.length<2)throw Error('CSV_NEEDS_HEADER_AND_DATA');
  const width=rows[0].length;
  if(width<1||width>60)throw Error('INVALID_COLUMN_COUNT');
  if(rows.length-1>MAX_ROWS)throw Error('TOO_MANY_ROWS');
  if(rows.some(r=>r.length!==width))throw Error('RAGGED_CSV');
  if(rows[0].some(c=>!c.trim()))throw Error('EMPTY_HEADER');
  let counts=Object.fromEntries(riskNames.map(([name])=>[name,0]));
  let scrubbedCells=0, formulaNeutralized=0, sensitiveColumns=[];
  const out=[rows[0].map(avoidSpreadsheetInjection)];
  for(let j=0;j<width;j++)if(sensitiveHeader.test(rows[0][j]))sensitiveColumns.push(rows[0][j]);
  for(let i=1;i<rows.length;i++){
    out.push(rows[i].map((cell,j)=>{
      let s=cell;let changed=false;
      if(sensitiveHeader.test(rows[0][j])){
        if(s.trim()){s='[REDACTED: COLUMN]';changed=true;counts.SECRET_FIELD+=0;}
      }else{
        for(const [tag,rule] of riskNames){rule.lastIndex=0;s=s.replace(rule,match=>{counts[tag]++;changed=true;return `[REDACTED: ${tag}]`;});}
      }
      if(changed)scrubbedCells++;
      const safe=avoidSpreadsheetInjection(s);if(safe!==s)formulaNeutralized++;
      return safe;
    }));
  }
  const detected=Object.values(counts).reduce((a,b)=>a+b,0);
  return {output:toCsv(out),summary:{rowsProcessed:rows.length-1,columns:width,flaggedPatterns:detected,
    redactedCells:scrubbedCells,sensitiveColumns,patterns:counts,formulaNeutralized,
    limitations:'Pattern-based prototype. May miss sensitive data or redact benign values; review before sharing.'}};
}

