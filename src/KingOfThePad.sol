// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PadLib} from "./libs/PadLib.sol";
import {IPvPPad, IPadLiquidity} from "./interfaces/Interfaces.sol";

interface IPadFund {
    function fundGames() external payable;
}

/// @title KingOfThePad
/// @notice Crown auction. Opens after PvP graduates. Last contract in the manifest: its constructor
/// binds to the pad and PadLiquidity; opening the pad later creates genesis.
contract KingOfThePad {
    uint256 public constant CROWN_DISTRIBUTE_GAS = 4_500_000;
    uint256 public constant MIN_BID = 0.01 ether;
    uint256 public constant HOLD = 1 hours;
    uint256 public constant STEP_BPS = 11_000;
    bytes32 internal constant LIQUIDITY_BUSY = keccak256(abi.encodeWithSignature("Error(string)", "reentrancy"));

    IPvPPad public immutable pad;
    IPadLiquidity public immutable liquidity;
    address public immutable dev;

    address public king;
    uint256 public bid;
    uint64 public crownedAt;
    uint256 public crownCount;
    bool private locked;
    mapping(address => uint256) public claimable;

    event Crowned(address indexed king, address indexed previous, uint256 bid, uint256 extra, uint256 refund);
    event ExtraSplit(uint256 games, uint256 burn, uint256 dev);
    event Refunded(address indexed to, uint256 amount, bool pushed);
    event Claimed(address indexed to, uint256 amount);

    modifier guard() {
        require(!locked, "reentrancy");
        locked = true;
        _;
        locked = false;
    }

    constructor(address pad_, address liquidity_, address dev_) {
        require(pad_ != address(0) && liquidity_ != address(0) && dev_ != address(0), "zero");
        pad = IPvPPad(pad_);
        liquidity = IPadLiquidity(liquidity_);
        dev = dev_;
        IPadLiquidity(liquidity_).bindKing();
        IPvPPad(pad_).startGenesis();
    }

    function owner() external view returns (address) {
        return dev;
    }

    /// @notice First bid >= 0.01 ETH, then >= 110% of the current bid once the king has held 1 hour.
    function takeCrown() external payable guard {
        require(pad.genesisGraduated(), "king not open");
        address previous = king;
        uint256 previousBid = bid;
        uint256 extra;
        if (previous == address(0)) {
            require(msg.value >= MIN_BID, "min bid");
            extra = msg.value;
        } else {
            require(block.timestamp >= crownedAt + HOLD, "king holds");
            require(msg.value >= previousBid * STEP_BPS / 10_000, "bid too low");
            extra = msg.value - previousBid;
        }
        // Settle a bounded backlog to the outgoing king before changing the beneficiary.
        // Individual bad pools are isolated by PadLiquidity; even a failed distributor cannot veto a bid.
        // A bid placed while PadLiquidity is mid-operation (its lock held) would skip that settlement,
        // so that one reason is not swallowed; it never comes from a pool, which distribute isolates.
        if (previous != address(0)) {
            try liquidity.distribute{gas: CROWN_DISTRIBUTE_GAS}(8) {}
            catch (bytes memory reason) {
                require(keccak256(reason) != LIQUIDITY_BUSY, "liquidity busy");
            }
        }
        king = msg.sender;
        bid = msg.value;
        crownedAt = uint64(block.timestamp);
        crownCount += 1;
        emit Crowned(msg.sender, previous, msg.value, extra, previousBid);
        if (previousBid != 0) {
            bool ok = PadLib.push(previous, previousBid);
            if (!ok) claimable[previous] += previousBid;
            emit Refunded(previous, previousBid, ok);
        }
        uint256 games = extra / 2;
        uint256 burn = extra / 4;
        uint256 devShare = extra - games - burn;
        if (games != 0) IPadFund(address(pad)).fundGames{value: games}();
        if (burn != 0) liquidity.fundBurn{value: burn}();
        if (devShare != 0) {
            bool okDev = PadLib.push(dev, devShare);
            if (!okDev) claimable[dev] += devShare;
        }
        emit ExtraSplit(games, burn, devShare);
        pad.upkeepFor(msg.sender); // upkeep fees (finalizer) go to the bidder, not to this contract
    }

    /// @notice Collect LP fees from at most 8 of the next n graduated pools and pay the current king.
    function distribute(uint256 n) external {
        liquidity.distribute(n);
    }

    function claim() external guard {
        uint256 amount = claimable[msg.sender];
        require(amount != 0, "nothing");
        claimable[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "claim failed");
        emit Claimed(msg.sender, amount);
    }

    function nextMinBid() external view returns (uint256) {
        return king == address(0) ? MIN_BID : bid * STEP_BPS / 10_000;
    }

    function challengeOpensAt() external view returns (uint256) {
        return king == address(0) ? 0 : crownedAt + HOLD;
    }
}
