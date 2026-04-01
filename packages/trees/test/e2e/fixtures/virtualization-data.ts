import {
  DEFAULT_VIRTUALIZATION_WORKLOAD_NAME,
  getVirtualizationWorkload,
  listVirtualizationWorkloads,
  VIRTUALIZATION_WORKLOAD_NAMES,
} from '@pierre/tree-test-data';
import type { VirtualizationWorkload } from '@pierre/tree-test-data';

export {
  DEFAULT_VIRTUALIZATION_WORKLOAD_NAME,
  getVirtualizationWorkload,
  listVirtualizationWorkloads,
  VIRTUALIZATION_WORKLOAD_NAMES,
};

export type VirtualizationWorkloadName =
  (typeof VIRTUALIZATION_WORKLOAD_NAMES)[number];

export type { VirtualizationWorkload };

const defaultWorkload = getVirtualizationWorkload(
  DEFAULT_VIRTUALIZATION_WORKLOAD_NAME
);

export const linuxKernelFiles = defaultWorkload.files;
export const linuxKernelAllFolders = defaultWorkload.expandedFolders;
export const linuxKernelReplicaCount = defaultWorkload.rootCount;
