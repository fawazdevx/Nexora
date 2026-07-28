/**
 * Convert wallet, RPC, viem, and facilitator failures into concise messages
 * suitable for end users. Full provider errors must stay in developer logs;
 * they often contain ABI internals, library versions, or RPC payloads.
 */
export function userFacingPaymentError(error: unknown, fallback = "The payment could not be completed.") {
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (/user rejected|rejected the request|denied transaction|code.?4001/i.test(message)) {
    return "You rejected the wallet request. No transaction was submitted.";
  }
  if (/FeeExceedsMax|0x5ff85e3f/i.test(message)) {
    return "The settlement fee changed before submission. Refresh the payment requirements and try again.";
  }
  if (/Expected bytes32, got bytes20|AbiEncoding|invalid.*bytes(20|32)/i.test(message)) {
    return "Nexora could not prepare this payment because an authorization value was malformed. Refresh and try again.";
  }
  if (/insufficient funds|exceeds balance|not enough.*(gas|funds|balance)/i.test(message)) {
    return "This wallet does not have enough token balance or native gas for the selected network.";
  }
  if (/allowance|approve|transfer amount exceeds allowance/i.test(message)) {
    return "The token approval is missing or too small. Approve the payment token and try again.";
  }
  if (/chain mismatch|wrong chain|switch.*network|current chain/i.test(message)) {
    return "The wallet is connected to the wrong network. Switch to the selected payment network and try again.";
  }
  if (/authorization.*(expired|used)|nonce.*(used|expired)|AlreadySettled/i.test(message)) {
    return "This payment authorization is no longer valid. Create a new authorization and try again.";
  }
  if (/execution reverted|ContractFunctionExecutionError|transaction reverted|call exception/i.test(message)) {
    return "The payment contract rejected the transaction. Check the selected network, token balance, and approval, then try again.";
  }
  if (/fetch failed|network error|ECONN|ENOTFOUND|timeout|RPC/i.test(message)) {
    return "The payment network is temporarily unavailable. Please try again shortly.";
  }

  // Preserve concise product/validation messages, but suppress technical dumps.
  if (message && message.length <= 220 && !/\n|Request Arguments:|Contract Call:|Details:|Raw Call Arguments:/i.test(message)) {
    return message;
  }
  return fallback;
}
