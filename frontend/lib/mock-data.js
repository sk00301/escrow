// Mock data for the platform
export const MOCK_CONTRACTS = [
    {
        id: 'contract-001',
        freelancerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f8bE47',
        clientAddress: '0x8Ba1f109551bD432803012645Ac136ddd64DBA72',
        milestoneTitle: 'Smart Contract Development',
        description: 'Develop and deploy ERC-20 token contract with vesting functionality',
        amount: 2.5000,
        status: 'funded',
        deliverableType: 'code',
        deadline: new Date('2026-04-15'),
        createdAt: new Date('2026-03-01'),
        acceptanceCriteria: {
            testPassRate: 95,
            requirements: ['Unit tests', 'Gas optimization', 'Security audit ready']
        }
    },
    {
        id: 'contract-002',
        freelancerAddress: '0x1234567890AbCdEf1234567890aBcDeF12345678',
        clientAddress: '0x8Ba1f109551bD432803012645Ac136ddd64DBA72',
        milestoneTitle: 'DeFi Dashboard UI',
        description: 'Build a responsive React dashboard for DeFi portfolio tracking',
        amount: 1.8000,
        status: 'submitted',
        deliverableType: 'code',
        deadline: new Date('2026-04-01'),
        createdAt: new Date('2026-02-20'),
        acceptanceCriteria: {
            testPassRate: 90,
            requirements: ['Responsive design', 'Wallet integration', 'Real-time data']
        }
    },
    {
        id: 'contract-003',
        freelancerAddress: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
        clientAddress: '0x8Ba1f109551bD432803012645Ac136ddd64DBA72',
        milestoneTitle: 'Technical Whitepaper',
        description: 'Write comprehensive technical documentation for the protocol',
        amount: 0.7500,
        status: 'verified',
        deliverableType: 'document',
        deadline: new Date('2026-03-25'),
        createdAt: new Date('2026-03-10'),
        acceptanceCriteria: {
            testPassRate: 85,
            requirements: ['Technical accuracy', 'Clear diagrams', 'Peer reviewed']
        }
    },
    {
        id: 'contract-004',
        freelancerAddress: '0x9876543210FeDcBa9876543210fEdCbA98765432',
        clientAddress: '0x8Ba1f109551bD432803012645Ac136ddd64DBA72',
        milestoneTitle: 'NFT Collection Design',
        description: 'Create 10 unique NFT artworks with trait variations',
        amount: 3.2000,
        status: 'disputed',
        deliverableType: 'design',
        deadline: new Date('2026-03-30'),
        createdAt: new Date('2026-02-15'),
        acceptanceCriteria: {
            testPassRate: 80,
            requirements: ['Original artwork', 'SVG format', '10 variations']
        }
    },
    {
        id: 'contract-005',
        freelancerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f8bE47',
        clientAddress: '0x8Ba1f109551bD432803012645Ac136ddd64DBA72',
        milestoneTitle: 'API Integration',
        description: 'Integrate Oracle price feeds with existing smart contracts',
        amount: 1.2000,
        status: 'released',
        deliverableType: 'code',
        deadline: new Date('2026-02-28'),
        createdAt: new Date('2026-02-01'),
        acceptanceCriteria: {
            testPassRate: 98,
            requirements: ['Chainlink integration', 'Fallback mechanisms', 'Gas efficient']
        }
    }
];
export const MOCK_DISPUTES = [
    {
        id: 'dispute-001',
        contractId: 'contract-004',
        reason: 'Deliverables do not match acceptance criteria - missing 3 required trait variations',
        status: 'active',
        ethAtStake: 3.2000,
        jurorCount: 5,
        votesFor: 2,
        votesAgainst: 1,
        votingDeadline: new Date('2026-03-28'),
        evidence: {
            clientEvidence: 'Only 7 variations submitted instead of required 10',
            freelancerEvidence: 'All 10 variations were submitted, client miscounted'
        },
        createdAt: new Date('2026-03-20')
    },
    {
        id: 'dispute-002',
        contractId: 'contract-002',
        reason: 'Code does not compile - multiple TypeScript errors',
        status: 'resolved',
        ethAtStake: 1.8000,
        jurorCount: 5,
        votesFor: 4,
        votesAgainst: 1,
        votingDeadline: new Date('2026-03-15'),
        verdict: 'approved',
        evidence: {
            clientEvidence: 'Build fails on npm install',
            freelancerEvidence: 'Works on my machine, provided docker config'
        },
        createdAt: new Date('2026-03-10')
    },
    {
        id: 'dispute-003',
        contractId: 'contract-003',
        reason: 'Plagiarism detected in whitepaper sections',
        status: 'pending',
        ethAtStake: 0.7500,
        jurorCount: 7,
        votesFor: 0,
        votesAgainst: 0,
        votingDeadline: new Date('2026-04-02'),
        evidence: {
            clientEvidence: 'Turnitin shows 40% similarity with existing papers',
            freelancerEvidence: 'Common technical terminology, not plagiarism'
        },
        createdAt: new Date('2026-03-22')
    }
];
export const MOCK_VERIFICATION_RESULTS = {
    'contract-001': {
        contractId: 'contract-001',
        deliverableType: 'code',
        overallScore: 94,
        verdict: 'approved',
        breakdown: {
            testPassRate: 97,
            codeCoverage: 89,
            staticAnalysis: 92,
            complexityScore: 96
        },
        passedTests: [
            'Token minting works correctly',
            'Transfer function handles edge cases',
            'Vesting schedule calculates correctly',
            'Access control prevents unauthorized access',
            'Events emit properly'
        ],
        failedTests: [
            'Gas optimization for batch transfers'
        ],
        missingRequirements: [],
        confidenceInterval: [91, 97],
        fileHash: '0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
        submissionTimestamp: new Date('2026-03-18T14:30:00'),
        ipfsLink: 'ipfs://QmT5NvUtoM5nWFfrQdVrFtvGfKFmG7AHE8P34isapyhCxX',
        oracleSignature: '0x1a2b3c4d5e6f7890abcdef1234567890abcdef12'
    },
    'contract-004': {
        contractId: 'contract-004',
        deliverableType: 'design',
        overallScore: 62,
        verdict: 'rejected',
        breakdown: {
            completeness: 70,
            qualityScore: 85,
            formatCompliance: 45,
            originalityScore: 78
        },
        passedTests: [
            'Original artwork verified',
            'Color palette consistency',
            'Resolution meets requirements',
            'Style guide followed'
        ],
        failedTests: [
            'Only 7 of 10 variations submitted',
            'SVG format not provided for 2 items',
            'Missing trait metadata'
        ],
        missingRequirements: [
            '3 additional trait variations',
            'SVG source files',
            'Trait rarity metadata'
        ],
        confidenceInterval: [58, 66],
        fileHash: '0x3c4d5e6f7890abcdef1234567890abcdef123456789012345678901234567890',
        submissionTimestamp: new Date('2026-03-19T09:15:00'),
        ipfsLink: 'ipfs://QmXkY8NvUtoM5nWFfrQdVrFtvGfKFmG7AHE8P34isapyhDx',
        oracleSignature: '0x2b3c4d5e6f7890abcdef1234567890abcdef1234'
    }
};
export const MOCK_JUROR_DATA = {
    address: '0x5678901234AbCdEf5678901234aBcDeF56789012',
    stakedTokens: 1500,
    casesReviewed: 47,
    accuracyRate: 92,
    totalRewardsEarned: 12.4500,
    skills: ['Solidity', 'React', 'Technical Writing', 'Smart Contract Auditing'],
    reputation: 4.7,
    votingHistory: [
        {
            caseId: 'dispute-002',
            vote: 'approve',
            outcome: 'approved',
            reward: 0.15,
            date: new Date('2026-03-15')
        },
        {
            caseId: 'case-045',
            vote: 'reject',
            outcome: 'rejected',
            reward: 0.12,
            date: new Date('2026-03-10')
        },
        {
            caseId: 'case-044',
            vote: 'approve',
            outcome: 'approved',
            reward: 0.18,
            date: new Date('2026-03-05')
        },
        {
            caseId: 'case-042',
            vote: 'reject',
            outcome: 'approved',
            reward: -0.05,
            date: new Date('2026-02-28')
        },
        {
            caseId: 'case-040',
            vote: 'approve',
            outcome: 'approved',
            reward: 0.14,
            date: new Date('2026-02-20')
        }
    ]
};
export const MOCK_MONTHLY_EARNINGS = [
    { month: 'Apr 25', earnings: 1.2 },
    { month: 'May 25', earnings: 2.4 },
    { month: 'Jun 25', earnings: 1.8 },
    { month: 'Jul 25', earnings: 3.2 },
    { month: 'Aug 25', earnings: 2.9 },
    { month: 'Sep 25', earnings: 4.1 },
    { month: 'Oct 25', earnings: 3.5 },
    { month: 'Nov 25', earnings: 2.8 },
    { month: 'Dec 25', earnings: 5.2 },
    { month: 'Jan 26', earnings: 4.8 },
    { month: 'Feb 26', earnings: 3.9 },
    { month: 'Mar 26', earnings: 4.5 }
];
export const MOCK_GOVERNANCE_PROPOSALS = [
    {
        id: 'prop-001',
        title: 'Increase Minimum Juror Stake to 2000 Tokens',
        description: 'Proposal to increase the minimum stake required to become a juror from 1000 to 2000 tokens to improve decision quality',
        status: 'active',
        votesFor: 12500,
        votesAgainst: 8200,
        totalVotes: 20700,
        quorum: 25000,
        deadline: new Date('2026-04-01'),
        proposer: '0xAbCd1234567890AbCdEf1234567890AbCdEf1234',
        createdAt: new Date('2026-03-15')
    },
    {
        id: 'prop-002',
        title: 'Reduce Dispute Time Window to 48 Hours',
        description: 'Reduce the time window for raising disputes from 72 hours to 48 hours to speed up payment releases',
        status: 'active',
        votesFor: 18900,
        votesAgainst: 4100,
        totalVotes: 23000,
        quorum: 25000,
        deadline: new Date('2026-03-30'),
        proposer: '0x5678AbCdEf1234567890AbCdEf1234567890AbCd',
        createdAt: new Date('2026-03-12')
    },
    {
        id: 'prop-003',
        title: 'Add Support for Video Deliverables',
        description: 'Expand the platform to support video file deliverables with AI verification for video content',
        status: 'passed',
        votesFor: 32000,
        votesAgainst: 5500,
        totalVotes: 37500,
        quorum: 25000,
        deadline: new Date('2026-03-10'),
        proposer: '0x9012345678AbCdEf9012345678AbCdEf90123456',
        createdAt: new Date('2026-02-25'),
        executedAt: new Date('2026-03-12')
    },
    {
        id: 'prop-004',
        title: 'Implement Tiered Fee Structure',
        description: 'Replace flat 2% fee with tiered structure: 2.5% for <1 ETH, 2% for 1-10 ETH, 1.5% for >10 ETH',
        status: 'passed',
        votesFor: 28000,
        votesAgainst: 12000,
        totalVotes: 40000,
        quorum: 25000,
        deadline: new Date('2026-02-28'),
        proposer: '0xEf12345678AbCdEf12345678AbCdEf1234567890',
        createdAt: new Date('2026-02-10'),
        executedAt: new Date('2026-03-01')
    }
];
export const MOCK_NOTIFICATIONS = [
    {
        id: 'notif-001',
        type: 'transaction',
        title: 'Payment Released',
        message: 'You received 1.2 ETH for "API Integration"',
        timestamp: new Date('2026-03-24T10:30:00'),
        read: false
    },
    {
        id: 'notif-002',
        type: 'milestone',
        title: 'Work Submitted',
        message: 'Freelancer submitted work for "DeFi Dashboard UI"',
        timestamp: new Date('2026-03-23T14:15:00'),
        read: false
    },
    {
        id: 'notif-003',
        type: 'dispute',
        title: 'Dispute Raised',
        message: 'A dispute has been raised for "NFT Collection Design"',
        timestamp: new Date('2026-03-20T09:45:00'),
        read: true
    },
    {
        id: 'notif-004',
        type: 'vote',
        title: 'Vote Recorded',
        message: 'Your vote on Case #dispute-002 has been recorded',
        timestamp: new Date('2026-03-15T16:20:00'),
        read: true
    },
    {
        id: 'notif-005',
        type: 'governance',
        title: 'Proposal Passed',
        message: 'Proposal "Add Support for Video Deliverables" has passed',
        timestamp: new Date('2026-03-12T12:00:00'),
        read: true
    }
];
// Alias exports for components that use camelCase names
export const mockContracts = MOCK_CONTRACTS;
export const mockDisputes = MOCK_DISPUTES.map(d => ({
    ...d,
    milestoneId: d.contractId,
    clientAddress: '0x8Ba1f109551bD432803012645Ac136ddd64DBA72',
    freelancerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f8bE47',
    assignedJurors: [
        '0x5678901234AbCdEf5678901234aBcDeF56789012',
        '0x1234567890AbCdEf1234567890aBcDeF12345678',
        '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
        '0x9876543210FeDcBa9876543210fEdCbA98765432',
        '0xEf12345678AbCdEf12345678AbCdEf1234567890',
    ],
    votes: d.votesFor > 0 ? [
        { jurorAddress: '0x5678901234AbCdEf5678901234aBcDeF56789012', vote: 'client', reasoning: 'Evidence supports client', timestamp: new Date() },
        { jurorAddress: '0x1234567890AbCdEf1234567890aBcDeF12345678', vote: 'freelancer', reasoning: 'Work was completed', timestamp: new Date() },
    ] : [],
    evidence: [
        { submittedBy: 'client', type: 'text', description: d.evidence.clientEvidence, url: null, timestamp: d.createdAt },
        { submittedBy: 'freelancer', type: 'text', description: d.evidence.freelancerEvidence || 'No evidence submitted', url: null, timestamp: d.createdAt },
    ],
    resolution: d.verdict === 'approved' ? 'client' : 'freelancer',
    votingDeadline: d.votingDeadline.toISOString(),
}));
export const mockMilestones = MOCK_CONTRACTS.map(c => ({
    id: c.id,
    title: c.milestoneTitle,
    deliverables: c.acceptanceCriteria.requirements,
    amount: c.amount,
    deadline: c.deadline,
    status: c.status,
}));
export const mockGovernanceProposals = MOCK_GOVERNANCE_PROPOSALS.map(p => ({
    ...p,
    endDate: p.deadline.toISOString(),
    category: p.id === 'prop-001' ? 'Parameters' :
        p.id === 'prop-002' ? 'Parameters' :
            p.id === 'prop-003' ? 'Features' : 'Economics',
}));
export const PLATFORM_STATS = {
    totalContracts: 2847,
    totalPaidOut: 4521.5,
    disputesResolved: 312,
    activeJurors: 156
};
export const GOVERNANCE_PARAMS = {
    ambiguityBandLower: 70,
    ambiguityBandUpper: 85,
    minimumJurorStake: 1000,
    disputeTimeWindow: 72,
    appealRoundsMaximum: 3
};
