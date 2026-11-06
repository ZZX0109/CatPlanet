#!/usr/bin/env node
import fs from 'node:fs';
import { infer, validate, preview, publish, DEFAULT_ROOT } from './pipeline.mjs';
const [command,...args]=process.argv.slice(2);const options={root:DEFAULT_ROOT,dryRun:false};
try{
  const known=new Set(['--root','--request','--task','--confirm','--dry-run']);const seen=new Set();
  for(let i=0;i<args.length;i++){const key=args[i];if(!known.has(key)||seen.has(key))throw Error('Unknown/duplicate option: '+key);seen.add(key);if(key==='--dry-run')options.dryRun=true;else {if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing value: '+key);options[key.slice(2)]=args[++i];}}
  let result;
  if(command==='infer'){if(!options.request)throw Error('infer requires --request');if(fs.statSync(options.request).size>1024*1024)throw Error('Request exceeds 1 MiB');result=infer(JSON.parse(fs.readFileSync(options.request,'utf8')),options);}
  else if(['validate','preview','publish'].includes(command)){if(!options.task)throw Error(command+' requires --task');result={validate,preview,publish}[command](options.task,options);}
  else throw Error('Usage: node cat-modeling/cli.mjs infer --request request.json [--root dir] [--dry-run] | validate|preview|publish --task task-ID [--dry-run] [--confirm token]');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.valid===false)process.exitCode=1;
}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
