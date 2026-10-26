import type {
  BrowsecCountry,
  BrowsecServer,
  BrowsecSmartRule,
  BrowsecSnapshot,
  BrowsecState,
} from '../../shared/types';

export interface BrowsecSettings {
  enabled: boolean;
  country: string;
  webrtcLeakProtection: boolean;
  smartRules: BrowsecSmartRule[];
}

export type {
  BrowsecCountry,
  BrowsecServer,
  BrowsecSmartRule,
  BrowsecSnapshot,
  BrowsecState,
};
