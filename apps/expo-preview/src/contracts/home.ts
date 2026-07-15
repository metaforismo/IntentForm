export interface HomeScreenData {
  balance: string;
  activitySummary: string;
}

export interface HomeScreenEvents {
  onRequestPayment(): void;
}
