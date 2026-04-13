// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal interface for calling into DisputeContract
interface IDisputeContract {
    function assignJurors(uint256 disputeId, address[] calldata jurors) external;
    function startVoting(uint256 disputeId) external;
    function submitJuryVerdict(uint256 disputeId, bool releaseToFreelancer) external;
}

/**
 * @title JuryStaking
 * @notice Simplified jury pool for the B.Tech prototype.
 */
contract JuryStaking is Ownable, ReentrancyGuard {

    // -------------------------------------------------------------------------
    // CONSTANTS
    // -------------------------------------------------------------------------

    uint256 public constant MIN_STAKE            = 0.01 ether;
    uint256 public constant DEFAULT_JUROR_COUNT  = 3;
    uint256 public constant REWARD_SHARE_PERCENT = 90;

    // -------------------------------------------------------------------------
    // STRUCTS
    // -------------------------------------------------------------------------

    struct Juror {
        uint256 stakeAmount;
        bool    isActive;
        uint256 activeDisputeId;
        bool    isAssigned;
    }

    struct Vote {
        bool voted;
        bool releaseToFreelancer;
    }

    struct JurySession {
        address[] jurors;
        uint256   totalVotes;
        uint256   votesForFreelancer;
        uint256   votesForClient;
        bool      tallied;
        bool      finalVerdict;
    }

    // -------------------------------------------------------------------------
    // STATE VARIABLES
    // -------------------------------------------------------------------------

    mapping(address => Juror)                            public jurors;
    address[]                                            public jurorPool;
    mapping(uint256 => JurySession)                      public sessions;
    mapping(uint256 => mapping(address => Vote))         public votes;
    mapping(uint256 => mapping(address => bool))         public isJurorForDispute;

    address public disputeContract;
    uint256 public protocolFees;

    // -------------------------------------------------------------------------
    // EVENTS
    // -------------------------------------------------------------------------

    event JurorStaked(address indexed juror, uint256 amount);
    event JurorUnstaked(address indexed juror, uint256 amount);
    event JurorsSelected(uint256 indexed disputeId, address[] jurors);
    event VoteCast(uint256 indexed disputeId, address indexed juror, bool releaseToFreelancer);
    event VotesTallied(uint256 indexed disputeId, bool releaseToFreelancer, uint256 votesForFreelancer, uint256 votesForClient);
    event JurorRewarded(address indexed juror, uint256 amount);
    event JurorSlashed(address indexed juror, uint256 amount);

    // -------------------------------------------------------------------------
    // MODIFIERS
    // -------------------------------------------------------------------------

    modifier sessionExists(uint256 disputeId) {
        require(sessions[disputeId].jurors.length > 0, "JuryStaking: no jury session for this dispute");
        _;
    }

    // -------------------------------------------------------------------------
    // CONSTRUCTOR
    // -------------------------------------------------------------------------

    constructor(address _disputeContract) Ownable(msg.sender) {
        require(_disputeContract != address(0), "JuryStaking: zero dispute contract address");
        disputeContract = _disputeContract;
    }

    // -------------------------------------------------------------------------
    // JUROR POOL
    // -------------------------------------------------------------------------

    function stakeToBeJuror() external payable nonReentrant {
        require(msg.value >= MIN_STAKE,       "JuryStaking: stake below minimum (0.01 ETH)");
        require(!jurors[msg.sender].isActive, "JuryStaking: already staked");

        jurors[msg.sender] = Juror({
            stakeAmount     : msg.value,
            isActive        : true,
            activeDisputeId : 0,
            isAssigned      : false
        });
        jurorPool.push(msg.sender);

        emit JurorStaked(msg.sender, msg.value);
    }

    function unstake() external nonReentrant {
        Juror storage j = jurors[msg.sender];
        require(j.isActive,    "JuryStaking: not currently staked");
        require(!j.isAssigned, "JuryStaking: cannot unstake while assigned to a dispute");

        uint256 amount = j.stakeAmount;
        j.stakeAmount  = 0;
        j.isActive     = false;
        _removeFromPool(msg.sender);

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "JuryStaking: ETH transfer failed");

        emit JurorUnstaked(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // JUROR SELECTION
    // -------------------------------------------------------------------------

    function selectJurors(uint256 disputeId, uint256 count) external onlyOwner {
        require(count % 2 == 1, "JuryStaking: juror count must be odd");
        require(count >= 3,     "JuryStaking: minimum 3 jurors required");
        require(sessions[disputeId].jurors.length == 0, "JuryStaking: jurors already selected");

        uint256 available = 0;
        for (uint256 i = 0; i < jurorPool.length; i++) {
            address addr = jurorPool[i];
            if (jurors[addr].isActive && !jurors[addr].isAssigned) available++;
        }
        require(available >= count, "JuryStaking: not enough available jurors in pool");

        uint256 seed    = uint256(keccak256(abi.encodePacked(block.timestamp, disputeId, block.prevrandao)));
        address[] memory selected = new address[](count);
        uint256 selectedCount = 0;
        uint256 attempts      = 0;
        uint256 poolLen       = jurorPool.length;

        while (selectedCount < count && attempts < poolLen * 2) {
            uint256 idx       = (seed + attempts) % poolLen;
            address candidate = jurorPool[idx];
            if (jurors[candidate].isActive && !jurors[candidate].isAssigned) {
                selected[selectedCount]                    = candidate;
                jurors[candidate].isAssigned               = true;
                jurors[candidate].activeDisputeId          = disputeId;
                isJurorForDispute[disputeId][candidate]    = true;
                selectedCount++;
            }
            attempts++;
        }
        require(selectedCount == count, "JuryStaking: selection loop failed");

        sessions[disputeId].jurors = selected;
        emit JurorsSelected(disputeId, selected);

        IDisputeContract(disputeContract).assignJurors(disputeId, selected);
        IDisputeContract(disputeContract).startVoting(disputeId);
    }

    // -------------------------------------------------------------------------
    // VOTING
    // -------------------------------------------------------------------------

    function castVote(uint256 disputeId, bool releaseToFreelancer)
        external
        sessionExists(disputeId)
    {
        require(isJurorForDispute[disputeId][msg.sender], "JuryStaking: caller is not a selected juror for this dispute");
        require(!votes[disputeId][msg.sender].voted,      "JuryStaking: juror has already voted");
        require(!sessions[disputeId].tallied,             "JuryStaking: votes already tallied");

        votes[disputeId][msg.sender] = Vote({voted: true, releaseToFreelancer: releaseToFreelancer});

        JurySession storage s = sessions[disputeId];
        s.totalVotes++;
        if (releaseToFreelancer) { s.votesForFreelancer++; } else { s.votesForClient++; }

        emit VoteCast(disputeId, msg.sender, releaseToFreelancer);
    }

    // -------------------------------------------------------------------------
    // TALLY
    // -------------------------------------------------------------------------

    function tallyVotes(uint256 disputeId) external sessionExists(disputeId) nonReentrant {
        JurySession storage s = sessions[disputeId];
        require(!s.tallied,                      "JuryStaking: already tallied");
        require(s.totalVotes == s.jurors.length, "JuryStaking: not all jurors have voted yet");

        bool releaseToFreelancer = s.votesForFreelancer > s.votesForClient;
        s.tallied      = true;
        s.finalVerdict = releaseToFreelancer;

        emit VotesTallied(disputeId, releaseToFreelancer, s.votesForFreelancer, s.votesForClient);

        // Slash minority, reward majority
        uint256 slashedTotal = 0;
        for (uint256 i = 0; i < s.jurors.length; i++) {
            address jurorAddr = s.jurors[i];
            if (votes[disputeId][jurorAddr].releaseToFreelancer != releaseToFreelancer) {
                uint256 slash = jurors[jurorAddr].stakeAmount;
                jurors[jurorAddr].stakeAmount = 0;
                jurors[jurorAddr].isActive    = false;
                _removeFromPool(jurorAddr);
                slashedTotal += slash;
                emit JurorSlashed(jurorAddr, slash);
            }
        }

        uint256 rewardPool     = (slashedTotal * REWARD_SHARE_PERCENT) / 100;
        protocolFees          += slashedTotal - rewardPool;

        uint256 majorityCount = 0;
        for (uint256 i = 0; i < s.jurors.length; i++) {
            if (votes[disputeId][s.jurors[i]].releaseToFreelancer == releaseToFreelancer) majorityCount++;
        }

        uint256 rewardPerJuror = majorityCount > 0 ? rewardPool / majorityCount : 0;
        for (uint256 i = 0; i < s.jurors.length; i++) {
            address jurorAddr = s.jurors[i];
            if (votes[disputeId][jurorAddr].releaseToFreelancer == releaseToFreelancer) {
                jurors[jurorAddr].isAssigned   = false;
                jurors[jurorAddr].stakeAmount += rewardPerJuror;
                emit JurorRewarded(jurorAddr, rewardPerJuror);
            }
        }

        IDisputeContract(disputeContract).submitJuryVerdict(disputeId, releaseToFreelancer);
    }

    // -------------------------------------------------------------------------
    // VIEW FUNCTIONS
    // -------------------------------------------------------------------------

    function getPoolSize() external view returns (uint256) { return jurorPool.length; }

    function getSessionJurors(uint256 disputeId) external view returns (address[] memory) {
        return sessions[disputeId].jurors;
    }

    function getVoteCounts(uint256 disputeId)
        external view returns (uint256 forFreelancer, uint256 forClient, uint256 total)
    {
        JurySession storage s = sessions[disputeId];
        return (s.votesForFreelancer, s.votesForClient, s.totalVotes);
    }

    function hasVoted(uint256 disputeId, address juror) external view returns (bool) {
        return votes[disputeId][juror].voted;
    }

    function getStake(address juror) external view returns (uint256) {
        return jurors[juror].stakeAmount;
    }

    // -------------------------------------------------------------------------
    // ADMIN
    // -------------------------------------------------------------------------

    function setDisputeContract(address _newDispute) external onlyOwner {
        require(_newDispute != address(0), "JuryStaking: zero address");
        disputeContract = _newDispute;
    }

    function withdrawProtocolFees(address recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "JuryStaking: zero recipient");
        uint256 amount = protocolFees;
        protocolFees   = 0;
        (bool success, ) = payable(recipient).call{value: amount}("");
        require(success, "JuryStaking: fee withdrawal failed");
    }

    // -------------------------------------------------------------------------
    // INTERNAL
    // -------------------------------------------------------------------------

    function _removeFromPool(address jurorAddr) internal {
        uint256 len = jurorPool.length;
        for (uint256 i = 0; i < len; i++) {
            if (jurorPool[i] == jurorAddr) {
                jurorPool[i] = jurorPool[len - 1];
                jurorPool.pop();
                return;
            }
        }
    }
}
