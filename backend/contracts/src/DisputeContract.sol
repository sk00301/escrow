// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal interface for calling back into EscrowContract
interface IEscrowContract {
    function resolveDispute(uint256 milestoneId, bool releaseToFreelancer) external;
}

/**
 * @title DisputeContract
 * @notice Manages the full lifecycle of disputes that arise when the AI
 *         verification score falls in the ambiguity band (45-74).
 *
 * State Machine:
 *   OPEN -> JURORS_ASSIGNED -> VOTING -> RESOLVED
 *
 * Integration:
 *   - EscrowContract calls createDispute() when it enters DISPUTED state
 *   - JuryStaking calls assignJurors() after pseudo-random juror selection
 *   - JuryStaking calls submitJuryVerdict() after vote tally
 *   - DisputeContract calls back EscrowContract.resolveDispute() to release funds
 */
contract DisputeContract is Ownable, ReentrancyGuard {

    // -------------------------------------------------------------------------
    // ENUMS & STRUCTS
    // -------------------------------------------------------------------------

    enum DisputeStatus {
        OPEN,
        JURORS_ASSIGNED,
        VOTING,
        RESOLVED
    }

    struct Dispute {
        uint256   milestoneId;
        address   client;
        address   freelancer;
        uint256   stakedAmount;
        address[] jurors;
        DisputeStatus status;
        bool      releaseToFreelancer;
        uint256   createdAt;
        uint256   resolvedAt;
    }

    // -------------------------------------------------------------------------
    // STATE VARIABLES
    // -------------------------------------------------------------------------

    mapping(uint256 => Dispute) public disputes;
    mapping(uint256 => uint256) public milestoneToDispute;
    mapping(uint256 => bool)    public disputeExistsForMilestone;

    uint256 public disputeCount;
    address public escrowContract;
    address public juryStaking;

    // -------------------------------------------------------------------------
    // EVENTS
    // -------------------------------------------------------------------------

    event DisputeCreated(
        uint256 indexed disputeId,
        uint256 indexed milestoneId,
        address indexed client,
        address         freelancer,
        uint256         stakedAmount
    );

    event JurorsAssigned(uint256 indexed disputeId, address[] jurors);
    event VotingStarted(uint256 indexed disputeId);

    event VerdictSubmitted(
        uint256 indexed disputeId,
        uint256 indexed milestoneId,
        bool            releaseToFreelancer
    );

    event EscrowContractUpdated(address indexed oldEscrow, address indexed newEscrow);
    event JuryStakingUpdated(address indexed oldJury, address indexed newJury);

    // -------------------------------------------------------------------------
    // MODIFIERS
    // -------------------------------------------------------------------------

    modifier onlyEscrow() {
        require(msg.sender == escrowContract, "DisputeContract: caller is not EscrowContract");
        _;
    }

    modifier onlyJury() {
        require(msg.sender == juryStaking, "DisputeContract: caller is not JuryStaking");
        _;
    }

    modifier disputeExists(uint256 disputeId) {
        require(disputeId < disputeCount, "DisputeContract: dispute does not exist");
        _;
    }

    modifier inStatus(uint256 disputeId, DisputeStatus expected) {
        require(disputes[disputeId].status == expected, "DisputeContract: invalid status transition");
        _;
    }

    // -------------------------------------------------------------------------
    // CONSTRUCTOR
    // -------------------------------------------------------------------------

    constructor(address _escrowContract, address _juryStaking) Ownable(msg.sender) {
        require(_escrowContract != address(0), "DisputeContract: zero escrow address");
        require(_juryStaking    != address(0), "DisputeContract: zero jury address");
        escrowContract = _escrowContract;
        juryStaking    = _juryStaking;
    }

    // -------------------------------------------------------------------------
    // CORE FUNCTIONS
    // -------------------------------------------------------------------------

    function createDispute(
        uint256 milestoneId,
        address client,
        address freelancer,
        uint256 stakedAmount
    ) external onlyEscrow returns (uint256 disputeId) {
        require(client     != address(0), "DisputeContract: zero client address");
        require(freelancer != address(0), "DisputeContract: zero freelancer address");
        require(!disputeExistsForMilestone[milestoneId], "DisputeContract: dispute already exists for this milestone");

        disputeId = disputeCount++;

        Dispute storage d = disputes[disputeId];
        d.milestoneId  = milestoneId;
        d.client       = client;
        d.freelancer   = freelancer;
        d.stakedAmount = stakedAmount;
        d.status       = DisputeStatus.OPEN;
        d.createdAt    = block.timestamp;

        milestoneToDispute[milestoneId]        = disputeId;
        disputeExistsForMilestone[milestoneId] = true;

        emit DisputeCreated(disputeId, milestoneId, client, freelancer, stakedAmount);
    }

    function getDispute(uint256 disputeId)
        external
        view
        disputeExists(disputeId)
        returns (
            uint256         milestoneId,
            address         client,
            address         freelancer,
            uint256         stakedAmount,
            address[] memory jurors,
            DisputeStatus   status,
            bool            releaseToFreelancer,
            uint256         createdAt,
            uint256         resolvedAt
        )
    {
        Dispute storage d = disputes[disputeId];
        return (d.milestoneId, d.client, d.freelancer, d.stakedAmount,
                d.jurors, d.status, d.releaseToFreelancer, d.createdAt, d.resolvedAt);
    }

    function assignJurors(uint256 disputeId, address[] calldata jurors)
        external
        onlyJury
        disputeExists(disputeId)
        inStatus(disputeId, DisputeStatus.OPEN)
    {
        require(jurors.length > 0,       "DisputeContract: jurors array is empty");
        require(jurors.length % 2 == 1,  "DisputeContract: juror count must be odd");

        Dispute storage d = disputes[disputeId];
        d.jurors = jurors;
        d.status = DisputeStatus.JURORS_ASSIGNED;

        emit JurorsAssigned(disputeId, jurors);
    }

    function startVoting(uint256 disputeId)
        external
        onlyJury
        disputeExists(disputeId)
        inStatus(disputeId, DisputeStatus.JURORS_ASSIGNED)
    {
        disputes[disputeId].status = DisputeStatus.VOTING;
        emit VotingStarted(disputeId);
    }

    function submitJuryVerdict(uint256 disputeId, bool releaseToFreelancer)
        external
        onlyJury
        disputeExists(disputeId)
        inStatus(disputeId, DisputeStatus.VOTING)
        nonReentrant
    {
        Dispute storage d     = disputes[disputeId];
        d.releaseToFreelancer = releaseToFreelancer;
        d.status              = DisputeStatus.RESOLVED;
        d.resolvedAt          = block.timestamp;

        emit VerdictSubmitted(disputeId, d.milestoneId, releaseToFreelancer);

        IEscrowContract(escrowContract).resolveDispute(d.milestoneId, releaseToFreelancer);
    }

    // -------------------------------------------------------------------------
    // VIEW HELPERS
    // -------------------------------------------------------------------------

    function getDisputeIdForMilestone(uint256 milestoneId) external view returns (uint256) {
        require(disputeExistsForMilestone[milestoneId], "DisputeContract: no dispute for this milestone");
        return milestoneToDispute[milestoneId];
    }

    function getJurors(uint256 disputeId)
        external
        view
        disputeExists(disputeId)
        returns (address[] memory)
    {
        return disputes[disputeId].jurors;
    }

    // -------------------------------------------------------------------------
    // ADMIN
    // -------------------------------------------------------------------------

    function setEscrowContract(address _newEscrow) external onlyOwner {
        require(_newEscrow != address(0), "DisputeContract: zero address");
        emit EscrowContractUpdated(escrowContract, _newEscrow);
        escrowContract = _newEscrow;
    }

    function setJuryStaking(address _newJury) external onlyOwner {
        require(_newJury != address(0), "DisputeContract: zero address");
        emit JuryStakingUpdated(juryStaking, _newJury);
        juryStaking = _newJury;
    }
}
