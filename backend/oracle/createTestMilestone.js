'use strict';
require('dotenv').config();
const { ethers } = require('ethers');

const ABI = [
  'function createMilestone(address freelancer, bytes32 milestoneHash, uint256 deadline) external returns (uint256)',
  'function fundMilestone(uint256 milestoneId) external payable',
  'function getTotalMilestones() external view returns (uint256)',
  'function getMilestone(uint256 milestoneId) external view returns (tuple(address client, address freelancer, bytes32 milestoneHash, uint256 deadline, uint256 amount, bytes32 evidenceHash, string ipfsCID, uint256 score, string verdict, uint8 state, uint256 createdAt, uint256 fundedAt, uint256 submittedAt, uint256 resolvedAt))',
];

async function main() {
  const provider  = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC_URL);
  const signer     = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider); // client = deployer 0xa1E107...
  const escrow    = new ethers.Contract(process.env.ESCROW_CONTRACT_ADDRESS, ABI, signer);

  const freelancer    = '0xb85528a61D5bE6e1e640e4a38F1232e7971c67EA'; // your oracle/freelancer address
  const milestoneHash = ethers.keccak256(ethers.toUtf8Bytes('fibonacci-calculator-milestone-42'));
  const deadline      = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days from now
  const fundAmount    = ethers.parseEther('0.001'); // 0.001 Sepolia ETH

  console.log('Creating milestone...');
  const createTx = await escrow.createMilestone(freelancer, milestoneHash, deadline);
  const createReceipt = await createTx.wait(1);
  console.log('✅ Milestone created — tx:', createReceipt.hash);

  // Get the new milestone ID
  const total = await escrow.getTotalMilestones();
  const milestoneId = Number(total) - 1;
  console.log('   Milestone ID:', milestoneId);

  console.log('Funding milestone with 0.001 ETH...');
  const fundTx = await escrow.fundMilestone(milestoneId, { value: fundAmount });
  const fundReceipt = await fundTx.wait(1);
  console.log('✅ Milestone funded — tx:', fundReceipt.hash);

  console.log('\n📋 Now run:');
  console.log(`   node submitWork.js --milestoneId ${milestoneId} --file ./submissions/fibonacci.py --submitter ${freelancer}`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
