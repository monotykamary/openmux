/**
 * Aggregate View modular architecture.
 */

export { FilterOperationError } from './errors';

export {
  normalizeProcessName,
  isActivePty,
  filterActivePtys,
  filterPtysByActivity,
  filterPtys,
  buildPtyIndex,
  groupPtysBySession,
  sortPtysForSession,
  extractSessionIds,
} from './filter';

export {
  getDefaultLoadState,
  createLoadingPlaceholder,
  createErrorPlaceholder,
  createUnloadedPlaceholder,
  buildTreeRoot,
  getSessionIdForItem,
  isSelectableItem,
  buildFlattenedTreeIndex,
  findNearestSelectableIndex,
  flattenTree,
  type SessionLoadState,
  type SessionTreeNode,
  type PtyTreeNode,
  type PlaceholderTreeNode,
  type SpacerTreeNode,
  type TreeNode,
  type FlattenedTreeItem,
  TREE_GLYPHS,
} from './tree';

export {
  applySelection,
  clearPreviewState,
  findNearestSelectable,
  findNearestPtyInSessionAbove,
  findSessionHeader,
  selectAfterPtyRemoval,
} from './selection';

export {
  toggleSessionExpanded,
  getSortedSessions,
  recomputeMatches,
  recomputeTree,
} from './session';

export {
  createSubscriptionManager,
  createRefreshState,
  RefreshGuard,
  createLifecycleHandlers,
  createMetadataChangeHandler,
  setupSubscriptions,
  createGitRepoChangeRefresh,
  createActivityBasedRefresh,
  cleanupSubscriptions,
  type SubscriptionManager,
  type RefreshState,
  type RefreshFlagKey,
  type MetadataChangeEvent,
  type LifecycleEvent,
  type LifecycleHandlers,
  type SubscriptionSetupDeps,
  type LifecycleHandlerDeps,
} from './subscriptions';

export { ptyMetadataToInfo, createAggregateViewRefreshers, type RefreshersResult } from './refresh';

export {
  extractGitMetadata,
  applyGitMetadataSnapshot,
  areGitDiffStatsEqual,
  hasGitMetadata,
  mergePtyInfoPreservingGitMetadata,
  didPtyInfoChange,
  type GitMetadataFields,
} from './git';

export {
  setPendingPaneCreations,
  upsertPendingPaneCreation,
  removePendingPaneCreations,
  getNextPendingPaneCreationOrder,
  findPendingPaneCreationForLifecycle,
} from './pending';

export {
  getSessionPaneOrderKey,
  getSessionPaneOrder,
  deleteSessionPaneOrder,
  setSessionPaneOrder,
  mergePaneOrder,
  buildSessionPaneOrderFromAggregateState,
  type SessionPaneOrderIndex,
} from './pane-order';

export type {
  PtyInfo,
  GitDiffStats,
  AggregateViewState,
  PendingPaneCreation,
  AggregateViewContextValue,
} from '../aggregate-view-types';

export { TREE_GLYPHS as TREE_GLYPHS_TYPES, createInitialState } from '../aggregate-view-types';
