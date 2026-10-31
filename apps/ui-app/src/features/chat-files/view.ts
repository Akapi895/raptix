import { createActions, type ActionHandler } from '../../ui/actions';

/**
 * Delegates the page's clicks, changes, keydowns and inputs to named handlers. The markup
 * carries only data-action / data-change / data-keydown / data-input names, so the page
 * never needs inline handlers.
 */
export function bindChatFilesActions(doc: Document, handlers: Record<string, ActionHandler>): () => void {
    const actions = createActions();
    const disposers = Object.entries(handlers).map(([name, handler]) => actions.register(name, handler));
    const unbind = actions.bind(doc);
    return () => {
        unbind();
        disposers.forEach(dispose => dispose());
    };
}
