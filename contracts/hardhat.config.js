require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();
module.exports={solidity:{version:'0.8.24',settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris'}},networks:{liteforge:{url:process.env.LITEFORGE_RPC_URL||'https://liteforge.rpc.caldera.xyz/http',chainId:4441,accounts:process.env.DEPLOYER_PRIVATE_KEY?[process.env.DEPLOYER_PRIVATE_KEY]:[]}},paths:{sources:'./contracts',tests:'./test',cache:'./cache',artifacts:'./artifacts'}};
