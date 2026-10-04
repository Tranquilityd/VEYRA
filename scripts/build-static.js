import fs from 'node:fs/promises';
const out=new URL('../static-site/',import.meta.url);
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
for(const name of ['index.html','404.html','manifest.webmanifest','styles','assets','src','admin'])await fs.cp(new URL(`../${name}`,import.meta.url),new URL(name,out),{recursive:true});
// NEXT_PUBLIC_* is intentionally public. Inject only public provider configuration;
// verification secrets remain exclusively in Vercel server functions.
const publicEnvFile=new URL('src/config/publicEnv.js',out);
const escape=value=>String(value||'').replaceAll('\\','\\\\').replaceAll("'","\\'");
const publicEnv=await fs.readFile(publicEnvFile,'utf8');
await fs.writeFile(publicEnvFile,publicEnv
 .replace('__VEYRA_TURNSTILE_SITE_KEY__',escape(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY))
 .replace('__VEYRA_HCAPTCHA_SITE_KEY__',escape(process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY))
 .replace('__VEYRA_SITE_ENTRY_CAPTCHA_PROVIDER__',escape(process.env.NEXT_PUBLIC_SITE_ENTRY_CAPTCHA_PROVIDER||'turnstile')));
console.log('Veyra public static assets prepared');
