import crypto from 'node:crypto';
import { promisify } from 'node:util';
const password=process.argv[2];
if(!password||password.length<14)throw new Error('Pass a password of at least 14 characters');
const salt=crypto.randomBytes(16),scrypt=promisify(crypto.scrypt);
const key=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
console.log(`${salt.toString('hex')}:${Buffer.from(key).toString('hex')}`);
