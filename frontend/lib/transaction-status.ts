export function assertSuccessfulTransactionReceipt(receipt: {status: string}, label: string) {
  if (receipt.status !== "success") {
    throw new Error(`${label} transaction reverted.`);
  }
}
