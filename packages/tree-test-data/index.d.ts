export interface LinuxKernelFixture {
  files: string[];
  folders: string[];
}

export interface VirtualizationWorkload {
  expandedFolders: string[];
  fileCountLabel: string;
  files: string[];
  label: string;
  name: VirtualizationWorkloadName;
  rootCount: number;
}

export type VirtualizationWorkloadName =
  | 'demo-small'
  | 'pierre-snapshot'
  | 'half-linux'
  | 'linux'
  | 'linux-5x'
  | 'linux-10x';

export const VIRTUALIZATION_WORKLOAD_NAMES: readonly VirtualizationWorkloadName[];
export const DEFAULT_VIRTUALIZATION_WORKLOAD_NAME: VirtualizationWorkloadName;
export const linuxKernelFixture: LinuxKernelFixture;
export const pierreSnapshotFiles: string[];

export function getVirtualizationWorkload(
  workloadName?: string | null
): VirtualizationWorkload;

export function listVirtualizationWorkloads(): VirtualizationWorkload[];
