// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EscrowContract
 * @author Escrow Platform — B.Tech Prototype
 * @notice Core escrow logic for the AI-verified freelance milestone system.
 *         Enforces strict state machine transitions and integrates with an
 *         off-chain oracle (AI verification) and an on-chain jury contract.
 *
 * State Machine:
 *   CREATED → FUNDED → SUBMITTED → VERIFIED  → RELEASED
 *                    ↑            → REJECTED  ↘
 *                    └────────────→ DISPUTED  → RESOLVED
 *   FUNDED  → REFUNDED  (timeout, no submission)
 *
 *   Resubmission: REJECTED → SUBMITTED  (freelancer corrects work)
 *                 DISPUTED → SUBMITTED  (freelancer corrects work)
 *   Dispute:      VERIFIED → DISPUTED   (client challenges oracle approval)
 *                 REJECTED → DISPUTED   (freelancer challenges rejection)
 */
contract EscrowContract is ReentrancyGuard, Ownable {

    // ─────────────────────────────────────────────────────────────────────────
    // ENUMS & STRUCTS
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice All possible states a milestone can occupy
    enum State {
        CREATED,    // 0 — milestone created, no funds yet
        FUNDED,     // 1 — client locked ETH in escrow
        SUBMITTED,  // 2 — freelancer submitted work
        VERIFIED,   // 3 — AI score ≥ 75, awaiting payment release
        REJECTED,   // 4 — AI score < 45, work rejected
        DISPUTED,   // 5 — AI score 45–74, sent to jury
        RESOLVED,   // 6 — jury resolved the dispute
        RELEASED,   // 7 — payment released to freelancer
        REFUNDED    // 8 — timeout refund sent to client
    }

    /// @notice Complete milestone data structure
    struct Milestone {
        // Parties
        address client;           // party who creates and funds the milestone
        address freelancer;       // party who submits work

        // Milestone descriptor
        bytes32 milestoneHash;    // keccak256 hash of off-chain milestone spec
        uint256 deadline;         // Unix timestamp — submission must arrive before this

        // Escrow financials
        uint256 amount;           // ETH locked in escrow (wei)

        // Submission data
        bytes32 evidenceHash;     // SHA-256 hash of submitted deliverable
        string  ipfsCID;          // IPFS content identifier of uploaded submission

        // Verification result
        uint256 score;            // 0–100 from oracle (represents 0.00–1.00)
        string  verdict;          // "APPROVED" | "DISPUTED" | "REJECTED"

        // State
        State   state;            // current state machine position
        uint256 createdAt;        // block.timestamp at creation
        uint256 fundedAt;         // block.timestamp when funded
        uint256 submittedAt;      // block.timestamp when work submitted
        uint256 resolvedAt;       // block.timestamp when fully resolved
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STATE VARIABLES
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Primary storage: milestoneId → Milestone
    mapping(uint256 => Milestone) public milestones;

    /// @notice Auto-incrementing milestone counter
    uint256 public milestoneCount;

    /// @notice Address of the oracle that posts AI verification results
    address public oracleAddress;

    /// @notice Address of the jury contract that resolves disputes
    address public juryContractAddress;

    // ─────────────────────────────────────────────────────────────────────────
    // SCORE THRESHOLDS (matching AI pipeline: 0–100 integer scale)
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant APPROVE_THRESHOLD = 75;  // score ≥ 75 → VERIFIED
    uint256 public constant DISPUTE_THRESHOLD = 45;  // score 45–74 → DISPUTED
                                                      // score < 45  → REJECTED

    // ─────────────────────────────────────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────────────────────────────────────

    event MilestoneCreated(
        uint256 indexed milestoneId,
        address indexed client,
        address indexed freelancer,
        bytes32 milestoneHash,
        uint256 deadline
    );

    event MilestoneFunded(
        uint256 indexed milestoneId,
        uint256 amount
    );

    event WorkSubmitted(
        uint256 indexed milestoneId,
        bytes32 evidenceHash,
        string  ipfsCID
    );

    event VerificationResultPosted(
        uint256 indexed milestoneId,
        uint256 score,
        string  verdict
    );

    event PaymentReleased(
        uint256 indexed milestoneId,
        uint256 amount,
        address indexed freelancer
    );

    event DisputeRaised(
        uint256 indexed milestoneId,
        address indexed raisedBy
    );

    event DisputeResolved(
        uint256 indexed milestoneId,
        bool releasedToFreelancer
    );

    event TimeoutRefundIssued(
        uint256 indexed milestoneId,
        address indexed client,
        uint256 amount
    );

    event OracleAddressUpdated(address indexed oldOracle, address indexed newOracle);
    event JuryContractAddressUpdated(address indexed oldJury, address indexed newJury);

    // ─────────────────────────────────────────────────────────────────────────
    // MODIFIERS
    // ─────────────────────────────────────────────────────────────────────────

    modifier onlyOracle() {
        require(msg.sender == oracleAddress, "EscrowContract: caller is not the oracle");
        _;
    }

    modifier onlyJury() {
        require(msg.sender == juryContractAddress, "EscrowContract: caller is not the jury contract");
        _;
    }

    modifier onlyClient(uint256 milestoneId) {
        require(msg.sender == milestones[milestoneId].client, "EscrowContract: caller is not the client");
        _;
    }

    modifier onlyFreelancer(uint256 milestoneId) {
        require(msg.sender == milestones[milestoneId].freelancer, "EscrowContract: caller is not the freelancer");
        _;
    }

    modifier milestoneExists(uint256 milestoneId) {
        require(milestoneId < milestoneCount, "EscrowContract: milestone does not exist");
        _;
    }

    modifier inState(uint256 milestoneId, State expectedState) {
        require(
            milestones[milestoneId].state == expectedState,
            "EscrowContract: invalid state transition"
        );
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param _oracleAddress       Address of the Node.js oracle signer
     * @param _juryContractAddress Address of the JuryStaking contract
     */
    constructor(
        address _oracleAddress,
        address _juryContractAddress
    ) Ownable(msg.sender) {
        require(_oracleAddress != address(0),       "EscrowContract: zero oracle address");
        require(_juryContractAddress != address(0), "EscrowContract: zero jury address");

        oracleAddress       = _oracleAddress;
        juryContractAddress = _juryContractAddress;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CORE FUNCTIONS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Client creates a new milestone.
     * @param freelancer    Address of the freelancer who will do the work
     * @param milestoneHash keccak256 hash of the off-chain milestone specification
     * @param deadline      Unix timestamp by which work must be submitted
     * @return milestoneId  ID of the newly created milestone
     */
    function createMilestone(
        address freelancer,
        bytes32 milestoneHash,
        uint256 deadline
    ) external returns (uint256 milestoneId) {
        require(freelancer != address(0),    "EscrowContract: zero freelancer address");
        require(freelancer != msg.sender,    "EscrowContract: client and freelancer must differ");
        require(deadline > block.timestamp,  "EscrowContract: deadline must be in the future");
        require(milestoneHash != bytes32(0), "EscrowContract: empty milestone hash");

        milestoneId = milestoneCount++;

        Milestone storage m = milestones[milestoneId];
        m.client        = msg.sender;
        m.freelancer    = freelancer;
        m.milestoneHash = milestoneHash;
        m.deadline      = deadline;
        m.state         = State.CREATED;
        m.createdAt     = block.timestamp;

        emit MilestoneCreated(milestoneId, msg.sender, freelancer, milestoneHash, deadline);
    }

    /**
     * @notice Client funds the milestone by sending ETH.
     *         ETH is locked in this contract until the milestone resolves.
     * @param milestoneId ID of the milestone to fund
     */
    function fundMilestone(uint256 milestoneId)
        external
        payable
        milestoneExists(milestoneId)
        onlyClient(milestoneId)
        inState(milestoneId, State.CREATED)
        nonReentrant
    {
        require(msg.value > 0, "EscrowContract: must send ETH to fund milestone");
        require(
            block.timestamp < milestones[milestoneId].deadline,
            "EscrowContract: milestone deadline has passed"
        );

        Milestone storage m = milestones[milestoneId];
        m.amount   = msg.value;
        m.state    = State.FUNDED;
        m.fundedAt = block.timestamp;

        emit MilestoneFunded(milestoneId, msg.value);
    }

    /**
     * @notice Freelancer submits completed work.
     *         Stores evidence hash and IPFS CID on-chain.
     *         Emits SubmissionReceived-equivalent event for oracle to detect.
     * @param milestoneId  ID of the funded milestone
     * @param evidenceHash SHA-256 hash of the submitted deliverable
     * @param ipfsCID      IPFS content identifier pointing to the submission
     */
    function submitWork(
        uint256 milestoneId,
        bytes32 evidenceHash,
        string calldata ipfsCID
    )
        external
        milestoneExists(milestoneId)
        onlyFreelancer(milestoneId)
        nonReentrant
    {
        Milestone storage m = milestones[milestoneId];

        // Allow initial submission (FUNDED) and resubmission after oracle rejection
        // (REJECTED = score < 45) or jury dispute (DISPUTED = score 45-74).
        require(
            m.state == State.FUNDED ||
            m.state == State.REJECTED ||
            m.state == State.DISPUTED,
            "EscrowContract: invalid state transition"
        );

        require(evidenceHash != bytes32(0), "EscrowContract: empty evidence hash");
        require(bytes(ipfsCID).length > 0,  "EscrowContract: empty IPFS CID");
        require(
            block.timestamp <= m.deadline,
            "EscrowContract: submission deadline has passed"
        );

        m.evidenceHash  = evidenceHash;
        m.ipfsCID       = ipfsCID;
        m.state         = State.SUBMITTED;
        m.submittedAt   = block.timestamp;

        emit WorkSubmitted(milestoneId, evidenceHash, ipfsCID);
    }

    /**
     * @notice Oracle posts AI verification result.
     *         Score 0–100 (integer representing 0.00–1.00 normalised score).
     *         ≥75 → VERIFIED | 45–74 → DISPUTED | <45 → REJECTED
     * @param milestoneId ID of the submitted milestone
     * @param score       Normalised score 0–100 from the AI verification service
     * @param signature   Oracle's ECDSA signature over (milestoneId, score)
     */
    function postVerificationResult(
        uint256 milestoneId,
        uint256 score,
        bytes calldata signature
    )
        external
        onlyOracle
        milestoneExists(milestoneId)
        inState(milestoneId, State.SUBMITTED)
    {
        require(score <= 100, "EscrowContract: score must be 0-100");

        // Verify oracle signature over (milestoneId, score)
        bytes32 messageHash = keccak256(abi.encodePacked(milestoneId, score));
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        address signer = _recoverSigner(ethSignedHash, signature);
        require(signer == oracleAddress, "EscrowContract: invalid oracle signature");

        Milestone storage m = milestones[milestoneId];
        m.score = score;

        string memory verdict;

        if (score >= APPROVE_THRESHOLD) {
            m.state  = State.VERIFIED;
            verdict  = "APPROVED";
        } else if (score >= DISPUTE_THRESHOLD) {
            m.state  = State.DISPUTED;
            verdict  = "DISPUTED";
        } else {
            m.state  = State.REJECTED;
            verdict  = "REJECTED";
        }

        m.verdict = verdict;

        emit VerificationResultPosted(milestoneId, score, verdict);
    }

    /**
     * @notice Client releases payment to freelancer after VERIFIED state.
     * @param milestoneId ID of the verified milestone
     */
    function releasePayment(uint256 milestoneId)
        external
        milestoneExists(milestoneId)
        onlyClient(milestoneId)
        inState(milestoneId, State.VERIFIED)
        nonReentrant
    {
        Milestone storage m = milestones[milestoneId];
        uint256 amount      = m.amount;
        address freelancer  = m.freelancer;

        m.amount      = 0;
        m.state       = State.RELEASED;
        m.resolvedAt  = block.timestamp;

        (bool success, ) = payable(freelancer).call{value: amount}("");
        require(success, "EscrowContract: ETH transfer to freelancer failed");

        emit PaymentReleased(milestoneId, amount, freelancer);
    }

    /**
     * @notice Either party can formally raise the dispute when in DISPUTED state.
     *         This signals the jury contract to open a voting round.
     * @param milestoneId ID of the disputed milestone
     */
    function raiseDispute(uint256 milestoneId)
        external
        milestoneExists(milestoneId)
    {
        Milestone storage m = milestones[milestoneId];

        // Client can dispute an oracle-approved result (VERIFIED) or a rejection (REJECTED),
        // or either party can escalate an already-borderline result (DISPUTED).
        require(
            m.state == State.VERIFIED ||
            m.state == State.REJECTED ||
            m.state == State.DISPUTED,
            "EscrowContract: invalid state transition"
        );
        require(
            msg.sender == m.client || msg.sender == m.freelancer,
            "EscrowContract: only client or freelancer can raise dispute"
        );

        m.state = State.DISPUTED;
        emit DisputeRaised(milestoneId, msg.sender);
    }

    /**
     * @notice Jury contract resolves a dispute.
     *         If releaseToFreelancer = true, transfers funds to freelancer.
     *         Otherwise, returns funds to client.
     * @param milestoneId          ID of the disputed milestone
     * @param releaseToFreelancer  true = pay freelancer, false = refund client
     */
    function resolveDispute(uint256 milestoneId, bool releaseToFreelancer)
        external
        onlyJury
        milestoneExists(milestoneId)
        inState(milestoneId, State.DISPUTED)
        nonReentrant
    {
        Milestone storage m = milestones[milestoneId];
        uint256 amount      = m.amount;

        m.amount     = 0;
        m.state      = State.RESOLVED;
        m.resolvedAt = block.timestamp;

        address recipient = releaseToFreelancer ? m.freelancer : m.client;

        (bool success, ) = payable(recipient).call{value: amount}("");
        require(success, "EscrowContract: ETH transfer in dispute resolution failed");

        emit DisputeResolved(milestoneId, releaseToFreelancer);
    }

    /**
     * @notice Client claims a refund if the deadline passed with no submission.
     * @param milestoneId ID of the funded milestone past its deadline
     */
    function getTimeoutRefund(uint256 milestoneId)
        external
        milestoneExists(milestoneId)
        onlyClient(milestoneId)
        inState(milestoneId, State.FUNDED)
        nonReentrant
    {
        Milestone storage m = milestones[milestoneId];
        require(
            block.timestamp > m.deadline,
            "EscrowContract: deadline has not passed yet"
        );

        uint256 amount = m.amount;
        m.amount     = 0;
        m.state      = State.REFUNDED;
        m.resolvedAt = block.timestamp;

        (bool success, ) = payable(m.client).call{value: amount}("");
        require(success, "EscrowContract: timeout refund transfer failed");

        emit TimeoutRefundIssued(milestoneId, m.client, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADMIN FUNCTIONS (owner only)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Update the oracle address (e.g. after oracle key rotation)
     */
    function setOracleAddress(address _newOracle) external onlyOwner {
        require(_newOracle != address(0), "EscrowContract: zero address");
        emit OracleAddressUpdated(oracleAddress, _newOracle);
        oracleAddress = _newOracle;
    }

    /**
     * @notice Update the jury contract address
     */
    function setJuryContractAddress(address _newJury) external onlyOwner {
        require(_newJury != address(0), "EscrowContract: zero address");
        emit JuryContractAddressUpdated(juryContractAddress, _newJury);
        juryContractAddress = _newJury;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VIEW FUNCTIONS
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the current state of a milestone as a uint
    function getMilestoneState(uint256 milestoneId)
        external
        view
        milestoneExists(milestoneId)
        returns (State)
    {
        return milestones[milestoneId].state;
    }

    /// @notice Returns full milestone data
    function getMilestone(uint256 milestoneId)
        external
        view
        milestoneExists(milestoneId)
        returns (Milestone memory)
    {
        return milestones[milestoneId];
    }

    /// @notice Returns total number of milestones created
    function getTotalMilestones() external view returns (uint256) {
        return milestoneCount;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Recovers the signer address from an Ethereum-prefixed message hash
     *      and a compact 65-byte ECDSA signature.
     */
    function _recoverSigner(bytes32 ethSignedHash, bytes memory signature)
        internal
        pure
        returns (address)
    {
        require(signature.length == 65, "EscrowContract: invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8   v;

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        // Normalise v to 27 or 28
        if (v < 27) v += 27;

        require(v == 27 || v == 28, "EscrowContract: invalid signature v value");

        return ecrecover(ethSignedHash, v, r, s);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FALLBACK — reject accidental ETH sends
    // ─────────────────────────────────────────────────────────────────────────

    receive() external payable {
        revert("EscrowContract: use fundMilestone() to send ETH");
    }
}
