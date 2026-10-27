import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024});
const files=[...new Set(git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean))];
const banned=p=>/(^|\/)(node_modules|secrets|data|\.venv)(\/|$)/.test(p)||/(^|\/)\.env($|\.)/.test(p)&&!p.endsWith('.env.example')||/^evidence\//.test(p)&&p!=='evidence/README.md'||/\.(pem|key|p12|pfx|jks|keystore|sql|dump|bak)$/i.test(p);
let env='';try{env=readFileSync('.env','utf8');}catch{}
const secrets=env.split(/\r?\n/).filter(l=>/^(MODEL_API_KEY|API_TOKEN|POSTGRES_PASSWORD|COMEMR_PASSWORD|FHIR_BEARER_TOKEN)=/.test(l)).map(l=>l.slice(l.indexOf('=')+1).trim()).filter(v=>v.length>=8&&!/CHANGE_ME|GENERATE_/.test(v));
const findings=[];
for(const file of files){if(banned(file)){findings.push(file+': excluded material tracked or publishable');continue;}let text;try{text=readFileSync(file,'utf8');}catch{continue;}
 if(secrets.some(secret=>text.includes(secret)))findings.push(file+': matches a configured local secret');
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))findings.push(file+': private key material');
}
for(const commit of git('rev-list','--all').trim().split(/\s+/).filter(Boolean)){
 const paths=git('ls-tree','-r','--name-only',commit).trim().split('\n');
 for(const file of paths){if(banned(file))findings.push(commit.slice(0,8)+' '+file+': excluded material in history');const content=git('show',commit+':'+file);if(secrets.some(secret=>content.includes(secret)))findings.push(commit.slice(0,8)+' '+file+': configured secret in history');}
}
if(findings.length){console.error(findings.join('\n'));process.exitCode=1;}else console.log(`Checked ${files.length} publishable files and existing Git history: no excluded paths, configured local secrets or working-tree private keys found. This is a focused check, not a comprehensive security audit.`);
