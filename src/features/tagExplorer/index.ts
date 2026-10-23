/**
 * Tag Explorer public surface used by the Genre and Mood catalog features.
 * Keep result-page internals/hooks off this barrel so catalog pages do not pull
 * the heavier Explorer result/playlist graph into their initial chunks.
 */
export { default as TagExplorerSelectionBar } from './components/TagExplorerSelectionBar';
export { useTagExplorerSelectionStore } from './store/tagExplorerSelectionStore';
export { tagExplorerTagKey } from './utils/tagExplorerQuery';
