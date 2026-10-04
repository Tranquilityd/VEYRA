const fs=require('node:fs');const path=require('node:path');
const artifact=require('../artifacts/contracts/VeyraCasino.sol/VeyraCasino.json');
const output=path.resolve(__dirname,'../../config/abi/VeyraCasino.json');
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify({contractName:'VeyraCasino',abi:artifact.abi},null,2)+'\n');
console.log('Generated ABI:',output);
