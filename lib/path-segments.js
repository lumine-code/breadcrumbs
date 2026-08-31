const path = require("node:path");

function projectSegments(filePath, { hideSingleProjectRoot = false } = {}) {
  const [rootPath, relativePath] = lumine.project.relativizePath(filePath);
  if (!rootPath) return null;

  const parts = relativePath.split(path.sep).filter(Boolean);
  const segments = [];
  if (!hideSingleProjectRoot || lumine.project.getPaths().length !== 1) {
    segments.push({
      label: path.basename(rootPath) || rootPath,
      path: rootPath,
      directory: true,
      project: true,
    });
  }
  let currentPath = rootPath;
  for (let index = 0; index < parts.length; index++) {
    currentPath = path.join(currentPath, parts[index]);
    segments.push({
      label: parts[index],
      path: currentPath,
      directory: index < parts.length - 1,
      project: true,
    });
  }
  return segments;
}

function externalSegments(filePath) {
  const parsed = path.parse(filePath);
  const parts = filePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const segments = [];
  let currentPath = parsed.root;
  if (parsed.root) {
    segments.push({
      label: parsed.root.replace(/[\\/]$/, "") || parsed.root,
      path: parsed.root,
      directory: true,
      project: false,
    });
  }
  for (let index = 0; index < parts.length; index++) {
    currentPath = path.join(currentPath, parts[index]);
    segments.push({
      label: parts[index],
      path: currentPath,
      directory: index < parts.length - 1,
      project: false,
    });
  }
  return segments;
}

exports.forEditor = (editor, options = {}) => {
  const filePath = editor?.getPath?.();
  if (!filePath) {
    const title = editor?.getTitle?.();
    return title ? [{ label: title, path: null, directory: false, project: false }] : [];
  }
  return projectSegments(filePath, options) ?? externalSegments(filePath);
};
