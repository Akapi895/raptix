const browserRoots = new Set(['window', 'globalThis', 'self']);
const nativeTransport = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']);
const root = node => node?.type === 'Identifier' && browserRoots.has(node.name);
const memberName = node => node?.computed ? node.property.value : node?.property?.name;
const eventAttribute = /\bon(?:click|dblclick|change|input|submit|key\w+|mouse\w+|pointer\w+|touch\w+|drag\w*|drop|focus|blur|contextmenu|load|error)\s*=/i;
const eventSelector = /\[\s*on(?:click|change|input|submit|key\w+|mouse\w+|pointer\w+|touch\w+|drag\w*|drop|focus|blur|contextmenu)\b/i;

/** Runtime rules apply to every source module, including future composition files. */
export const architecture = {
  rules: {
    boundaries: {
      meta: { type: 'problem', schema: [], messages: {
        browser: 'Use an explicit platform capability; browser globals are confined to src/platform.',
        global: 'Application APIs and state must not be installed on a browser global.',
        inline: 'Use data actions or listeners; executable HTML attributes and handler-source selectors are forbidden.',
        dynamic: 'Executable source evaluation and browser-global proxies are forbidden.',
        dependency: 'Import a typed module API; legacy/classic/bridge dependencies are forbidden.',
      } },
      create(context) {
        const platform = context.filename.replaceAll('\\', '/').includes('/src/platform/');
        const report = (node, messageId) => context.report({ node, messageId });
        const checkText = (node, text) => {
          if (typeof text === 'string' && (eventAttribute.test(text) || eventSelector.test(text))) report(node, 'inline');
        };
        return {
          Identifier(node) {
            if (!platform && browserRoots.has(node.name)) {
              const parent = node.parent;
              if ((parent.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
                  (parent.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand)) return;
              report(node, 'browser');
            }
          },
          TSInterfaceHeritage(node) { if (node.expression?.name === 'Window') report(node, 'browser'); },
          TSTypeReference(node) { if (!platform && node.typeName?.name === 'Window') report(node, 'browser'); },
          Literal(node) { checkText(node, node.value); },
          TemplateElement(node) { checkText(node, node.value.cooked); },
          ImportDeclaration(node) {
            if (/(?:^|\/)(?:legacy|classic-runtime)(?:\/|$)|-bridge(?:\.|$)/.test(node.source.value)) report(node, 'dependency');
          },
          ImportExpression(node) {
            if (typeof node.source.value === 'string' && /(?:^|\/)(?:legacy|classic-runtime)(?:\/|$)|-bridge(?:\.|$)/.test(node.source.value)) report(node, 'dependency');
          },
          AssignmentExpression(node) {
            const target = node.left;
            if (target.type === 'MemberExpression' && root(target.object) && !nativeTransport.has(memberName(target))) report(node, 'global');
          },
          CallExpression(node) {
            if (node.callee.type === 'Identifier' && ['eval', 'Function'].includes(node.callee.name)) report(node, 'dynamic');
            if (node.callee.type === 'MemberExpression' && ['assign', 'defineProperty', 'defineProperties', 'set'].includes(memberName(node.callee)) && root(node.arguments[0])) report(node, 'global');
            if (node.callee.type === 'MemberExpression' && root(node.callee.object) && ['eval', 'Function'].includes(memberName(node.callee))) report(node, 'dynamic');
          },
          NewExpression(node) {
            if (node.callee.name === 'Function' || (node.callee.name === 'Proxy' && root(node.arguments[0]))) report(node, 'dynamic');
          },
        };
      },
    },
  },
};
