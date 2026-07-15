export interface ReceiptScreenData {
  reference: string;
  amount: string;
}

export interface ReceiptScreenEvents {
  onDone(): void;
}
