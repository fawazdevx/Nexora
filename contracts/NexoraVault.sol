// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

interface IAToken {
    function balanceOf(address account) external view returns (uint256);
}

contract NexoraVault is ERC20, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20   public depositToken;
    IPool    public aavePool;
    IAToken  public aToken;
    address  public treasury;
    uint256  public performanceFee;

    mapping(address => uint256) public principalDeposited;

    uint256 public constant MAX_FEE        = 2000;
    uint256 public constant FEE_DENOMINATOR = 10_000;

    event Deposited(address indexed user, uint256 usdcAmount, uint256 sharesIssued);
    event Withdrawn(address indexed user, uint256 usdcReturned, uint256 feeCharged, uint256 sharesBurned);
    event FeeCollected(address indexed treasury, uint256 amount);
    event TreasuryUpdated(address indexed newTreasury);
    event PerformanceFeeUpdated(uint256 newFeeBps);

    constructor(
        address _depositToken,
        address _aavePool,
        address _aToken,
        address _treasury,
        uint256 _performanceFee
    ) ERC20("Nexora Vault Share", "nxUSDC") Ownable(msg.sender) {
        require(_depositToken  != address(0), "Nexora: zero token");
        require(_aavePool      != address(0), "Nexora: zero pool");
        require(_aToken        != address(0), "Nexora: zero aToken");
        require(_treasury      != address(0), "Nexora: zero treasury");
        require(_performanceFee <= MAX_FEE,   "Nexora: fee too high");

        depositToken   = IERC20(_depositToken);
        aavePool       = IPool(_aavePool);
        aToken         = IAToken(_aToken);
        treasury       = _treasury;
        performanceFee = _performanceFee;
    }

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Nexora: zero amount");

        uint256 assetsBefore  = totalAssets();
        uint256 supplyBefore  = totalSupply();

        depositToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 shares = (supplyBefore == 0 || assetsBefore == 0)
            ? amount
            : (amount * supplyBefore) / assetsBefore;

        require(shares > 0, "Nexora: zero shares minted");

        principalDeposited[msg.sender] += amount;

        depositToken.forceApprove(address(aavePool), amount);
        aavePool.supply(address(depositToken), amount, address(this), 0);

        _mint(msg.sender, shares);

        emit Deposited(msg.sender, amount, shares);
    }

    function withdraw(uint256 shares) external nonReentrant whenNotPaused {
        require(shares > 0,                         "Nexora: zero shares");
        require(balanceOf(msg.sender) >= shares,    "Nexora: insufficient shares");

        uint256 userShares = balanceOf(msg.sender);
        uint256 assetsOut = convertToAssets(shares);
        uint256 principalShare = (principalDeposited[msg.sender] * shares) / userShares;

        uint256 profit = assetsOut > principalShare ? assetsOut - principalShare : 0;
        uint256 fee    = (profit * performanceFee) / FEE_DENOMINATOR;
        uint256 payout = assetsOut - fee;

        principalDeposited[msg.sender] -= principalShare;
        _burn(msg.sender, shares);

        aavePool.withdraw(address(depositToken), assetsOut, address(this));

        if (fee > 0) {
            depositToken.safeTransfer(treasury, fee);
            emit FeeCollected(treasury, fee);
        }

        depositToken.safeTransfer(msg.sender, payout);

        emit Withdrawn(msg.sender, payout, fee, shares);
    }

    function totalAssets() public view returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        uint256 total  = totalAssets();
        if (supply == 0 || total == 0) return assets;
        return (assets * supply) / total;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return (shares * totalAssets()) / supply;
    }

    function getUserPosition(address user) external view returns (
        uint256 currentBalance,
        uint256 principal,
        uint256 yieldEarned,
        uint256 estimatedFee,
        uint256 netWithdrawable
    ) {
        uint256 userShares = balanceOf(user);
        if (userShares == 0) return (0, 0, 0, 0, 0);

        currentBalance  = convertToAssets(userShares);
        principal       = principalDeposited[user];
        yieldEarned     = currentBalance > principal ? currentBalance - principal : 0;
        estimatedFee    = (yieldEarned * performanceFee) / FEE_DENOMINATOR;
        netWithdrawable = currentBalance - estimatedFee;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Nexora: zero address");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setPerformanceFee(uint256 _fee) external onlyOwner {
        require(_fee <= MAX_FEE, "Nexora: exceeds max fee");
        performanceFee = _fee;
        emit PerformanceFeeUpdated(_fee);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}