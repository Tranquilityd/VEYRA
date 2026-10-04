import fs from 'node:fs/promises';
import postgres from 'postgres';
const url=process.env.DATABASE_URL;
if(!url)throw new Error('DATABASE_URL is required');
const sql=postgres(url,{max:1,ssl:'require',prepare:false});
try{await sql.unsafe(await fs.readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));console.log('Veyra schema applied');}
finally{await sql.end();}
