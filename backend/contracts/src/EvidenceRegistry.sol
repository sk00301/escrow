// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EvidenceRegistry
 * @notice Immutable on-chain registry of freelancer submission evidence.
 *         Every submission hash and IPFS CID is stored here by the
 *         EscrowContract, creating a tamper-proof audit trail.
 *
 * Integration:
 *   - EscrowContract calls registerEvidence() inside submitWork()
 *   - Oracle reads ipfsCID from EvidenceRegistered event to fetch submission
 *   - Frontend calls getEvidence() + verifyIntegrity() to display proof
 */
contract EvidenceRegistry is Ownable {

    // -------------------------------------------------------------------------
    // STRUCTS
    // -------------------------------------------------------------------------

    /**
     * @notice Evidence record stored for each milestone submission
     * @param contentHash  SHA-256 hash of the deliverable (bytes32)
     * @param ipfsCID      IPFS content identifier pointing to the submission
     * @param submitter    Address of the freelancer who submitted
     * @param timestamp    Block timestamp when evidence was registered
     * @param exists       Guard flag — true once evidence is registered
     */
    struct Evidence {
        bytes32 contentHash;
        string  ipfsCID;
        address submitter;
        uint256 timestamp;
        bool    exists;
    }

    // -------------------------------------------------------------------------
    // STATE VARIABLES
    // -------------------------------------------------------------------------

    /// @notice milestoneId → Evidence record
    mapping(uint256 => Evidence) private evidenceStore;

    /// @notice Address of the EscrowContract — only it may register evidence
    address public escrowContract;

    // -------------------------------------------------------------------------
    // EVENTS
    // -------------------------------------------------------------------------

    /**
     * @notice Emitted when evidence is successfully registered
     * @param milestoneId  The milestone this evidence belongs to
     * @param contentHash  SHA-256 hash of the deliverable
     * @param ipfsCID      IPFS CID for the oracle to fetch
     * @param submitter    Freelancer address
     * @param timestamp    Block timestamp of registration
     */
    event EvidenceRegistered(
        uint256 indexed milestoneId,
        bytes32 indexed contentHash,
        string          ipfsCID,
        address indexed submitter,
        uint256         timestamp
    );

    /// @notice Emitted when the escrow contract address is updated
    event EscrowContractUpdated(address indexed oldEscrow, address indexed newEscrow);

    // -------------------------------------------------------------------------
    // MODIFIERS
    // -------------------------------------------------------------------------

    modifier onlyEscrow() {
        require(
            msg.sender == escrowContract,
            "EvidenceRegistry: caller is not the EscrowContract"
        );
        _;
    }

    // -------------------------------------------------------------------------
    // CONSTRUCTOR
    // -------------------------------------------------------------------------

    /**
     * @param _escrowContract Address of the deployed EscrowContract
     */
    constructor(address _escrowContract) Ownable(msg.sender) {
        require(_escrowContract != address(0), "EvidenceRegistry: zero escrow address");
        escrowContract = _escrowContract;
    }

    // -------------------------------------------------------------------------
    // CORE FUNCTIONS
    // -------------------------------------------------------------------------

    /**
     * @notice Register evidence for a milestone submission.
     *         Called by EscrowContract inside submitWork().
     *         Once registered, evidence cannot be overwritten — immutable record.
     *
     * @param milestoneId  ID of the milestone being submitted
     * @param contentHash  SHA-256 hash of the deliverable computed off-chain
     * @param ipfsCID      IPFS content identifier for oracle to retrieve submission
     * @param submitter    Address of the freelancer submitting work
     */
    function registerEvidence(
        uint256 milestoneId,
        bytes32 contentHash,
        string  calldata ipfsCID,
        address submitter
    ) external onlyEscrow {
        require(
            !evidenceStore[milestoneId].exists,
            "EvidenceRegistry: evidence already registered for this milestone"
        );
        require(contentHash != bytes32(0), "EvidenceRegistry: empty content hash");
        require(bytes(ipfsCID).length > 0,  "EvidenceRegistry: empty IPFS CID");
        require(submitter != address(0),     "EvidenceRegistry: zero submitter address");

        evidenceStore[milestoneId] = Evidence({
            contentHash : contentHash,
            ipfsCID     : ipfsCID,
            submitter   : submitter,
            timestamp   : block.timestamp,
            exists      : true
        });

        emit EvidenceRegistered(milestoneId, contentHash, ipfsCID, submitter, block.timestamp);
    }

    /**
     * @notice Retrieve full evidence record for a milestone.
     *
     * @param milestoneId  ID of the milestone to query
     * @return contentHash SHA-256 hash of the deliverable
     * @return ipfsCID     IPFS content identifier
     * @return submitter   Freelancer address
     * @return timestamp   Block timestamp of registration
     */
    function getEvidence(uint256 milestoneId)
        external
        view
        returns (
            bytes32 contentHash,
            string  memory ipfsCID,
            address submitter,
            uint256 timestamp
        )
    {
        Evidence storage e = evidenceStore[milestoneId];
        require(e.exists, "EvidenceRegistry: no evidence found for this milestone");

        return (e.contentHash, e.ipfsCID, e.submitter, e.timestamp);
    }

    /**
     * @notice Verify that a provided hash matches the stored evidence hash.
     *         Used by the frontend or oracle to confirm submission integrity.
     *
     * @param milestoneId  ID of the milestone to verify
     * @param checkHash    Hash to compare against the stored record
     * @return bool        true if hashes match, false otherwise
     */
    function verifyIntegrity(uint256 milestoneId, bytes32 checkHash)
        external
        view
        returns (bool)
    {
        Evidence storage e = evidenceStore[milestoneId];
        if (!e.exists) return false;
        return e.contentHash == checkHash;
    }

    /**
     * @notice Check whether evidence has been registered for a milestone.
     *
     * @param milestoneId  ID to check
     * @return bool        true if evidence exists
     */
    function hasEvidence(uint256 milestoneId) external view returns (bool) {
        return evidenceStore[milestoneId].exists;
    }

    // -------------------------------------------------------------------------
    // ADMIN
    // -------------------------------------------------------------------------

    /**
     * @notice Update the authorised EscrowContract address.
     *         Only callable by contract owner.
     * @param _newEscrow New EscrowContract address
     */
    function setEscrowContract(address _newEscrow) external onlyOwner {
        require(_newEscrow != address(0), "EvidenceRegistry: zero address");
        emit EscrowContractUpdated(escrowContract, _newEscrow);
        escrowContract = _newEscrow;
    }
}
