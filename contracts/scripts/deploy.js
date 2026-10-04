require('dotenv').config();
const hre=require('hardhat');
async function main(){
 const network=await hre.ethers.provider.getNetwork();
 if(network.chainId!==4441n)throw new Error(`Refusing deployment: expected LiteForge chain 4441, got ${network.chainId}`);
 const [deployer]=await hre.ethers.getSigners();
 const owner=process.env.CONTRACT_OWNER_ADDRESS;
 const signer=process.env.AUTHORIZATION_SIGNER_ADDRESS;
 if(!owner||!hre.ethers.isAddress(owner))throw new Error('CONTRACT_OWNER_ADDRESS is required');
 if(!signer||!hre.ethers.isAddress(signer))throw new Error('AUTHORIZATION_SIGNER_ADDRESS is required');
 console.log('Deploying VeyraCasino to LitVM LiteForge Testnet (chain 4441)');
 console.log('Deployer:',deployer.address,'Owner:',owner,'Authorization signer:',signer);
 const Factory=await hre.ethers.getContractFactory('VeyraCasino');
 const contract=await Factory.deploy(owner,signer);
 await contract.waitForDeployment();
 console.log('VeyraCasino:',await contract.getAddress());
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
