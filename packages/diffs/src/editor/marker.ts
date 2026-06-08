import type { Range } from './textDocument';

export type MarkerSeverity = 'error' | 'warning' | 'info' | 'hint';

export function markerSeverityDatasetKey(severity: MarkerSeverity): string {
  switch (severity) {
    case 'error':
      return 'markerError';
    case 'warning':
      return 'markerWarning';
    case 'info':
      return 'markerInfo';
    case 'hint':
      return 'markerHint';
  }
}

export interface MarkerAction {
  label: string;
  action: (marker: Marker) => void;
}

export interface Marker extends Range {
  severity: MarkerSeverity;
  message: string;
  source?: string;
  actions?: MarkerAction[];
  metadata?: Record<string, unknown>;
}
