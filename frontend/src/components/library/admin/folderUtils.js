const flattenFolders = (tree = []) => {
  const options = [{ value: 'root', label: 'Root (top level)' }];
  const lookup = new Map([['root', null]]);

  const walk = (nodes, prefix = '') => {
    nodes.forEach((node) => {
      const id = node._id || node.id;
      options.push({
        value: id,
        label: `${prefix}${node.displayName || 'Untitled folder'}`
      });
      lookup.set(id, node);
      if (node.children?.length) {
        walk(node.children, `${prefix}${node.displayName || 'Folder'} / `);
      }
    });
  };

  walk(tree);
  return { options, lookup };
};

export default flattenFolders;
