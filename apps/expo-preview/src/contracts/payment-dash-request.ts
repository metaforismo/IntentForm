export interface Payment_dash_requestScreenData {
  amount: string;
  recipientName: string;
  recipientHandle: string;
  status: string;
}

export interface Payment_dash_requestScreenEvents {
  onConfirm(): void;
  onCancel(): void;
  onRetry(): void;
}
